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
const { v4: uuidv4 } = require('uuid');
const connectionStates = new Map();

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
  temperature: 0.27,
  // maxOutputTokens: 200,
  // topP: 0.1,
  // topK: 16,
};
const apiGenerationConfig = {
  temperature: 0.17,
  // maxOutputTokens: 200,
  // topP: 0.1,
  // topK: 16,
};

const SDXLInvokeUrl = "https://api.nvcf.nvidia.com/v2/nvcf/pexec/functions/89848fb8-549f-41bb-88cb-95d6597044a4"
const SDXLfetchUrlFormat = "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/"
const SDXLTurboSteps = 10;
const SDXLSteps = 45
const SDXLHeaders = {
  "Authorization": "Bearer " + process.env["SDXL_API_KEY"],
  "Accept": "application/json",
}

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
    // console.log(prompt);
    const response = await getGeminiProResponse(prompt);
    console.log(response);
    res.json({ response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error processing your request" });
  }
});

app.post("/generate-image", async (req, res) => {
  const { prompt, turbo } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    console.log(turbo);
    const imageData = await generateImage(prompt, turbo);
    res.json({ imageData: imageData.b64_json });
  } catch (error) {
    console.error("Failed to generate image:", error);
    res.status(500).json({ error: "Error generating image" });
  }
});

app.use((req, res, next) => {
  res.redirect("/");
});

wss.on("connection", function connection(ws) {
  const connectionId = generateUniqueConnectionUUID();
  connectionStates.set(connectionId, { continueStreaming: true });

  ws.on("message", async function incoming(messageBuffer) {
    const messageData = JSON.parse(messageBuffer.toString());
    const conversationUUID = messageData.uuid;
    try {
      if (messageData.type === "stop_ai_response") {
        console.log("Stopping AI response for connection:", connectionId);
        connectionStates.set(connectionId, { continueStreaming: false });
        return;
      }

      if (messageData.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // console.log(messageData);
      hasImage = messageData.images && messageData.images.length > 0 || 
       messageData.history.some(
         (entry) => 
           entry.images && entry.images.length > 0 && entry.role === "user" &&
           !wasMessageBlockedByAI(
             messageData.history,
             messageData.history.indexOf(entry),
           ),
       );

      const promptParts = await composeMessageForAI(messageData);
      console.log(promptParts);
      // convert promptParts to text
      const prompt = promptParts.join("");
      console.log(prompt);

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
          break;
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
    connectionStates.delete(connectionId);
  });
});

async function generateImage(prompt, turbo = true, image = null) {
  const headers = SDXLHeaders;
  const invokeUrl = SDXLInvokeUrl;

  const payload = turbo ? {
    "prompt": prompt,
    // "negative_prompt": "ugly",
    "negative_prompt": "(bad quality, low resolution, poorly drawn, tiling, out of focus, overexposed, underexposed, bad art, beginner, amateur, distorted face, poorly drawn hands, poorly drawn feet, disfigured, body out of frame)",
    "sampler": "DPM",
    "seed": Math.floor(Math.random() * 1000),
    "guidance_scale": 5,
    "inference_steps": SDXLTurboSteps,
  } : {
    "prompt": prompt,
    // "negative_prompt": "ugly",
    "negative_prompt": "(bad quality, low resolution, poorly drawn, tiling, out of focus, overexposed, underexposed, bad art, beginner, amateur, distorted face, poorly drawn hands, poorly drawn feet, disfigured, body out of frame)",
    "sampler": "DPM",
    "seed": Math.floor(Math.random() * 1000),
    "guidance_scale": 5,
    "inference_steps": SDXLSteps,
  };

  let response = await fetch(invokeUrl, {
    method: "post",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json", ...headers }
  });

  while (response.status == 202) {
    let requestId = response.headers.get("NVCF-REQID");
    let fetchUrl = SDXLfetchUrlFormat + requestId;
    response = await fetch(fetchUrl, {
      method: "get",
      headers: headers
    });
  }

  if (response.status != 200) {
    let errBody = await (await response.blob()).text();
    throw "Invocation failed with status " + response.status + " " + errBody;
  }

  return await response.json();
}

async function uploadImageToImgur(imageData) {
  let request = require('request');
  let options = {
    'method': 'POST',
    'url': 'https://api.imgur.com/3/image',
    'headers': {
      'Authorization': 'Client-ID 6a8a51f3d7933e1'
    },
    formData: {
      'image': imageData
    }
  };
  return new Promise((resolve, reject) => {
    request(options, function (error, response) {
      if (error) reject(error);
      let responseBody = JSON.parse(response.body);
      let responseData = responseBody.data;
      // console.log(responseData);
      resolve(responseData);
    });
  });
}

function generateUniqueConnectionUUID() {
  let uuid = uuidv4();
  while (connectionStates.has(uuid)) {
    uuid = uuidv4();
  }
  return uuid;
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
      const placeholder = entry.images && entry.images.length
        ? "\n\nUser: [message and images removed for safety]"
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

    if (entry.images && entry.images.length && entry.role === "user") {
      for (const image of entry.images) {
        const imagePart = await urlToGenerativePart(image.link);
        parts.push(imagePart);
        consoleOutput += "\n[User Image Attached]";
      }
    }
  }

  const latestUserTextPart = `\n\nUser: ${messageData.text}`;
  parts.push(latestUserTextPart);
  consoleOutput += latestUserTextPart;

  if (messageData.images && messageData.images.length) {
    for (const image of messageData.images) {
      const imagePart = await urlToGenerativePart(image.link);
      parts.push(imagePart);
      consoleOutput += "\n[User Image Attached]";
    }
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
  // console.log(proxyedImageUrl);
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
