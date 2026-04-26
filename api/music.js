// Neuron AI — /api/music
// ElevenLabs Eleven Music API — free tier: 11 min/month
// Get free key: elevenlabs.io → Profile → API Keys
// Add as ELEVENLABS_KEY in Vercel environment variables
const https = require("https");

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(d), ...headers }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        try { resolve({ status: res.statusCode, data: JSON.parse(raw.toString()), isJson: true, raw }); }
        catch { resolve({ status: res.statusCode, data: raw, isJson: false, raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy(new Error("Timeout — ElevenLabs music can take up to 2 minutes")));
    req.write(d); req.end();
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
  const prompt = (body.prompt || "").trim();
  const lyrics = (body.lyrics || "").trim();
  const durationMs = Math.min(parseInt(body.durationMs) || 30000, 120000);

  if (!prompt) return res.status(400).json({ error: "No prompt provided" });

  const key = process.env.ELEVENLABS_KEY;
  if (!key) {
    return res.status(500).json({
      error: "No ElevenLabs key configured",
      fix: "Get a free key at elevenlabs.io → Profile → API Keys → Add as ELEVENLABS_KEY in Vercel"
    });
  }

  try {
    // Step 1: Create composition plan (free, no credits used)
    const planRes = await httpPost(
      "https://api.elevenlabs.io/v1/music/composition-plans",
      {
        prompt: lyrics ? `${prompt}. Lyrics: ${lyrics}` : prompt,
        duration_ms: durationMs
      },
      { "xi-api-key": key }
    );

    if (planRes.status !== 200 && planRes.status !== 201) {
      const msg = planRes.isJson ? (planRes.data?.detail || JSON.stringify(planRes.data)) : planRes.status;
      throw new Error("Plan creation failed: " + msg);
    }

    const plan = planRes.data;

    // Step 2: Compose music using the plan
    const composeRes = await httpPost(
      "https://api.elevenlabs.io/v1/music/compose",
      {
        composition_plan: plan,
        output_format: "mp3_44100_128"
      },
      { "xi-api-key": key }
    );

    if (composeRes.status === 200 && !composeRes.isJson) {
      // Got audio bytes directly
      const base64 = composeRes.raw.toString("base64");
      return res.status(200).json({ audio: base64, mimeType: "audio/mpeg", provider: "elevenlabs" });
    }

    if (composeRes.status === 200 && composeRes.isJson) {
      // May be a job ID (async)
      const jobId = composeRes.data?.id || composeRes.data?.job_id;
      if (!jobId) {
        // Try direct audio URL
        if (composeRes.data?.audio_url) {
          return res.status(200).json({ audioUrl: composeRes.data.audio_url, provider: "elevenlabs" });
        }
        throw new Error("No audio or job ID in response: " + JSON.stringify(composeRes.data).slice(0, 200));
      }

      // Poll for completion
      for (let attempt = 0; attempt < 12; attempt++) {
        await sleep(5000);
        const pollRes = await httpPost(
          `https://api.elevenlabs.io/v1/music/${jobId}`,
          {},
          { "xi-api-key": key }
        );
        if (pollRes.isJson && pollRes.data?.status === "complete") {
          const url = pollRes.data?.audio_url || pollRes.data?.url;
          if (url) return res.status(200).json({ audioUrl: url, provider: "elevenlabs" });
        }
        if (pollRes.isJson && pollRes.data?.status === "error") {
          throw new Error("Generation failed: " + (pollRes.data?.error || "unknown"));
        }
      }
      throw new Error("Timed out waiting for ElevenLabs — try again");
    }

    const errMsg = composeRes.isJson
      ? (composeRes.data?.detail?.message || composeRes.data?.detail || JSON.stringify(composeRes.data))
      : composeRes.status;
    throw new Error("Compose failed: " + errMsg);

  } catch (e) {
    console.error("Music error:", e.message);
    return res.status(502).json({ error: e.message });
  }
};
