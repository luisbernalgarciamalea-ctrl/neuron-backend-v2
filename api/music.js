// Neuron AI — /api/music
// Uses Hugging Face free Inference API + Meta MusicGen
// Get free token at huggingface.co → Settings → Access Tokens (no credit card)
const https = require("https");

function httpRequest(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(d ? { "Content-Length": Buffer.byteLength(d) } : {}),
        ...headers
      }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        // Try JSON first, otherwise return raw buffer (audio bytes)
        try {
          const json = JSON.parse(raw.toString());
          resolve({ status: res.statusCode, data: json, isJson: true });
        } catch {
          resolve({ status: res.statusCode, data: raw, isJson: false });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("Timeout")));
    if (d) req.write(d);
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
  const duration = Math.min(parseInt(body.duration) || 10, 30); // max 30s

  if (!prompt) return res.status(400).json({ error: "No prompt provided" });

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    return res.status(500).json({
      error: "No Hugging Face token configured",
      fix: "Go to huggingface.co → Settings → Access Tokens → New token (free) → Add as HF_TOKEN in Vercel env vars"
    });
  }

  // Try models in order — small is fastest and most reliable on free tier
  const models = [
    "facebook/musicgen-small",
    "facebook/musicgen-medium"
  ];

  for (const model of models) {
    try {
      const r = await httpRequest(
        `https://api-inference.huggingface.co/models/${model}`,
        "POST",
        {
          inputs: prompt,
          parameters: { max_new_tokens: duration * 50 } // ~50 tokens per second
        },
        {
          Authorization: "Bearer " + hfToken,
          "x-wait-for-model": "true" // wait if model is loading (cold start)
        }
      );

      if (r.status === 200 && !r.isJson) {
        // Got raw audio bytes — convert to base64 and return
        const base64 = r.data.toString("base64");
        return res.status(200).json({
          audio: base64,
          mimeType: "audio/wav",
          model
        });
      }

      if (r.status === 503) {
        // Model loading — try next
        console.warn(`${model} loading, trying next`);
        continue;
      }

      const errMsg = r.isJson ? (r.data?.error || JSON.stringify(r.data)) : "Unknown error";
      console.error(`${model} HTTP ${r.status}:`, errMsg);

    } catch (e) {
      console.error(`${model} error:`, e.message);
    }
  }

  return res.status(502).json({
    error: "Music generation failed — models may be loading. Please try again in 30 seconds.",
    hint: "HF free tier cold-starts can take up to 60 seconds. First request is always slowest."
  });
};
