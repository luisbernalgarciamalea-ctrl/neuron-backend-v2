// Neuron AI — /api/image
// Gemini image generation with model fallback chain

const https = require("https");
const {
  applyCors,
  handleOptions,
  cleanText
} = require("./_security.js");

function getGeminiKeys() {
  const keys = [];

  const main = process.env.GEMINI_KEY;
  if (main && main.length > 8) {
    keys.push(main);
  }

  for (let i = 1; i <= 15; i++) {
    const key = process.env[`GEMINI_KEY_${i}`];

    if (key && key.length > 8 && !keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
}

let keyIndex = 0;

function nextKey(keys) {
  const key = keys[keyIndex % keys.length];
  keyIndex++;
  return key;
}

function fallbackImageUrl(prompt) {
  // Pollinations requires a safe 32-bit seed.
  const seed = Math.floor(Math.random() * 2147483647);

  return (
    "https://image.pollinations.ai/prompt/" +
    encodeURIComponent(
      String(prompt) +
        " high quality, detailed, professional composition"
    ) +
    "?width=1024" +
    "&height=1024" +
    "&nologo=true" +
    "&enhance=true" +
    "&seed=" +
    seed
  );
}

const IMAGE_MODELS = [
  "gemini-2.5-flash-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp"
];

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const data = JSON.stringify(body);

    const request = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data)
        }
      },
      response => {
        let raw = "";

        response.on("data", chunk => {
          raw += chunk;
        });

        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode,
              data: JSON.parse(raw)
            });
          } catch {
            resolve({
              status: response.statusCode,
              data: raw
            });
          }
        });
      }
    );

    request.on("error", reject);

    request.setTimeout(60000, () => {
      request.destroy(new Error("Image request timed out"));
    });

    request.write(data);
    request.end();
  });
}

module.exports = async function handler(req, res) {
  applyCors(req, res, "POST, OPTIONS");

  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const body = req.body || {};
  const prompt = cleanText(body.prompt, 12000);

  if (!prompt) {
    return res.status(400).json({
      error: "No prompt provided"
    });
  }

  const keys = getGeminiKeys();

  // If Gemini is not configured, use the fallback image service.
  if (!keys.length) {
    return res.status(200).json({
      imageUrl: fallbackImageUrl(prompt),
      provider: "free image fallback",
      fallback: true,
      warning: "No Gemini image key configured"
    });
  }

  let lastError = null;

  for (let keyNumber = 0; keyNumber < keys.length; keyNumber++) {
    const key = nextKey(keys);

    for (const model of IMAGE_MODELS) {
      try {
        const result = await httpPost(
          "https://generativelanguage.googleapis.com/v1beta/models/" +
            model +
            ":generateContent?key=" +
            encodeURIComponent(key),
          {
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"]
            }
          }
        );

        if (result.status === 200) {
          const parts =
            result.data?.candidates?.[0]?.content?.parts || [];

          const imagePart = parts.find(part =>
            part.inlineData?.mimeType?.startsWith("image/")
          );

          if (imagePart) {
            const dataUrl =
              "data:" +
              imagePart.inlineData.mimeType +
              ";base64," +
              imagePart.inlineData.data;

            return res.status(200).json({
              imageUrl: dataUrl,
              isDataUrl: true,
              model
            });
          }

          lastError = new Error(
            model + ": no image in response"
          );

          continue;
        }

        if (result.status === 404 || result.status === 403) {
          lastError = new Error(
            model + ": HTTP " + result.status
          );

          continue;
        }

        if (result.status === 429) {
          lastError = new Error("Rate limit");
          break;
        }

        const message = (
          result.data?.error?.message ||
          JSON.stringify(result.data)
        ).slice(0, 150);

        lastError = new Error(
          model +
            " HTTP " +
            result.status +
            ": " +
            message
        );
      } catch (error) {
        lastError = error;
      }
    }
  }

  // Gemini failed or was rate-limited.
  // Return a fallback image instead of an error.
  return res.status(200).json({
    imageUrl: fallbackImageUrl(prompt),
    provider: "free image fallback",
    fallback: true,
    warning:
      lastError?.message ||
      "Gemini image models were unavailable",
    tried: IMAGE_MODELS
  });
};
