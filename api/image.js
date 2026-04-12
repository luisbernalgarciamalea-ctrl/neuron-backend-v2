// Neuron AI — /api/image v9 — DALL-E 3 with key rotation
const https = require("https");

function getOpenAIKeys() {
  const keys = [];
  if (process.env.OPENAI_KEY && process.env.OPENAI_KEY.length > 10) keys.push(process.env.OPENAI_KEY);
  for (let i = 1; i <= 15; i++) {
    const k = process.env[`OPENAI_KEY_${i}`];
    if (k && k.length > 10 && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

let imgKeyIndex = 0;
function getNextKey(keys) {
  if (!keys.length) return null;
  imgKeyIndex = imgKeyIndex % keys.length;
  return keys[imgKeyIndex++];
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(d), ...headers }
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, data: raw }); } });
    });
    req.on("error", reject);
    req.setTimeout(55000, () => req.destroy(new Error("Timeout")));
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
  const size = body.size || "1024x1024";
  const quality = body.quality || "standard";

  if (!prompt) return res.status(400).json({ error: "No prompt provided" });

  const keys = getOpenAIKeys();
  if (!keys.length) return res.status(500).json({ error: "No OpenAI keys configured" });

  let lastErr = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = getNextKey(keys);
    if (!key) break;
    try {
      const r = await httpPost(
        "https://api.openai.com/v1/images/generations",
        { model: "dall-e-3", prompt, n: 1, size, quality, response_format: "url" },
        { Authorization: "Bearer " + key }
      );
      if (r.status === 200) {
        const imageUrl = r.data?.data?.[0]?.url;
        const revisedPrompt = r.data?.data?.[0]?.revised_prompt;
        if (imageUrl) return res.status(200).json({ imageUrl, revisedPrompt });
        throw new Error("No image URL returned");
      }
      const errMsg = (r.data?.error?.message || JSON.stringify(r.data)).slice(0, 200);
      console.error(`Image key ${attempt + 1} HTTP ${r.status}:`, errMsg);
      lastErr = new Error(errMsg);
      if (r.status === 400) break; // content policy, no retry
    } catch (e) {
      console.error(`Image key ${attempt + 1} error:`, e.message);
      lastErr = e;
    }
  }

  return res.status(502).json({ error: lastErr?.message || "Image generation failed", keysAttempted: keys.length });
};
