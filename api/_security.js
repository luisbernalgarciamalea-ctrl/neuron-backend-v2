// Shared safety helpers for Neuron serverless functions.
// This file contains no secrets.

function allowedOrigins() {
  return String(process.env.FRONTEND_ORIGIN || process.env.FRONTEND_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function applyCors(req, res, methods) {
  const origin = req.headers?.origin || "";
  const origins = allowedOrigins();

  // During migration, an empty setting preserves compatibility. Once the
  // frontend is deployed, set FRONTEND_ORIGIN to remove wildcard CORS.
  if (!origins.length) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-store");
}

function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function cleanText(value, maxLength = 24000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-30).map(item => ({
    role: item?.role === "assistant" ? "assistant" : "user",
    content: cleanText(item?.content, 12000)
  })).filter(item => item.content);
}

function cleanSearchResults(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map(item => ({
    title: cleanText(item?.title, 300),
    snippet: cleanText(item?.snippet, 1200),
    url: cleanText(item?.url, 1000),
    date: cleanText(item?.date, 80)
  })).filter(item => item.title || item.snippet || item.url);
}

module.exports = { applyCors, handleOptions, cleanText, cleanHistory, cleanSearchResults };
