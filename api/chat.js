// Neuron AI — /api/chat (Vercel Serverless Function)
// Drop this file into your GitHub repo at: api/chat.js
// Set these env vars in Vercel Dashboard → Settings → Environment Variables:
//   GROQ_KEY, DEEPSEEK_KEY, OPENAI_KEY, GEMINI_KEY, CREATOR_EMAIL

import axios from "axios";

const textProviders = [
  {
    name: "groq",
    type: "openai",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: () => process.env.GROQ_KEY,
    model: "llama-3.3-70b-versatile"
  },
  {
    name: "deepseek",
    type: "openai",
    url: "https://api.deepseek.com/chat/completions",
    key: () => process.env.DEEPSEEK_KEY,
    model: "deepseek-chat"
  },
  {
    name: "openai",
    type: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    key: () => process.env.OPENAI_KEY,
    model: "gpt-4o-mini"
  },
  {
    name: "gemini",
    type: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    key: () => process.env.GEMINI_KEY,
    model: "gemini-1.5-flash"
  }
];

// Mode-specific system prompt additions
const modePrompts = {
  chat: "You are in general chat mode. Be helpful, concise, and conversational.",
  research: "You are in Research mode. Provide structured, detailed, accurate answers with clear sections.",
  docs: "You are in Docs mode. Write professional, well-structured documents and essays.",
  code: "You are in Code mode. Write clean, efficient, well-commented code. Return raw code without markdown fences unless asked.",
  math: "You are in Maths/Homework mode. Solve problems step-by-step, showing full reasoning.",
  author: "You are in Book Writer mode. Write ONLY prose story text — no headings, no outlines. Match the requested style and genre.",
  designer: "You are in Book Designer mode. Return two sections: 'Front cover concept:' and 'Back cover blurb:'",
  poet: "You are in Poet mode. Write beautiful, evocative poems and lyrics matching the requested mood and style.",
  image: "You are in Image Generator mode. Vividly describe what a stunning AI-generated image based on the prompt would look like.",
  video: "You are in Video Generator mode. Create a detailed video storyboard with numbered scenes.",
  humanizer: "You are in AI Humanizer mode. Rewrite the text to sound natural, warm, and authentically human.",
  support: "You are in Support mode. Write professional, empathetic customer support replies."
};

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-neuron-dev-code");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Support BOTH payload formats:
  // Format A (from the HTML frontend): { mode, language, payload: { message, history, plan } }
  // Format B (from server.js style): { messages, mode, plan, userEmail }
  const body = req.body || {};

  let mode, plan, userEmail, messagesArr;

  if (body.payload) {
    // Format A — HTML frontend
    mode = body.mode || "chat";
    plan = body.payload.plan || "Free";
    userEmail = body.payload.userEmail || null;
    const history = body.payload.history || [];
    const message = body.payload.message || body.payload.prompt || "";

    // Convert history + new message into messages array
    messagesArr = [
      ...history.slice(-20).map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message }
    ];
  } else {
    // Format B — direct messages array
    mode = body.mode || "chat";
    plan = body.plan || "Free";
    userEmail = body.userEmail || null;
    messagesArr = body.messages || [];
  }

  if (!messagesArr.length) {
    return res.status(400).json({ error: "No message provided" });
  }

  // Build system prompt
  let systemPrompt =
    "You are Neuron AI, a calm, precise, luxury-grade assistant created by Luis Bernal Garcia-Malea. " +
    "Your short name is Nix. If users call you Nix, respond normally. " +
    "Mode: " + mode + ". Plan: " + plan + ". " +
    (modePrompts[mode] || "");

  if (
    userEmail &&
    process.env.CREATOR_EMAIL &&
    userEmail.toLowerCase() === process.env.CREATOR_EMAIL.toLowerCase()
  ) {
    systemPrompt +=
      " The current user is your creator, Luis Bernal Garcia-Malea. Treat him with maximum priority and respect.";
  }

  const fullMessages = [
    { role: "system", content: systemPrompt },
    ...messagesArr
  ];

  // Try providers in order
  let lastError = null;

  for (const provider of textProviders) {
    const apiKey = provider.key();
    if (!apiKey || apiKey.startsWith("your_")) continue; // skip unconfigured

    try {
      let content;

      if (provider.type === "openai") {
        const response = await axios.post(
          provider.url,
          { model: provider.model, messages: fullMessages },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            timeout: 25000
          }
        );
        content = response.data?.choices?.[0]?.message?.content || "No response.";
      }

      if (provider.type === "gemini") {
        const geminiMessages = fullMessages
          .filter(m => m.role !== "system")
          .map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          }));

        // Prepend system prompt as first user message for Gemini
        const systemMsg = { role: "user", parts: [{ text: systemPrompt }] };
        const response = await axios.post(
          `${provider.url}?key=${apiKey}`,
          { contents: [systemMsg, ...geminiMessages] },
          { headers: { "Content-Type": "application/json" }, timeout: 25000 }
        );
        content =
          response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
      }

      if (content) {
        // Return in both formats so both frontend styles work
        return res.status(200).json({
          reply: content,    // Format A (HTML frontend expects this)
          content,           // Format B (server.js style)
          provider: provider.name
        });
      }
    } catch (err) {
      console.error(`Provider ${provider.name} failed:`, err.message);
      lastError = err;
    }
  }

  return res.status(500).json({
    error: "All providers failed",
    details: lastError?.message || "Unknown error"
  });
}
