// Neuron AI — /api/health
// Safe diagnostic endpoint. It never returns provider keys.

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const providers = {
    gemini: Boolean(process.env.GEMINI_KEY),
    search: Boolean(process.env.SERPER_KEY) || true, // DuckDuckGo fallback is always available
    video: Boolean(process.env.JSON2VIDEO_KEY),
    database: Boolean(process.env.MONGO_URI || process.env.MONGO_DATA_API_URL)
  };

  return res.status(200).json({
    ok: true,
    service: "neuron-backend-v2",
    timestamp: new Date().toISOString(),
    providers
  });
};
