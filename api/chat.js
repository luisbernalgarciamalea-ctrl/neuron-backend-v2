// Neuron AI — /api/chat
// 100% Google Gemini — free, no credit card needed
// Get keys at aistudio.google.com — add up to 15: GEMINI_KEY, GEMINI_KEY_1 … GEMINI_KEY_15
const https = require("https");

const CREATOR_EMAIL = "luis.bernaliswestpfalz.de@gmail.com";

function getGeminiKeys() {
  const keys = [];
  const main = process.env.GEMINI_KEY;
  if (main && main.length > 8) keys.push(main);
  for (let i = 1; i <= 15; i++) {
    const k = process.env[`GEMINI_KEY_${i}`];
    if (k && k.length > 8 && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

let kidx = 0;
function nextKey(keys) {
  if (!keys.length) return null;
  const k = keys[kidx % keys.length];
  kidx++;
  return k;
}

function getSystemPrompt(mode, language, searchResults, isCreator) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
  const lang = language && language !== "auto"
    ? `\nIMPORTANT: You MUST respond ENTIRELY in ${language}. Every single word of your output must be in ${language}.` : "";
  const creat = isCreator
    ? `\n\n⚡ CREATOR: The user is Luis Bernal Garcia-Malea — he BUILT and CREATED you. Maximum respect, warmth, and your absolute best work. Address him personally.` : "";
  const date = `\nToday is ${today}.`;

  let src = "";
  if (searchResults && searchResults.length > 0) {
    src = "\n\n## LIVE WEB RESULTS — cite as [1],[2] etc:\n" +
      searchResults.map((r, i) => `[${i+1}] ${r.title}: ${r.snippet}`).join("\n");
  }

  const base = `You are Neuron AI — a brilliant, luxury-grade AI assistant created by Luis Bernal Garcia-Malea.${date}${lang}${creat}`;

  const p = {
    chat:         `${base}\nBe sharp, warm, direct. Use markdown. Never pad.${src}`,
    research:     `${base}\nResearch mode. **Executive Summary** → sections → **Key Facts** → Sources [N]. Thorough.${src}`,
    docs:         `${base}\nDocs mode. Polished professional documents. Clear structure and precise language.`,
    code:         `${base}\nCode mode — senior engineer. Clean production code with error handling. For web: complete HTML+CSS+JS in ONE file. Return code then ## How it works.`,
    math:         `${base}\nMaths. Steps: **Understand → Plan → Solve (show every step) → Check → Final Answer**. Clear notation.`,
    author:       `${base}\nBook Writer. Pure immersive prose only. No headings. Vivid detail, real emotion. Stop mid-sentence if needed.`,
    script:       `${base}\nScript Writer. SCREENPLAY (INT./EXT., CAPS names), YOUTUBE ([TIMESTAMP],[B-ROLL:]), PODCAST (HOST/GUEST). Default: YouTube. Production-ready.`,
    designer:     `${base}\nBook Designer.\n\nFront cover concept:\n[imagery, typography, hex colors, composition, mood]\n\nBack cover blurb:\n[100-150 word polished marketing blurb]`,
    poet:         `${base}\nPoet. Vivid imagery, emotional truth, precise words. Never generic. Surprise the reader.`,
    image:        `${base}\nImage prompt engineer. Highly detailed prompt: subject, style, lighting, composition, mood, color palette, camera angle. Return ONLY the optimized prompt.`,
    video:        `${base}\nVideo Director. CONCEPT first. Then SCENE [N] — [DURATION]s: Shot/Visual/Audio/Action/Mood. Cinematic and production-ready.`,
    humanizer:    `${base}\nHumanizer. Rewrite to sound naturally human. Vary sentence length. Remove AI tells. Return ONLY rewritten text.`,
    logo:         `${base}\nLogo Designer. 2-3 distinct concepts. Each:\n## Concept [N]: [Name]\n**Tagline/Symbol/Colors(hex)/Typography/AI Image Prompt:**`,
    presentation: `${base}\nPresentation. Each slide:\n---\n## SLIDE [N]: TITLE\n**Layout/Key Content/Visual Element/Speaker Notes:**\n---`,
    business:     `${base}\nBusiness Consultant. **Situation → Options → Recommendation → Steps → Risks → Next Actions**. Concrete and specific.`,
    support:      `${base}\nSupport. Empathetic, solution-focused, warm, complete resolution.`
  };
  return p[mode] || p.chat;
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(d) }
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Timeout")));
    req.write(d);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  let mode, plan, language, msgs, searchResults, userEmail;

  if (body.payload) {
    mode = body.mode || "chat"; plan = body.payload.plan || "Free";
    language = body.payload.language || "auto"; searchResults = body.payload.searchResults || [];
    userEmail = body.payload.userEmail || "";
    const hist = (body.payload.history || []).slice(-30);
    const msg = body.payload.message || "";
    msgs = [...hist.map(h => ({ role: h.role, content: h.content })), { role: "user", content: msg }];
  } else {
    mode = body.mode || "chat"; plan = body.plan || "Free";
    language = body.language || "auto"; searchResults = body.searchResults || [];
    userEmail = body.userEmail || ""; msgs = body.messages || [];
  }

  if (!msgs.length) return res.status(400).json({ error: "No message provided" });

  const isCreator = userEmail.toLowerCase() === CREATOR_EMAIL.toLowerCase();
  const system = getSystemPrompt(mode, language, searchResults, isCreator);
  const maxTok = plan === "Premium" ? 8192 : plan === "Pro" ? 4096 : 2048;

  // Premium gets best available model, Free/Pro gets Flash
  // Fallback chain in case a model isn't available in the region
  const premiumModels = ["gemini-2.5-pro-preview", "gemini-2.0-pro-exp", "gemini-2.5-flash"];
  const freeModels    = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"];
  const modelList = plan === "Premium" ? premiumModels : freeModels;

  // Convert messages to Gemini format
  const contents = [];
  for (const m of msgs) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    });
  }

  const keys = getGeminiKeys();
  if (!keys.length) {
    return res.status(500).json({
      error: "No Gemini API keys configured",
      fix: "Go to aistudio.google.com → Get API Key → Add as GEMINI_KEY in Vercel Environment Variables"
    });
  }

  let lastErr = null;

  for (let i = 0; i < keys.length; i++) {
    const key = nextKey(keys);
    try {
      // Try each model in the list for this key
      let keySucceeded = false;
      for (const model of modelList) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const r = await httpPost(url, {
            system_instruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { maxOutputTokens: maxTok, temperature: 0.7 }
          });

          if (r.status === 200) {
            const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              return res.status(200).json({ reply: text, content: text, provider: `gemini-${model}` });
            }
            const reason = r.data?.candidates?.[0]?.finishReason;
            if (reason === "SAFETY") throw new Error("Content blocked by safety filter");
            throw new Error("Empty response");
          }

          const errMsg = (r.data?.error?.message || JSON.stringify(r.data)).slice(0, 150);
          // 404 = model not found, try next model
          if (r.status === 404) { console.warn(`Model ${model} not found, trying next`); continue; }
          // 429 = rate limit, break to next key
          if (r.status === 429) { lastErr = new Error(`HTTP 429: ${errMsg}`); keySucceeded = false; break; }
          // 400 = bad request
          if (r.status === 400) throw new Error(`HTTP 400: ${errMsg}`);
          lastErr = new Error(`HTTP ${r.status}: ${errMsg}`);
        } catch(modelErr) {
          if (modelErr.message.includes("429")) { lastErr = modelErr; break; }
          lastErr = modelErr;
          // continue to next model
        }
      }
      if (keySucceeded) break;

    } catch (e) {
      console.error(`Gemini key ${i+1} error:`, e.message);
      lastErr = e;
    }
  }

  return res.status(500).json({
    error: "All Gemini keys failed",
    details: lastErr?.message || "Unknown error",
    keysConfigured: keys.length,
    fix: lastErr?.message?.includes("429")
      ? "Rate limit hit on all keys. Add more keys from aistudio.google.com (each Google account = 1 free key)."
      : "Check your Gemini keys at aistudio.google.com"
  });
};
