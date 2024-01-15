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
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

app.use(bodyParser.json());
app.use(express.static("public"));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

wss.on("connection", function connection(ws) {
  ws.on("message", async function incoming(messageBuffer) {
    try {
      const messageData = JSON.parse(messageBuffer.toString());
      // console.log(messageData);
      if (messageData.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      const hasImage =
        messageData.history.some((entry) => entry.imageUrl) ||
        messageData.imageUrl;

      const model = hasImage
        ? genAI.getGenerativeModel({
            model: "gemini-pro-vision",
            safetySettings,
          })
        : genAI.getGenerativeModel({ model: "gemini-pro", safetySettings });

      const promptParts = await composeMessageForAI(messageData);
      // console.log(promptParts);
      const result = await model.generateContentStream(promptParts);

      for await (const chunk of result.stream) {
        ws.send(chunk.text());
      }

      ws.send(
        JSON.stringify({ type: "AI_COMPLETE", uniqueIdentifier: "7777" }),
      );
    } catch (error) {
      console.error(error);
      ws.send("Error: Unable to process the request.");
    }
  });
});

async function composeMessageForAI(messageData) {
  let parts = [];
  let consoleOutput = "";
  let latestImageIndex = null;

  messageData.history.forEach((entry, index) => {
    if (entry.imageUrl && entry.role === "user") {
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

    if (entry.imageUrl && entry.role === "user") {
      if (i === latestImageIndex && !messageData.imageUrl) {
        const imagePart = await urlToGenerativePart(entry.imageUrl);
        parts.push(imagePart);
        consoleOutput += "\n\n[User Image Attached]";
      } else {
        parts.push("\n\n[previous image removed for privacy and safety]");
        consoleOutput += "\n\n[previous image removed for privacy and safety]";
      }
    }
  }

  const latestUserTextPart = `\n\nUser: ${messageData.text}`;
  parts.push(latestUserTextPart);
  consoleOutput += latestUserTextPart;
  if (messageData.imageUrl) {
    const imagePart = await urlToGenerativePart(messageData.imageUrl);
    parts.push(imagePart);
    consoleOutput += "\n[User Image Attached]";
  }

  parts.push("\n\nTotoB12:");
  consoleOutput += "\n\nTotoB12:";

  // console.log("Console Output:\n" + consoleOutput);
  return parts;
}

async function urlToGenerativePart(image, retryCount = 0) {
  try {
    const response = await fetch(image.link);
    console.log(image.link);
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
  } catch (error) {
    if (error.message.includes("429") && retryCount < 3) {
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 100));
      return urlToGenerativePart(image, retryCount + 1);
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
