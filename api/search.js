// Neuron AI — /api/search
// Uses Serper.dev (Google) if SERPER_KEY is set, otherwise DuckDuckGo (free, no key)
const https = require("https");

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = { hostname: url.hostname, path: url.pathname + url.search, method: "GET", headers: { "User-Agent": "NeuronAI/1.0" } };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, data: raw }); } });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("Timeout")));
    req.end();
  });
}

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const opts = { hostname: url.hostname, path: url.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers } };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, data: raw }); } });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("Timeout")));
    req.write(data); req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q = req.query?.q || req.body?.q || "";
  if (!q) return res.status(400).json({ error: "No query", results: [] });

  try {
    // Try Serper first (Google results, needs free API key from serper.dev)
    if (process.env.SERPER_KEY) {
      const r = await httpPost("https://google.serper.dev/search",
        { q, num: 6, gl: "us", hl: "en" },
        { "X-API-KEY": process.env.SERPER_KEY }
      );
      if (r.status === 200 && r.data?.organic) {
        const results = r.data.organic.slice(0, 6).map(x => ({ title: x.title || "", snippet: x.snippet || "", url: x.link || "", date: x.date || "" }));
        return res.status(200).json({ results, source: "serper" });
      }
    }

    // Fallback: DuckDuckGo Instant Answers API (free, no key, limited but works)
    const ddgUrl = "https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_redirect=1&no_html=1&skip_disambig=1";
    const ddg = await httpGet(ddgUrl);

    const results = [];
    if (ddg.data?.RelatedTopics) {
      for (const t of ddg.data.RelatedTopics.slice(0, 6)) {
        if (t.Text && t.FirstURL) {
          results.push({ title: t.Text.split(" - ")[0] || t.Text.slice(0, 60), snippet: t.Text, url: t.FirstURL, date: "" });
        } else if (t.Topics) {
          for (const sub of t.Topics.slice(0, 2)) {
            if (sub.Text && sub.FirstURL) results.push({ title: sub.Text.slice(0, 60), snippet: sub.Text, url: sub.FirstURL, date: "" });
          }
        }
      }
    }
    // Also add abstract if available
    if (ddg.data?.AbstractText && ddg.data?.AbstractURL) {
      results.unshift({ title: ddg.data.Heading || q, snippet: ddg.data.AbstractText, url: ddg.data.AbstractURL, date: "" });
    }

    return res.status(200).json({ results: results.slice(0, 6), source: "duckduckgo" });

  } catch (err) {
    console.error("Search error:", err.message);
    return res.status(200).json({ results: [], error: err.message });
  }
};
