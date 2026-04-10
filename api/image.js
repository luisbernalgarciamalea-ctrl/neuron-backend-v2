// Neuron AI — /api/chat — GPT-4o primary, full provider fallback
const https = require("https");

const textProviders = [
  {
    name: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    key: () => process.env.OPENAI_KEY,
    model: "gpt-4o",
    type: "openai"
  },
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
    name: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    key: () => process.env.GEMINI_KEY,
    model: "gemini-1.5-flash",
    type: "gemini"
  }
];

const modePrompts = {
  chat: `You are Neuron, a brilliant and warm AI assistant. You are sharp, clear, and genuinely helpful.
You adapt your tone to the user — casual when they're casual, precise when they need precision.
You give real, direct answers. You never pad with filler. You are powered by GPT-4o.`,

  research: `You are Neuron in Research mode, powered by GPT-4o.
Produce structured, accurate, thorough research. Use clear sections, cite your reasoning, give pros/cons where relevant.
Format with headers and bullet points when helpful. Be the smartest researcher in the room.`,

  docs: `You are Neuron in Docs mode, powered by GPT-4o.
Write professional, polished documents, essays, and reports. Use excellent structure and clear prose.
Adapt to the requested format — formal, academic, business, or creative. Make every word count.`,

  code: `You are Neuron in Code mode, powered by GPT-4o.
You are a senior software engineer. Write clean, efficient, well-structured code.
For web requests: produce complete HTML+CSS+JS in a single file.
Return ONLY the code — no explanations, no markdown fences unless asked.
Always use best practices, proper error handling, and clear naming.`,

  math: `You are Neuron in Maths mode, powered by GPT-4o.
Solve problems step by step. Show your full working. Explain each step clearly.
Use clean notation. Check your answer at the end. Make it easy to follow.`,

  author: `You are Neuron in Book Writer mode, powered by GPT-4o.
Write immersive, professional prose. No headings, no outlines — just pure story.
Match the genre, style, and pacing exactly. Create vivid scenes, real characters, genuine emotion.
If you hit a limit, stop mid-sentence. The writing should be indistinguishable from a published author.`,

  designer: `You are Neuron in Book Designer mode, powered by GPT-4o.
Create compelling, commercial book cover concepts. Think like a top publishing house art director.
Return exactly two sections:
Front cover concept: [detailed visual concept including imagery, typography style, color palette, mood]
Back cover blurb: [complete, polished marketing blurb that would appear on a real book]`,

  poet: `You are Neuron in Poet mode, powered by GPT-4o.
Write beautiful, original poetry and lyrics. Use vivid imagery, rhythm, and emotional resonance.
Match the requested style and mood precisely. Never be generic — surprise the reader.`,

  image: `You are Neuron in Image mode. The user wants an image generated.
Write a detailed, vivid DALL-E prompt that will produce a stunning image.
Be specific about: style, lighting, composition, mood, colors, and subject.
Return ONLY the optimized prompt, nothing else.`,

  video: `You are Neuron in Video Director mode, powered by GPT-4o.
Create a detailed, professional video storyboard. Format each scene clearly:

SCENE [N] — [DURATION]
Visual: [detailed shot description]
Camera: [camera movement and angle]
Audio: [music/SFX/dialogue]
Action: [what happens]

Make it cinematic, creative, and production-ready.`,

  humanizer: `You are Neuron in AI Humanizer mode, powered by GPT-4o.
Rewrite text to sound natural, warm, and authentically human.
Vary sentence length. Add personality. Remove robotic phrasing and AI patterns.
Keep the original meaning intact. The result should feel like a real person wrote it.`,

  support: `You are Neuron in Support mode, powered by GPT-4o.
Write professional, empathetic, solution-focused customer support replies.
Be human, warm, and genuinely helpful. Resolve the issue clearly and offer follow-up if needed.`
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
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(28000, () => { req.destroy(new Error("Timeout")); });
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-neuron-dev-code");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  let mode, plan, messagesArr;

  if (body.payload) {
    mode = body.mode || "chat";
    plan = body.payload.plan || "Free";
    const history = (body.payload.history || []).slice(-30);
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

  if (!messagesArr.length) return res.status(400).json({ error: "No message provided" });

  const systemPrompt = modePrompts[mode] || modePrompts.chat;
  const fullMessages = [{ role: "system", content: systemPrompt }, ...messagesArr];

  // Premium/Pro get higher token limits
  const maxTokens = plan === "Premium" ? 4096 : plan === "Pro" ? 3000 : 2048;

  let lastError = null;

  for (const provider of textProviders) {
    const apiKey = provider.key();
    if (!apiKey || apiKey.length < 10) continue;

    try {
      let content;

      if (provider.type === "openai") {
        const result = await httpPost(
          provider.url,
          { model: provider.model, messages: fullMessages, max_tokens: maxTokens },
          { Authorization: "Bearer " + apiKey }
        );
        if (result.status === 200) {
          content = result.data?.choices?.[0]?.message?.content;
        } else {
          throw new Error("HTTP " + result.status + ": " + JSON.stringify(result.data?.error));
        }
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
        return res.status(200).json({ reply: content, content, provider: provider.name });
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
