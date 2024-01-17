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

let hasImage;

app.use(bodyParser.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/c/:uuid", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
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
        messageData.history.some((entry) => entry.image) || messageData.image;

      const promptParts = await composeMessageForAI(messageData);
      // console.log(promptParts);

      const model = hasImage
        ? genAI.getGenerativeModel({
            model: "gemini-pro-vision",
            safetySettings,
          })
        : genAI.getGenerativeModel({ model: "gemini-pro", safetySettings });

      const result = await model.generateContentStream(promptParts);

      for await (const chunk of result.stream) {
        ws.send(chunk.text());
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

function wasImageBlockedByAI(history, imageMessageIndex) {
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
  let latestImageIndex = null;

  messageData.history.forEach((entry, index) => {
    if (entry.image && entry.role === "user") {
      latestImageIndex = index;
    }
  });

  for (let i = 0; i < messageData.history.length; i++) {
    const entry = messageData.history[i];
    let textPart = null;
    // const textPart =
    //   entry.role === "user"
    //     ? `\nUser: ${entry.parts}`
    //     : `\nTotoB12: ${entry.parts}`;
    if (entry.role === "user") {
      textPart = `\n\nUser: ${entry.parts}`;
    } else if (entry.role === "model") {
      textPart = `\n\nTotoB12: ${entry.parts}`;
    } else {
      textPart = `System: ${entry.parts}`;
    }
    parts.push(textPart);
    consoleOutput += "\n" + textPart;

    if (entry.image && entry.role === "user") {
      const wasThisImageBlocked = wasImageBlockedByAI(messageData.history, i);
      if (i === latestImageIndex && !messageData.image) {
        // const wasThisImageBlocked = wasImageBlockedByAI(messageData.history, i);
        const imagePart = await urlToGenerativePart(
          entry.image.link,
          0,
          wasThisImageBlocked,
        );
        parts.push(imagePart);
        consoleOutput += "\n\n[User Image Attached]";
      } else {
        if (wasThisImageBlocked === true) {
          parts.push("\n\n[image removed for safety]");
          consoleOutput += "\n\n[image removed for safety]";
        } else {
          parts.push("\n\n[previous image removed for privacy and safety]");
          consoleOutput +=
            "\n\n[previous image removed for privacy and safety]";
        }
      }
    }
  }

  const latestUserTextPart = `\n\nUser: ${messageData.text}`;
  parts.push(latestUserTextPart);
  consoleOutput += latestUserTextPart;
  if (messageData.image) {
    // console.log(messageData);
    const imagePart = await urlToGenerativePart(messageData.image.link);
    parts.push(imagePart);
    consoleOutput += "\n[User Image Attached]";
  }

  parts.push("\n\nTotoB12:");
  consoleOutput += "\n\nTotoB12:";

  // console.log("Console Output:\n" + consoleOutput);
  return parts;
}

async function urlToGenerativePart(
  imageUrl,
  retryCount = 0,
  wasBlocked = false,
) {
  try {
    console.log(wasBlocked);
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
      return "[image removed for safety]";
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

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server started on port ${server.address().port}`);
});
