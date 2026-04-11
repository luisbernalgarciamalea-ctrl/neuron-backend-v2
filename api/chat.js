// Neuron AI — /api/chat — GPT-4o primary with full fallback
const https = require("https");

const textProviders = [
  { name:"openai",   url:"https://api.openai.com/v1/chat/completions",                                                         key:()=>process.env.OPENAI_KEY,   model:"gpt-4o",                  type:"openai" },
  { name:"groq",     url:"https://api.groq.com/openai/v1/chat/completions",                                                    key:()=>process.env.GROQ_KEY,     model:"llama-3.3-70b-versatile", type:"openai" },
  { name:"deepseek", url:"https://api.deepseek.com/chat/completions",                                                          key:()=>process.env.DEEPSEEK_KEY, model:"deepseek-chat",           type:"openai" },
  { name:"gemini",   url:"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",           key:()=>process.env.GEMINI_KEY,   model:"gemini-1.5-flash",        type:"gemini" }
];

function getSystemPrompt(mode, language, searchResults) {
  const today = new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  const langNote = language && language !== "auto" ? `\nRespond in ${language}. All output must be in ${language}.` : "";
  const dateNote = `\nToday's date is ${today}. Your knowledge extends to April 2024. For anything after April 2024, use web search results if provided, or clearly state you may not have the latest information.`;

  let searchContext = "";
  if (searchResults && searchResults.length > 0) {
    searchContext = "\n\n## LIVE WEB SEARCH RESULTS (use these for current information):\n" +
      searchResults.map((r,i) => `[${i+1}] ${r.title}\n${r.snippet}\nSource: ${r.url}`).join("\n\n") +
      "\n\nCite sources by number [1], [2] etc. when using this information.";
  }

  const base = `You are Neuron AI — a brilliant, precision-tuned AI assistant created by Luis Bernal Garcia-Malea. You are powered by GPT-4o, one of the most capable AI models available.${dateNote}${langNote}`;

  const prompts = {
    chat: `${base}\n\nYou are in Chat mode. Be sharp, warm, and genuinely helpful. Adapt your tone. Give real direct answers. Use markdown formatting — headers, bold, bullets — when it helps clarity. Never pad responses with filler.${searchContext}`,

    research: `${base}\n\nYou are in Research mode — the world's best research assistant.\n\nFormat every response with:\n- A clear **Executive Summary** (2-3 sentences)\n- Organized sections with headers\n- Bullet points for key facts\n- **Pros & Cons** or comparisons when relevant\n- **Sources & Further Reading** when applicable\n\nBe thorough, accurate, and cite the web results when provided.${searchContext}`,

    docs: `${base}\n\nYou are in Docs mode. Write professional, polished documents. Use excellent structure:\n- Clear headings\n- Well-crafted paragraphs\n- Proper formatting for the requested document type\n\nMatch the tone: formal for business/legal, engaging for articles, academic for essays. Make every word count.${langNote}`,

    code: `${base}\n\nYou are in Code mode — a world-class senior software engineer.\n\nRules:\n1. Write clean, production-quality code with proper error handling\n2. Add concise inline comments on non-obvious logic\n3. For web: complete HTML+CSS+JS in ONE file, CSS in <style>, JS in <script>\n4. Return ONLY code — no markdown fences, no preamble\n5. Follow language best practices and modern conventions\n6. Include helpful variable names and structure\n\nAfter the code, add a brief ## Explanation section describing what it does and any important notes.`,

    math: `${base}\n\nYou are in Maths mode. For every problem:\n1. **Understand** — restate what's being asked\n2. **Plan** — outline the approach\n3. **Solve** — show every step clearly\n4. **Check** — verify the answer\n5. **Answer** — state the final answer clearly\n\nUse proper mathematical notation. Explain each step in plain language.${langNote}`,

    author: `${base}\n\nYou are in Book Writer mode — a bestselling professional author.\n\nWrite immersive, literary prose:\n- No headings, no outlines, no chapter labels — pure story\n- Vivid sensory detail, real emotion, authentic dialogue\n- Match the requested genre, style, and POV precisely\n- Vary sentence length for rhythm\n- If you hit an output limit, stop mid-sentence naturally\n\nThe writing must be indistinguishable from a published, award-winning author.`,

    designer: `${base}\n\nYou are in Book Designer mode — a top publishing house art director.\n\nReturn EXACTLY this format:\n\nFront cover concept:\n[Detailed visual description: imagery, typography style, color palette, mood, composition, what makes it commercially compelling]\n\nBack cover blurb:\n[Complete, polished marketing blurb that would appear on a real published book — compelling, genre-appropriate, ending with intrigue]`,

    poet: `${base}\n\nYou are in Poet mode — a celebrated poet and lyricist.\n\nWrite with:\n- Vivid, unexpected imagery\n- Emotional truth and resonance\n- Controlled rhythm (not forced rhyme unless requested)\n- Precise word choice — every word earns its place\n- A surprise or turn that elevates the piece\n\nNever be generic. Surprise the reader.${langNote}`,

    image: `${base}\n\nYou are an expert DALL-E prompt engineer. Transform the user's request into a highly detailed, optimized image generation prompt.\n\nInclude: visual style, lighting, composition, mood, color palette, technical details (lens, angle), and art direction.\n\nReturn ONLY the optimized prompt — nothing else.`,

    video: `${base}\n\nYou are a cinematic video director. Create a detailed, production-ready storyboard.\n\nFor each scene:\nSCENE [N] — [DURATION]s\nShot: [camera angle and movement]\nVisual: [what's on screen in detail]\nAudio: [music/SFX/dialogue]\nAction: [what happens]\nMood: [emotional tone]\n\nMake it cinematic, creative, and genuinely producible.${langNote}`,

    humanizer: `${base}\n\nYou are in AI Humanizer mode.\n\nRewrite the text to sound like a real, thoughtful human wrote it:\n- Vary sentence length (mix short punchy sentences with longer flowing ones)\n- Add subtle personality and natural rhythm\n- Remove AI patterns: excessive hedging, robotic transitions, hollow affirmations\n- Keep the full meaning and intent\n- Make it feel personal, not corporate\n\nReturn ONLY the rewritten text.${langNote}`,

    support: `${base}\n\nYou are in Support mode. Write professional, empathetic customer support replies:\n- Acknowledge the issue with genuine empathy\n- Provide a clear solution\n- Be human and warm, not robotic\n- End with a helpful follow-up offer\n\nTone: professional but approachable.${langNote}`
  };

  return prompts[mode] || prompts.chat;
}

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: { "Content-Type":"application/json", "Content-Length":Buffer.byteLength(data), ...headers }
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(28000, () => req.destroy(new Error("Timeout")));
    req.write(data); req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-neuron-dev-code");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  let mode, plan, language, messagesArr, searchResults;

  if (body.payload) {
    mode = body.mode || "chat";
    plan = body.payload.plan || "Free";
    language = body.payload.language || body.language || "auto";
    searchResults = body.payload.searchResults || [];
    const history = (body.payload.history || []).slice(-30);
    const message = body.payload.message || body.payload.prompt || "";
    messagesArr = [...history.map(h => ({ role: h.role, content: h.content })), { role: "user", content: message }];
  } else {
    mode = body.mode || "chat";
    plan = body.plan || "Free";
    language = body.language || "auto";
    searchResults = body.searchResults || [];
    messagesArr = body.messages || [];
  }

  if (!messagesArr.length) return res.status(400).json({ error: "No message provided" });

  const systemPrompt = getSystemPrompt(mode, language, searchResults);
  const fullMessages = [{ role: "system", content: systemPrompt }, ...messagesArr];
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
        if (result.status === 200) content = result.data?.choices?.[0]?.message?.content;
        else throw new Error("HTTP " + result.status + ": " + JSON.stringify(result.data?.error));
      }

      if (provider.type === "gemini") {
        const geminiMsgs = fullMessages.filter(m => m.role !== "system").map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));
        const result = await httpPost(
          provider.url + "?key=" + apiKey,
          { contents: [{ role: "user", parts: [{ text: systemPrompt }] }, ...geminiMsgs] },
          {}
        );
        content = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      }

      if (content) return res.status(200).json({ reply: content, content, provider: provider.name });

    } catch (err) {
      console.error("Provider " + provider.name + " failed:", err.message);
      lastError = err;
    }
  }

  return res.status(500).json({ error: "All providers failed", details: lastError?.message || "No valid API keys" });
};
