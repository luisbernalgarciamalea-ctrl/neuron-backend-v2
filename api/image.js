// Neuron AI — /api/image — DALL-E 3 image generation
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
    req.setTimeout(30000, () => { req.destroy(new Error("Timeout")); });
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

  const { prompt, size = "1024x1024", quality = "standard" } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "No prompt provided" });

  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) return res.status(500).json({ error: "OpenAI key not configured" });

  try {
    const result = await httpPost(
      "https://api.openai.com/v1/images/generations",
      {
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: size,
        quality: quality,
        response_format: "url"
      },
      { Authorization: "Bearer " + apiKey }
    );

    if (result.status !== 200) {
      console.error("DALL-E error:", result.data);
      return res.status(502).json({ error: "Image generation failed", detail: result.data?.error?.message || "Unknown" });
    }

    const imageUrl = result.data?.data?.[0]?.url;
    const revisedPrompt = result.data?.data?.[0]?.revised_prompt;

    return res.status(200).json({ imageUrl, revisedPrompt });
  } catch (err) {
    console.error("Image handler error:", err.message);
    return res.status(500).json({ error: "Internal error", detail: err.message });
  }
};
