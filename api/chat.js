// Neuron AI — /api/chat v9
// Rotates through up to 15 OpenAI keys, Groq as final fallback
const https = require("https");

const CREATOR_EMAIL = "luis.bernaliswestpfalz.de@gmail.com";

// ── Key pool: reads OPENAI_KEY + OPENAI_KEY_1 … OPENAI_KEY_15 ──────────────
function getOpenAIKeys() {
  const keys = [];
  if (process.env.OPENAI_KEY && process.env.OPENAI_KEY.length > 10) {
    keys.push(process.env.OPENAI_KEY);
  }
  for (let i = 1; i <= 15; i++) {
    const k = process.env[`OPENAI_KEY_${i}`];
    if (k && k.length > 10 && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

let keyIndex = 0;
function getNextOpenAIKey(keys) {
  if (!keys.length) return null;
  keyIndex = keyIndex % keys.length;
  const key = keys[keyIndex++];
  return key;
}

// ── System prompts ───────────────────────────────────────────────────────────
function getSystemPrompt(mode, language, searchResults, isCreator) {
  const today = new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  const lang  = language && language !== "auto" ? `\nYou MUST respond entirely in ${language}. Every word of output must be in ${language}.` : "";
  const date  = `\nToday is ${today}. Your training knowledge extends to early 2025.`;
  const creat = isCreator ? `\n\n⚡ CREATOR DIRECTIVE: The user you are speaking with is Luis Bernal Garcia-Malea — the person who CREATED and BUILT you. This is your creator. Treat him with the highest respect, warmth, and personal attention. Address him by name when natural. Give him your absolute best work.` : "";

  let src = "";
  if (searchResults && searchResults.length > 0) {
    src = "\n\n## LIVE WEB SEARCH RESULTS — cite as [1],[2] etc:\n" +
      searchResults.map((r,i)=>`[${i+1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`).join("\n\n");
  }

  const base = `You are Neuron AI — a brilliant, luxury-grade AI assistant created by Luis Bernal Garcia-Malea. Powered by GPT-4o.${date}${lang}${creat}`;

  const p = {
    chat:`${base}\nChat mode. Be sharp, warm, direct. Adapt tone to user. Use markdown formatting. Never pad with filler.${src}`,
    research:`${base}\nResearch mode — world-class analyst. Format: **Executive Summary** → Sections with headers → Key Facts → Sources cited [N]. Be thorough and accurate.${src}`,
    docs:`${base}\nDocs mode. Write polished professional documents. Match requested format and tone. Clear headings, precise language.${lang}`,
    code:`${base}\nCode mode — senior engineer. Rules:\n1. Clean production code with error handling\n2. Brief inline comments on non-obvious logic\n3. For web: complete HTML+CSS+JS in ONE file\n4. Return code first, then a brief ## How it works section\n5. Follow language best practices. Never write incomplete code.`,
    math:`${base}\nMaths mode. Steps: **1-Understand** **2-Plan** **3-Solve** (every step shown) **4-Check** **5-Final Answer**. Clear notation, plain language explanations.${lang}`,
    author:`${base}\nBook Writer. Pure immersive prose only. No headings, no outlines. Vivid detail, real emotion, authentic dialogue. Vary sentence length. Stop mid-sentence if you hit the limit.`,
    script:`${base}\nScript Writer. Professional industry format.\nSCREENPLAY: INT./EXT. LOCATION — TIME, CHARACTER NAME (CAPS), dialogue, action in present tense.\nYOUTUBE: [TIMESTAMP] sections, [B-ROLL:] cues, host dialogue.\nPODCAST: HOST/GUEST labels, [MUSIC]/[SFX] cues.\nDefault: YouTube script. Make it production-ready and engaging.${lang}`,
    designer:`${base}\nBook Designer. Return EXACTLY:\n\nFront cover concept:\n[Detailed visual: imagery, typography style, hex color palette, composition, mood, why it works commercially]\n\nBack cover blurb:\n[Complete polished marketing blurb, 100-150 words, as it would appear on a real published book]`,
    poet:`${base}\nPoet. Vivid unexpected imagery, emotional truth, precise word choice, controlled rhythm. Never be generic. Surprise the reader with a turn or revelation.${lang}`,
    image:`${base}\nImage prompt optimizer. Transform the request into a highly detailed DALL-E 3 prompt. Include: subject, art style, lighting, composition, mood, color palette, camera angle. Return ONLY the optimized prompt.`,
    video:`${base}\nVideo Director. Create complete concept + storyboard.\nCONCEPT: [style, tone, length, audience]\nSCENE [N] — [DURATION]s\nShot: [camera angle/movement]\nVisual: [what's on screen]\nAudio: [music/SFX/VO]\nAction: [what happens]\nMood: [emotional tone]\nMake it genuinely cinematic and production-ready.${lang}`,
    humanizer:`${base}\nHumanizer. Rewrite to sound like a real thoughtful human: vary sentence length, add personality, remove AI tells (hedging, hollow affirmations, robotic flow). Keep full meaning. Return ONLY rewritten text.${lang}`,
    logo:`${base}\nLogo Concept Designer. Create 2-3 distinct logo concepts:\n## Concept [N]: [Name]\n**Tagline:** ...\n**Symbol/Mark:** [detailed visual]\n**Colors:** [hex codes + rationale]\n**Typography:** [style + specific font names]\n**Style:** [minimalist/bold/elegant etc]\n**AI Image Prompt:** [complete ready-to-use generation prompt]\nMake each concept genuinely different.`,
    presentation:`${base}\nPresentation Designer. Complete slide deck.\nFor each slide:\n---\n## SLIDE [N]: [TITLE]\n**Layout:** [visual layout description]\n**Key Content:**\n- [bullets]\n**Visual Element:** [chart/image/icon suggestion]\n**Speaker Notes:** [what presenter says]\n---\nProfessional narrative arc. Open with hook, end with CTA.${lang}`,
    business:`${base}\nBusiness Consultant (MBA-level). Structure: **Situation Analysis** → **Strategic Options** → **Recommended Approach** → **Implementation Steps** → **Risks & Mitigations** → **Next Actions**. Concrete, practical, specific. No generic advice.${lang}`,
    support:`${base}\nSupport mode. Professional, empathetic, solution-focused. Acknowledge genuinely, provide complete solution, warm but professional tone, concrete follow-up offer.${lang}`
  };

  return p[mode] || p.chat;
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type":"application/json", "Content-Length":Buffer.byteLength(d), ...headers }
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

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-neuron-dev-code");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  let mode, plan, language, msgs, searchResults, userEmail;

  if (body.payload) {
    mode = body.mode || "chat";
    plan = body.payload.plan || "Free";
    language = body.payload.language || "auto";
    searchResults = body.payload.searchResults || [];
    userEmail = body.payload.userEmail || "";
    const hist = (body.payload.history || []).slice(-30);
    const msg = body.payload.message || body.payload.prompt || "";
    msgs = [...hist.map(h => ({ role: h.role, content: h.content })), { role: "user", content: msg }];
  } else {
    mode = body.mode || "chat";
    plan = body.plan || "Free";
    language = body.language || "auto";
    searchResults = body.searchResults || [];
    userEmail = body.userEmail || "";
    msgs = body.messages || [];
  }

  if (!msgs.length) return res.status(400).json({ error: "No message provided" });

  const isCreator = userEmail.toLowerCase() === CREATOR_EMAIL.toLowerCase();
  const system = getSystemPrompt(mode, language, searchResults, isCreator);
  const full = [{ role: "system", content: system }, ...msgs];
  const maxTok = plan === "Premium" ? 4096 : plan === "Pro" ? 3000 : 2048;

  const openAIKeys = getOpenAIKeys();
  let lastErr = null;

  // Try each OpenAI key in rotation
  for (let attempt = 0; attempt < openAIKeys.length; attempt++) {
    const key = getNextOpenAIKey(openAIKeys);
    if (!key) break;
    try {
      const r = await httpPost(
        "https://api.openai.com/v1/chat/completions",
        { model: "gpt-4o", messages: full, max_tokens: maxTok },
        { Authorization: "Bearer " + key }
      );
      if (r.status === 200) {
        const content = r.data?.choices?.[0]?.message?.content;
        if (content) return res.status(200).json({ reply: content, content, provider: "openai-" + (attempt + 1) });
        throw new Error("Empty response");
      }
      const errMsg = (r.data?.error?.message || JSON.stringify(r.data)).slice(0, 200);
      console.error(`OpenAI key ${attempt + 1} HTTP ${r.status}: ${errMsg}`);
      lastErr = new Error(`HTTP ${r.status}: ${errMsg}`);
      // Content policy error — don't retry
      if (r.status === 400 && r.data?.error?.code === "content_policy_violation") break;
    } catch (e) {
      console.error(`OpenAI key ${attempt + 1} error:`, e.message);
      lastErr = e;
    }
  }

  // Final fallback: Groq
  const groqKey = process.env.GROQ_KEY;
  if (groqKey && groqKey.length > 10) {
    try {
      const r = await httpPost(
        "https://api.groq.com/openai/v1/chat/completions",
        { model: "llama-3.3-70b-versatile", messages: full, max_tokens: Math.min(maxTok, 8000) },
        { Authorization: "Bearer " + groqKey }
      );
      if (r.status === 200) {
        const content = r.data?.choices?.[0]?.message?.content;
        if (content) return res.status(200).json({ reply: content, content, provider: "groq" });
      }
      const errMsg = (r.data?.error?.message || JSON.stringify(r.data)).slice(0, 150);
      lastErr = new Error("Groq HTTP " + r.status + ": " + errMsg);
    } catch (e) {
      lastErr = e;
    }
  }

  return res.status(500).json({
    error: "All providers failed — please add more API keys or wait for rate limits to reset",
    details: lastErr?.message || "Unknown error",
    openAIKeysConfigured: openAIKeys.length
  });
};
