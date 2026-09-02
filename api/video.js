// Neuron AI — /api/video
// Creates an asynchronous JSON2Video render job.

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
            ? {
                "Content-Length": Buffer.byteLength(data)
              }
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

    if (data) {
      request.write(data);
    }

    request.end();
  });
}

module.exports = async function handler(req, res) {
  applyCors(req, res, "POST, OPTIONS");

  if (handleOptions(req, res)) {
    return;
  }

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

  const title =
    cleanText(body.title, 200) ||
    "Neuron AI Video";

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

  const sceneMatches =
    storyboard.match(
      /SCENE\s+(?:\[\s*)?\d+(?:\s*\])?[^\n]*\n([\s\S]*?)(?=SCENE\s+(?:\[\s*)?\d+(?:\s*\])?|$)/gi
    ) || [];

  const scenes = sceneMatches
    .slice(0, 6)
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      const visualLine = lines.find(line =>
        /^Visual:/i.test(line)
      );

      const audioLine = lines.find(line =>
        /^Audio:/i.test(line)
      );

      const visual = visualLine
        ? visualLine.replace(/^Visual:/i, "").trim()
        : `Scene ${index + 1}`;

      const audio = audioLine
        ? audioLine.replace(/^Audio:/i, "").trim()
        : "";

      const elements = [
        {
          type: "text",
          text: visual.slice(0, 100),
          style: "002",
          duration: 5,
          position: "center-bottom"
        }
      ];

      if (audio && audio.toLowerCase() !== "none") {
        elements.push({
          type: "text",
          text: "Audio: " + audio.slice(0, 80),
          style: "002",
          duration: 5,
          position: "bottom"
        });
      }

      return {
        comment: `Scene ${index + 1}`,
        duration: 5,
        elements
      };
    });

  if (!scenes.length) {
    scenes.push({
      comment: "Title",
      duration: 5,
      elements: [
        {
          type: "text",
          text: title,
          style: "005",
          duration: 5,
          position: "center"
        }
      ]
    });
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
          JSON.stringify(createResponse.data).slice(0, 300)
      );
    }

    // JSON2Video returns "project".
    const projectId =
      createResponse.data?.project ||
      createResponse.data?.movie;

    if (!projectId) {
      throw new Error(
        "No video project ID returned: " +
          JSON.stringify(createResponse.data)
      );
    }

    // Return immediately. Do not wait inside Vercel,
    // otherwise the function times out.
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
