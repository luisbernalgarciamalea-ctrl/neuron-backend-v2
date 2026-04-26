// Neuron AI — /api/video
// json2video.com — free tier (with watermark), no credit card needed
// Get free key: json2video.com → Sign up → Dashboard → API Key
// Add as JSON2VIDEO_KEY in Vercel environment variables
const https = require("https");

function httpReq(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { "Content-Type": "application/json", ...(d ? { "Content-Length": Buffer.byteLength(d) } : {}), ...headers }
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, data: raw }); } });
    });
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy(new Error("Timeout")));
    if (d) req.write(d);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const storyboard = (body.storyboard || "").trim();
  const title = (body.title || "Neuron AI Video").trim();

  if (!storyboard) return res.status(400).json({ error: "No storyboard provided" });

  const key = process.env.JSON2VIDEO_KEY;
  if (!key) {
    return res.status(500).json({
      error: "No json2video key configured",
      fix: "Get a free key at json2video.com → Sign up → Add as JSON2VIDEO_KEY in Vercel"
    });
  }

  // Parse the storyboard into scenes
  // Storyboard format: SCENE N — Xs\nVisual: ...\nAudio: ...
  const sceneMatches = storyboard.match(/SCENE\s+\d+[^\n]*\n([\s\S]*?)(?=SCENE\s+\d+|$)/gi) || [];

  const scenes = sceneMatches.slice(0, 6).map((block, i) => {
    const lines = block.split('\n').filter(l => l.trim());
    const visual = lines.find(l => l.startsWith('Visual:'))?.replace('Visual:', '').trim() || `Scene ${i + 1}`;
    const audio = lines.find(l => l.startsWith('Audio:'))?.replace('Audio:', '').trim() || '';

    return {
      comment: `Scene ${i + 1}`,
      duration: 5,
      elements: [
        {
          type: "text",
          text: visual.slice(0, 100),
          style: "002",
          duration: 5,
          position: "center-bottom"
        },
        ...(audio ? [{
          type: "text",
          text: "🎵 " + audio.slice(0, 80),
          style: "002",
          duration: 5,
          position: "bottom"
        }] : [])
      ]
    };
  });

  // If no scenes parsed, make a simple title card
  if (!scenes.length) {
    scenes.push({
      comment: "Title",
      duration: 5,
      elements: [{ type: "text", text: title, style: "005", duration: 5, position: "center" }]
    });
  }

  try {
    // Create the video
    const createRes = await httpReq(
      "https://api.json2video.com/v2/movies",
      "POST",
      { resolution: "full-hd", quality: "high", scenes },
      { "x-api-key": key }
    );

    if (createRes.status !== 200 && createRes.status !== 201) {
      throw new Error("Video creation failed: " + JSON.stringify(createRes.data).slice(0, 200));
    }

    const movieId = createRes.data?.movie;
    if (!movieId) throw new Error("No movie ID returned: " + JSON.stringify(createRes.data));

    // Poll for completion (json2video renders asynchronously)
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(6000);
      const pollRes = await httpReq(
        `https://api.json2video.com/v2/movies?project=${movieId}`,
        "GET", null,
        { "x-api-key": key }
      );

      if (pollRes.status === 200) {
        const movie = Array.isArray(pollRes.data?.movies) ? pollRes.data.movies[0] : pollRes.data;
        const status = movie?.status;

        if (status === "done") {
          const videoUrl = movie?.url || movie?.movie_url;
          if (videoUrl) {
            return res.status(200).json({ videoUrl, movieId, provider: "json2video" });
          }
        }
        if (status === "error") {
          throw new Error("Video render failed: " + (movie?.error || "unknown error"));
        }
      }
    }

    throw new Error("Render timed out — json2video may be busy. Try again in a moment.");

  } catch (e) {
    console.error("Video error:", e.message);
    return res.status(502).json({ error: e.message });
  }
};
