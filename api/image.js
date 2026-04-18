// Neuron AI — /api/image
// Uses Gemini image generation — completely FREE, 500 images/day per key
// Model: gemini-2.0-flash-preview-image-generation
// Same GEMINI_KEY as chat — no extra keys needed
const https = require("https");

function getGeminiKeys() {
  const keys = [];
  const main = process.env.GEMINI_KEY;
  if (main && main.length > 8) keys.push(main);
  for (let i = 1; i <= 15; i++) {
    const k = process.env[`GEMINI_KEY_${i}`];
    if (k && k.length > 8 && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

let kidx = 0;
function nextKey(keys) {
  if (!keys.length) return null;
  const k = keys[kidx % keys.length];
  kidx++;
  return k;
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(d) }
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("Timeout")));
    req.write(d);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const prompt = (body.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "No prompt provided" });

  const keys = getGeminiKeys();
  if (!keys.length) return res.status(500).json({ error: "No Gemini keys configured" });

  let lastErr = null;

  for (let i = 0; i < keys.length; i++) {
    const key = nextKey(keys);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${key}`;
      const r = await httpPost(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      });

      if (r.status === 200) {
        const parts = r.data?.candidates?.[0]?.content?.parts || [];

        // Find the image part (inlineData with base64)
        const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith("image/"));
        if (imgPart) {
          const base64 = imgPart.inlineData.data;
          const mimeType = imgPart.inlineData.mimeType;
          // Return as data URL so frontend can display directly
          const dataUrl = `data:${mimeType};base64,${base64}`;
          return res.status(200).json({ imageUrl: dataUrl, isDataUrl: true });
        }

        throw new Error("No image in Gemini response");
      }

      const errMsg = (r.data?.error?.message || JSON.stringify(r.data)).slice(0, 200);
      console.error(`Image key ${i+1} HTTP ${r.status}:`, errMsg);
      lastErr = new Error(errMsg);
      if (r.status === 400) break;

    } catch (e) {
      console.error(`Image key ${i+1} error:`, e.message);
      lastErr = e;
    }
  }

  return res.status(502).json({
    error: lastErr?.message || "Image generation failed",
    keysAttempted: keys.length
  });
};
