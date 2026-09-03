// Neuron AI — /api/video
// Creates an asynchronous JSON2Video render job with AI-generated scene images.

const https = require("https");
const {
  applyCors,
  handleOptions,
  cleanText
} = require("./_security.js");

function httpRequest(url, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const data = body ? JSON.stringify(body) : null;

    const request = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
          ...(data
            ? { "Content-Length": Buffer.byteLength(data) }
            : {})
        }
      },
      response => {
        let raw = "";

        response.on("data", chunk => {
          raw += chunk;
        });

        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode,
              data: JSON.parse(raw)
            });
          } catch {
            resolve({
              status: response.statusCode,
              data: raw
            });
          }
        });
      }
    );

    request.on("error", reject);

    request.setTimeout(30000, () => {
      request.destroy(
        new Error("Video provider request timed out")
      );
    });

    if (data) request.write(data);
    request.end();
  });
}

function sceneDuration(header) {
  const match = String(header || "").match(
    /(\d+(?:\.\d+)?)\s*s\b/i
  );

  const seconds = match ? Number(match[1]) : 5;

  return Math.max(
    3,
    Math.min(
      20,
      Number.isFinite(seconds) ? seconds : 5
    )
  );
}

function labelledLine(lines, label) {
  const line = lines.find(item =>
    new RegExp("^" + label + ":", "i").test(item)
  );

  return line
    ? line
        .replace(
          new RegExp("^" + label + ":", "i"),
          ""
        )
        .trim()
    : "";
}

function buildScene(block, index) {
  const lines = block
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const header = lines[0] || "";
  const visual = labelledLine(lines, "Visual");
  const action = labelledLine(lines, "Action");
  const mood = labelledLine(lines, "Mood");
  const audio = labelledLine(lines, "Audio");

  const duration = sceneDuration(header);

  const fallbackDescription = lines
    .filter(line =>
      !/^(Shot|Visual|Audio|Action|Mood):/i.test(line)
    )
    .join(" ");

  const prompt = [
    visual,
    action,
    mood,
    fallbackDescription
  ]
    .filter(Boolean)
    .join(". ")
    .slice(0, 900) ||
    `Cinematic scene ${index + 1} for a Neuron AI video`;

  const elements = [
    {
      type: "image",
      model: "flux-schnell",
      prompt:
        `${prompt}. Cinematic, professional, high detail, ` +
        `coherent composition, no text or logos.`,
      "aspect-ratio": "horizontal",
      resize: "fill",
      duration,
      zoom: 2,
      pan: index % 2 ? "left" : "right"
    },
    {
      type: "text",
      text: `Scene ${index + 1}`,
      style: "002",
      duration,
      position: "top-left",
      x: 50,
      y: 40
    }
  ];

  if (audio && audio.toLowerCase() !== "none") {
    elements.push({
      type: "text",
      text: audio.slice(0, 90),
      style: "002",
      duration,
      position: "bottom-left",
      x: 50,
      y: -45
    });
  }

  return {
    comment: `Scene ${index + 1}`,
    duration,
    transition: {
      style: "fade",
      duration: 0.5
    },
    elements
  };
}

module.exports = async function handler(req, res) {
  applyCors(req, res, "POST, OPTIONS");

  if (handleOptions(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const body = req.body || {};
  const storyboard = cleanText(
    body.storyboard,
    24000
  );
  const title = cleanText(
    body.title,
    200
  ) || "Neuron AI Video";

  if (!storyboard) {
    return res.status(400).json({
      error: "No storyboard provided"
    });
  }

  const apiKey = process.env.JSON2VIDEO_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "No JSON2Video key configured",
      fix:
        "Add JSON2VIDEO_KEY to your Vercel environment variables"
    });
  }

  const sceneMatches = storyboard.match(
    /SCENE\s+(?:\[\s*)?\d+(?:\s*\])?[^\n]*\n([\s\S]*?)(?=SCENE\s+(?:\[\s*)?\d+(?:\s*\])?|$)/gi
  ) || [];

  const scenes = sceneMatches
    .slice(0, 8)
    .map((block, index) =>
      buildScene(block, index)
    );

  if (!scenes.length) {
    scenes.push(
      buildScene(
        `SCENE 1 — 5s\nVisual: A cinematic opening shot inspired by ${title}`,
        0
      )
    );
  }

  try {
    const createResponse = await httpRequest(
      "https://api.json2video.com/v2/movies",
      "POST",
      {
        resolution: "full-hd",
        quality: "high",
        scenes
      },
      {
        "x-api-key": apiKey
      }
    );

    if (
      createResponse.status !== 200 &&
      createResponse.status !== 201
    ) {
      throw new Error(
        "Video creation failed: " +
          JSON.stringify(createResponse.data).slice(0, 400)
      );
    }

    const projectId =
      createResponse.data?.project ||
      createResponse.data?.movie?.project;

    if (!projectId) {
      throw new Error(
        "No video project ID returned: " +
          JSON.stringify(createResponse.data).slice(0, 400)
      );
    }

    return res.status(202).json({
      status: "processing",
      projectId,
      provider: "json2video",
      message: "Video render started"
    });
  } catch (error) {
    console.error("Video error:", error.message);

    return res.status(502).json({
      error: error.message
    });
  }
};
