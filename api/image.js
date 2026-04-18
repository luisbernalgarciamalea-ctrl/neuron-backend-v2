// Neuron AI — /api/image
// Gemini image generation with model fallback chain
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
  const k = keys[kidx % keys.length]; kidx++; return k;
}

// Try models in order — first one that works wins
const IMAGE_MODELS = [
  "gemini-2.5-flash-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp",
];

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(d) }
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, data: raw }); } });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("Timeout")));
    req.write(d); req.end();
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

  for (let ki = 0; ki < keys.length; ki++) {
    const key = nextKey(keys);
    for (const model of IMAGE_MODELS) {
      try {
        const r = await httpPost(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }
        );

        if (r.status === 200) {
          const parts = r.data?.candidates?.[0]?.content?.parts || [];
          const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith("image/"));
          if (imgPart) {
            const dataUrl = `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
            return res.status(200).json({ imageUrl: dataUrl, isDataUrl: true, model });
          }
          lastErr = new Error(`${model}: no image in response`);
          continue;
        }
        if (r.status === 404 || r.status === 403) { lastErr = new Error(`${model}: HTTP ${r.status}`); continue; }
        if (r.status === 429) { lastErr = new Error("Rate limit"); break; }
        const msg = (r.data?.error?.message || JSON.stringify(r.data)).slice(0, 150);
        lastErr = new Error(`${model} HTTP ${r.status}: ${msg}`);
      } catch (e) { lastErr = e; }
    }
  }

  return res.status(502).json({
    error: lastErr?.message || "All image models failed",
    tried: IMAGE_MODELS,
    hint: "Gemini image generation may require billing enabled at aistudio.google.com for some models"
  });
};
