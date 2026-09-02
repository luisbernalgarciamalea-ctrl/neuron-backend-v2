// Neuron AI — /api/video-status
// Checks an asynchronous JSON2Video render.

const https = require("https");
const {
  applyCors,
  handleOptions,
  cleanText
} = require("./_security.js");

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const request = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers
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

    request.setTimeout(15000, () => {
      request.destroy(
        new Error("Video status request timed out")
      );
    });

    request.end();
  });
}

module.exports = async function handler(req, res) {
  applyCors(req, res, "GET, OPTIONS");

  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const projectId = cleanText(
    req.query?.project,
    160
  );

  if (!projectId) {
    return res.status(400).json({
      error: "project is required"
    });
  }

  const apiKey = process.env.JSON2VIDEO_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "No JSON2Video key configured"
    });
  }

  try {
    const result = await httpGet(
      "https://api.json2video.com/v2/movies?project=" +
        encodeURIComponent(projectId),
      {
        "x-api-key": apiKey
      }
    );

    if (result.status !== 200) {
      return res.status(502).json({
        status: "processing",
        projectId,
        error: "Video provider status unavailable"
      });
    }

    const movie = Array.isArray(
      result.data?.movies
    )
      ? result.data.movies[0]
      : result.data;

    const status = String(
      movie?.status || "processing"
    ).toLowerCase();

    if (status === "done") {
      const videoUrl =
        movie?.url ||
        movie?.movie_url ||
        movie?.video_url;

      if (videoUrl) {
        return res.status(200).json({
          status: "done",
          projectId,
          videoUrl,
          provider: "json2video"
        });
      }
    }

    if (status === "error") {
      return res.status(200).json({
        status: "error",
        projectId,
        error:
          movie?.error ||
          "Video render failed"
      });
    }

    return res.status(200).json({
      status: status || "processing",
      projectId
    });
  } catch (error) {
    return res.status(502).json({
      status: "processing",
      projectId,
      error: error.message
    });
  }
};
