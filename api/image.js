// Neuron AI — /api/image — DALL-E 3
const https = require("https");

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(55000, () => { req.destroy(new Error("Timeout")); });
    req.write(data);
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
  const size = body.size || "1024x1024";
  const quality = body.quality || "standard";

  if (!prompt) {
    return res.status(400).json({ error: "No prompt provided", received: JSON.stringify(body).slice(0, 100) });
  }

  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey || apiKey.length < 10) {
    return res.status(500).json({ error: "OpenAI key not configured" });
  }

  try {
    const result = await httpPost(
      "https://api.openai.com/v1/images/generations",
      { model: "dall-e-3", prompt, n: 1, size, quality, response_format: "url" },
      { Authorization: "Bearer " + apiKey }
    );

    if (result.status !== 200) {
      const errMsg = result.data?.error?.message || JSON.stringify(result.data).slice(0, 200);
      return res.status(502).json({ error: "DALL-E failed: " + errMsg });
    }

    const imageUrl = result.data?.data?.[0]?.url;
    const revisedPrompt = result.data?.data?.[0]?.revised_prompt;
    if (!imageUrl) return res.status(502).json({ error: "No image URL in DALL-E response" });

    return res.status(200).json({ imageUrl, revisedPrompt });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
