require('dotenv').config();
const express = require("express");
const path = require("path");
const http = require("http");
const fetch = require("node-fetch");
const cors = require('cors');
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} = require("@google/generative-ai");
const connectionStates = new Map();
let connectionCounter = 0;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const genAI = new GoogleGenerativeAI(process.env["API_KEY"]);
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];
const generationConfig = {
  temperature: 0.17,
  // maxOutputTokens: 200,
  // topP: 0.1,
  // topK: 16,
};
const apiGenerationConfig = {
  temperature: 0,
  // maxOutputTokens: 200,
  // topP: 0.1,
  // topK: 16,
};

let hasImage;

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static("public"));
app.use(cors());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/c/:uuid", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api", async (req, res) => {
  const { securityCode, prompt } = req.body;
  console.log(securityCode, prompt);

  if (!validateSecurityCode(securityCode)) {
    return res.status(403).json({ error: "Invalid security code" });
  }

  try {
    console.log(prompt);
    const response = await getGeminiProResponse(prompt);
    res.json({ response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error processing your request" });
  }
});

app.use((req, res, next) => {
  res.redirect("/");
});

wss.on("connection", function connection(ws) {
  const connectionId = generateUniqueConnectionId(); // You need to implement this function
  connectionStates.set(connectionId, { continueStreaming: true });

  ws.on("message", async function incoming(messageBuffer) {
    const messageData = JSON.parse(messageBuffer.toString());
    const conversationUUID = messageData.uuid;
    try {
      if (messageData.type === "stop_ai_response") {
        // Stop sending the AI response for this connection
        console.log("Stopping AI response for connection:", connectionId);
        connectionStates.set(connectionId, { continueStreaming: false });
        return;
      }

      if (messageData.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // console.log(messageData);
      hasImage =
        messageData.image ||
        messageData.history.some(
          (entry) =>
            entry.image &&
            !wasMessageBlockedByAI(
              messageData.history,
              messageData.history.indexOf(entry),
            ),
        );

      const promptParts = await composeMessageForAI(messageData);
      // console.log(promptParts);

      const model = hasImage
        ? genAI.getGenerativeModel({
          model: "gemini-pro-vision",
          safetySettings,
          generationConfig,
          stopSequences: ["TotoB12:"],
        })
        : genAI.getGenerativeModel({
          model: "gemini-pro",
          safetySettings,
          generationConfig,
          stopSequences: ["TotoB12:"],
        });

      const result = await model.generateContentStream(promptParts);

      for await (const chunk of result.stream) {
        if (!connectionStates.get(connectionId).continueStreaming) {
          console.log("Stopped streaming AI response for connection:", connectionId);
          break; // Exit the loop if streaming should be stopped
        }
        ws.send(JSON.stringify({ type: "AI_RESPONSE", uuid: conversationUUID, text: chunk.text() }));
      }  

    connectionStates.set(connectionId, { continueStreaming: true });
    ws.send(JSON.stringify({ type: "AI_COMPLETE", uuid: conversationUUID, uniqueIdentifier: "7777" }));
    } catch (error) {
      console.error(error);

      let blockReason = "";
      if (error.response && error.response.promptFeedback) {
        blockReason = `Request was blocked due to ${error.response.promptFeedback.blockReason}.`;
      } else {
        blockReason = "Error: Unable to process the request.";
      }

      ws.send(JSON.stringify({ type: "error", uuid: conversationUUID, text: blockReason }));
      ws.send(
        JSON.stringify({ type: "AI_COMPLETE", uuid: conversationUUID, uniqueIdentifier: "7777" }),
      );
    }
  });
  ws.on("close", () => {
    // Remove the connection state when the WebSocket connection is closed
    connectionStates.delete(connectionId);
  });
});

function generateUniqueConnectionId() {
  return `connection-${++connectionCounter}`;
}

function wasMessageBlockedByAI(history, imageMessageIndex) {
  if (history.length > imageMessageIndex + 1) {
    const nextMessage = history[imageMessageIndex + 1];
    if (nextMessage.role === "model" && nextMessage.error === true) {
      return true;
    }
  }
  return false;
}

async function composeMessageForAI(messageData) {
  let parts = [];
  let consoleOutput = "";

  for (let i = 0; i < messageData.history.length; i++) {
    const entry = messageData.history[i];

    const wasMessageBlocked = wasMessageBlockedByAI(messageData.history, i);

    if (wasMessageBlocked) {
      const placeholder = entry.image
        ? "\n\nUser: [message and image removed for safety]"
        : "\n\nUser: [message removed for safety]";
      parts.push(placeholder);
      consoleOutput += "\n" + placeholder;
      continue;
    }

    let textPart =
      entry.role === "user"
        ? `\n\nUser: ${entry.parts}`
        : `\n\nTotoB12: ${entry.parts}`;

    parts.push(textPart);
    consoleOutput += "\n" + textPart;

    if (entry.image && entry.role === "user") {
      const imagePart = await urlToGenerativePart(entry.image.link);
      parts.push(imagePart);
      consoleOutput += "\n[User Image Attached]";
    }
  }

  const latestUserTextPart = `\n\nUser: ${messageData.text}`;
  parts.push(latestUserTextPart);
  consoleOutput += latestUserTextPart;

  if (messageData.image) {
    const imagePart = await urlToGenerativePart(messageData.image.link);
    parts.push(imagePart);
    consoleOutput += "\n[User Image Attached]";
  }

  parts.push("\n\nTotoB12:");
  consoleOutput += "\n\nTotoB12:";

  return parts;
}

async function urlToGenerativePart(
  imageUrl,
  retryCount = 0,
  wasBlocked = false,
) {
  // not that great of a way to do this, but it works
  proxyedImageUrl = imageUrl.replace("i.imgur.com", "imgin.voidnet.tech");
  console.log(proxyedImageUrl);
  try {
    // console.log(wasBlocked);
    if (wasBlocked === false) {
      const response = await fetch(proxyedImageUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const buffer = await response.buffer();
      return {
        inlineData: {
          data: buffer.toString("base64"),
          mimeType: "image/jpeg",
        },
      };
    } else {
      hasImage = null;
      return "\n\nUser: [image removed for safety]";
    }
  } catch (error) {
    if (error.message.includes("429") && retryCount < 3) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, retryCount) * 100),
      );
      return urlToGenerativePart(imageUrl, retryCount + 1, wasBlocked);
    } else {
      console.error("Error fetching image:", error);
      return {
        inlineData: {
          data: "",
          mimeType: "image/jpeg",
        },
      };
    }
  }
}

function validateSecurityCode(code) {
  const secretCode = process.env["API_CODE"];
  return code === secretCode;
}

async function getGeminiProResponse(userPrompt) {
  const model = genAI.getGenerativeModel({
    model: "gemini-pro",
    safetySettings,
    apiGenerationConfig,
  });

  const result = await model.generateContentStream([userPrompt]);
  let responseText = "";

  for await (const chunk of result.stream) {
    responseText += chunk.text();
  }

  return responseText;
}

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server started on port ${server.address().port}`);
});
