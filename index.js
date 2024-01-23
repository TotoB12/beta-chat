const express = require("express");
const path = require("path");
const http = require("http");
const fetch = require("node-fetch");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} = require("@google/generative-ai");

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

app.use(bodyParser.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/c/:uuid", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api", async (req, res) => {
  const { securityCode, prompt } = req.body;

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
  ws.on("message", async function incoming(messageBuffer) {
    try {
      const messageData = JSON.parse(messageBuffer.toString());
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
          })
        : genAI.getGenerativeModel({
            model: "gemini-pro",
            safetySettings,
            generationConfig,
          });

      const result = await model.generateContentStream(promptParts);

      for await (const chunk of result.stream) {
        ws.send(chunk.text());
        // console.log(chunk.text());
      }

      ws.send(
        JSON.stringify({ type: "AI_COMPLETE", uniqueIdentifier: "7777" }),
      );
    } catch (error) {
      console.error(error);

      let blockReason = "";
      if (error.response && error.response.promptFeedback) {
        blockReason = `Request was blocked due to ${error.response.promptFeedback.blockReason}.`;
      } else {
        blockReason = "Error: Unable to process the request.";
      }

      ws.send(JSON.stringify({ type: "error", text: blockReason }));
      ws.send(
        JSON.stringify({ type: "AI_COMPLETE", uniqueIdentifier: "7777" }),
      );
    }
  });
});

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
  imageUrl = imageUrl.replace("i.imgur.com", "imgin.voidnet.tech");
  console.log(imageUrl);
  try {
    // console.log(wasBlocked);
    if (wasBlocked === false) {
      const response = await fetch(imageUrl);
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
