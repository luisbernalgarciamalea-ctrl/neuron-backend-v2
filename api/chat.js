// Neuron AI — /api/chat
// Uses only Node.js built-ins — no npm install needed

const https = require("https");

const textProviders = [
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: () => process.env.GROQ_KEY,
    model: "llama-3.3-70b-versatile",
    type: "openai"
  },
  {
    name: "deepseek",
    url: "https://api.deepseek.com/chat/completions",
    key: () => process.env.DEEPSEEK_KEY,
    model: "deepseek-chat",
    type: "openai"
  },
  {
    name: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    key: () => process.env.OPENAI_KEY,
    model: "gpt-4o-mini",
    type: "openai"
  },
  {
    name: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    key: () => process.env.GEMINI_KEY,
    model: "gemini-1.5-flash",
    type: "gemini"
  }
];

const modePrompts = {
  chat: "You are in general chat mode. Be helpful, concise, and conversational.",
  research: "You are in Research mode. Provide structured, detailed, accurate answers.",
  docs: "You are in Docs mode. Write professional, well-structured documents.",
  code: "You are in Code mode. Write clean, efficient code. Return raw code without markdown fences unless asked.",
  math: "You are in Maths mode. Solve problems step-by-step with full reasoning.",
  author: "You are in Book Writer mode. Write ONLY prose story text, no headings or outlines.",
  designer: "You are in Book Designer mode. Return 'Front cover concept:' and 'Back cover blurb:' sections.",
  poet: "You are in Poet mode. Write beautiful poems and lyrics matching the requested mood.",
  image: "You are in Image Generator mode. Vividly describe what the AI-generated image would look like.",
  video: "You are in Video Generator mode. Create a detailed storyboard with numbered scenes.",
  humanizer: "You are in AI Humanizer mode. Rewrite text to sound natural and authentically human.",
  support: "You are in Support mode. Write professional, empathetic customer support replies."
};

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(25000, () => { req.destroy(new Error("Timeout")); });
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-neuron-dev-code");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  let mode, plan, messagesArr;

  if (body.payload) {
    mode = body.mode || "chat";
    plan = body.payload.plan || "Free";
    const history = (body.payload.history || []).slice(-20);
    const message = body.payload.message || body.payload.prompt || "";
    messagesArr = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message }
    ];
  } else {
    mode = body.mode || "chat";
    plan = body.plan || "Free";
    messagesArr = body.messages || [];
  }

  if (!messagesArr.length) {
    return res.status(400).json({ error: "No message provided" });
  }

  const systemPrompt =
    "You are Neuron AI, a calm, precise, luxury-grade assistant created by Luis Bernal Garcia-Malea. " +
    "Your short name is Nix. Mode: " + mode + ". Plan: " + plan + ". " +
    (modePrompts[mode] || "");

  const fullMessages = [
    { role: "system", content: systemPrompt },
    ...messagesArr
  ];

  let lastError = null;

  for (const provider of textProviders) {
    const apiKey = provider.key();
    if (!apiKey || apiKey.includes("your_") || apiKey.length < 10) continue;

    try {
      let content;

      if (provider.type === "openai") {
        const result = await httpPost(
          provider.url,
          { model: provider.model, messages: fullMessages },
          { Authorization: "Bearer " + apiKey }
        );
        content = result.data?.choices?.[0]?.message?.content;
      }

      if (provider.type === "gemini") {
        const geminiMessages = fullMessages
          .filter(m => m.role !== "system")
          .map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          }));

        const result = await httpPost(
          provider.url + "?key=" + apiKey,
          { contents: [{ role: "user", parts: [{ text: systemPrompt }] }, ...geminiMessages] },
          {}
        );
        content = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      }

      if (content) {
        return res.status(200).json({
          reply: content,
          content: content,
          provider: provider.name
        });
      }
    } catch (err) {
      console.error("Provider " + provider.name + " failed:", err.message);
      lastError = err;
    }
  }

  return res.status(500).json({
    error: "All providers failed",
    details: lastError?.message || "No valid API keys configured"
  });
};
