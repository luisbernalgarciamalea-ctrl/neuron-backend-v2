// Neuron AI — /api/music
// Generates song lyrics and a production brief through Gemini.
// This does not generate an audio recording; use a separate licensed audio provider for that.

const https = require("https");

function postJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      }
    }, response => {
      let raw = "";
      response.on("data", chunk => { raw += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: response.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(55000, () => req.destroy(new Error("Music request timed out")));
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const prompt = String(body.prompt || body.description || "").trim().slice(0, 12000);
  const genre = String(body.genre || "modern pop").trim().slice(0, 120);
  const language = String(body.language || "English").trim().slice(0, 80);
  if (!prompt) return res.status(400).json({ error: "A song description is required" });
  if (!process.env.GEMINI_KEY) return res.status(503).json({ error: "Music provider is not configured" });

  const system = `You are Neuron AI's professional songwriter. Create original lyrics only. Do not imitate a living artist. Write in ${language}. Genre: ${genre}. Include [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], and [Outro]. Also include a short production brief after the lyrics.`;
  try {
    const result = await postJson(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(process.env.GEMINI_KEY),
      {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 3000 }
      }
    );
    if (result.status !== 200) {
      return res.status(502).json({ error: "Music generation provider failed", details: result.data?.error?.message || "Unknown provider error" });
    }
    const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(502).json({ error: "Music provider returned no lyrics" });
    return res.status(200).json({ lyrics: text, provider: "gemini-2.5-flash" });
  } catch (error) {
    return res.status(502).json({ error: "Music generation failed", details: error.message });
  }
};
