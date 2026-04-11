// Neuron AI — /api/search — Real web search via Serper.dev (Google)
const https = require("https");

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Timeout")));
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const query = req.query?.q || req.body?.q || "";
  if (!query) return res.status(400).json({ error: "No query provided" });

  const serperKey = process.env.SERPER_KEY;

  if (!serperKey) {
    // Return empty results if no key — frontend will handle gracefully
    return res.status(200).json({ results: [], noKey: true });
  }

  try {
    const result = await httpPost(
      "https://google.serper.dev/search",
      { q: query, num: 6 },
      { "X-API-KEY": serperKey }
    );

    if (result.status !== 200) {
      return res.status(502).json({ error: "Search failed", results: [] });
    }

    const organic = result.data?.organic || [];
    const results = organic.slice(0, 6).map(r => ({
      title: r.title || "",
      snippet: r.snippet || "",
      url: r.link || "",
      date: r.date || ""
    }));

    // Also include knowledge graph if available
    const kg = result.data?.knowledgeGraph;
    const answerBox = result.data?.answerBox;

    return res.status(200).json({ results, knowledgeGraph: kg || null, answerBox: answerBox || null });

  } catch (err) {
    console.error("Search error:", err.message);
    return res.status(500).json({ error: err.message, results: [] });
  }
};
