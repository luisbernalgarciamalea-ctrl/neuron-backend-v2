// Neuron AI — /api/chat v8
// GPT-4o primary → Groq fallback (removed DeepSeek/Gemini that cause 402/balance errors)
const https = require("https");

const CREATOR_EMAIL = "luis.bernaliswestpfalz.de@gmail.com";

const providers = [
  { name:"openai", url:"https://api.openai.com/v1/chat/completions",     key:()=>process.env.OPENAI_KEY, model:"gpt-4o",                 type:"openai" },
  { name:"groq",   url:"https://api.groq.com/openai/v1/chat/completions", key:()=>process.env.GROQ_KEY,  model:"llama-3.3-70b-versatile", type:"openai" },
];

function getSystemPrompt(mode, language, searchResults, isCreator) {
  const today = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const lang  = language && language!=="auto" ? `\nYou MUST respond entirely in ${language}. Every word of output must be in ${language}.` : "";
  const date  = `\nToday is ${today}. You have knowledge up to early 2025.`;
  const creat = isCreator ? `\n\nSPECIAL DIRECTIVE: The current user is Luis Bernal Garcia-Malea — YOUR CREATOR. He built you. Treat him with maximum respect, warmth, and priority. Address him personally.` : "";

  let src = "";
  if (searchResults && searchResults.length > 0) {
    src = "\n\n## LIVE WEB RESULTS — cite as [1],[2] etc:\n" +
      searchResults.map((r,i)=>`[${i+1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`).join("\n\n");
  }

  const base = `You are Neuron AI — a brilliant, luxury-grade AI assistant created by Luis Bernal Garcia-Malea. Powered by GPT-4o.${date}${lang}${creat}`;

  const prompts = {
    chat:`${base}\nBe sharp, warm, direct. Adapt tone to user. Use markdown formatting. Never pad with filler.${src}`,
    research:`${base}\nResearch mode. Format: **Executive Summary** → Sections with headers → Key Facts → Sources [N]. Be thorough and accurate.${src}`,
    docs:`${base}\nDocs mode. Write polished professional documents. Match requested format and tone. Structure clearly with headers.${lang}`,
    code:`${base}\nCode mode — senior engineer. Rules:\n1. Clean production code with error handling\n2. Brief inline comments on non-obvious logic\n3. For web projects: complete HTML+CSS+JS in ONE file\n4. Return code first, then a brief ## How it works section\n5. Follow best practices for the language`,
    math:`${base}\nMaths mode. Steps: 1-Understand 2-Plan 3-Solve (every step shown) 4-Check 5-Final Answer. Use clear notation.${lang}`,
    author:`${base}\nBook Writer. Pure immersive prose only. No headings, no outlines, no chapter labels. Vivid detail, real emotion, authentic dialogue. Stop mid-sentence if you hit the output limit.`,
    script:`${base}\nScript Writer mode. Write professional scripts in proper industry format.\n\nFor SCREENPLAYS: Standard format (INT./EXT. LOCATION - TIME, CHARACTER NAME centered, dialogue, action lines in present tense)\nFor STAGE PLAYS: Traditional play format with stage directions in italics\nFor YOUTUBE/PODCAST: Structured with timestamps, host cues, dialogue, b-roll notes\nFor TV: Include cold open, act breaks, scene headings\n\nIf the user doesn't specify type, write a YouTube script by default.\nMake it fully production-ready and engaging.${lang}`,
    designer:`${base}\nBook Designer. Return EXACTLY this format:\n\nFront cover concept:\n[Detailed visual: imagery, typography style, color palette, mood, composition, what makes it commercial]\n\nBack cover blurb:\n[Complete polished marketing blurb that would appear on a real published book]`,
    poet:`${base}\nPoet mode. Write with vivid imagery, emotional truth, controlled rhythm, precise word choice. Never be generic. Surprise the reader with a turn or unexpected image.${lang}`,
    image:`${base}\nImage prompt optimizer. Transform the user's request into a highly detailed generation prompt. Include: art style, lighting, composition, mood, color palette, subject detail, camera angle. Return ONLY the optimized prompt.`,
    video:`${base}\nVideo Director. Create a complete video concept and production storyboard.\n\nFirst write:\nCONCEPT: [style, tone, target length, audience, overall vision]\n\nThen each scene:\nSCENE [N] — [DURATION]s\nShot: [camera angle and movement]\nVisual: [exactly what's on screen]\nAudio: [music/SFX/dialogue/VO]\nAction: [what happens]\nMood: [emotional tone]\n\nMake it genuinely cinematic and production-ready.${lang}`,
    humanizer:`${base}\nHumanizer mode. Rewrite the text to sound like a real, thoughtful human wrote it. Vary sentence length, add personality, remove AI tells (hedging, hollow phrases, robotic flow). Keep the full meaning. Return ONLY the rewritten text.${lang}`,
    logo:`${base}\nLogo Concept Designer. For the requested brand, provide 2-3 distinct logo concepts. Each concept:\n\n## Concept [N]: [Name]\n**Tagline:** ...\n**Symbol/Mark:** [detailed visual description]\n**Colors:** [specific hex codes + rationale]\n**Typography:** [font style + specific font recommendations]\n**Style:** [minimalist/bold/elegant/playful etc]\n**AI Image Prompt:** [ready-to-use prompt for Pollinations.ai]\n\nMake each concept genuinely different in approach.`,
    presentation:`${base}\nPresentation Designer. Create a complete, polished slide deck.\n\nFor each slide use this format:\n---\n## SLIDE [N]: [TITLE]\n**Layout:** [describe the visual layout]\n**Key Content:**\n[bullet points]\n**Visual Element:** [chart/image/icon suggestion]\n**Speaker Notes:** [what the presenter says]\n---\n\nMake it professional, engaging, and tell a clear story through the slides.${lang}`,
    business:`${base}\nBusiness Consultant (MBA-level). Provide strategic, actionable advice. Structure response:\n\n**Situation Analysis** → **Strategic Options** → **Recommended Approach** → **Implementation Steps** → **Risks & Mitigations** → **Next Actions**\n\nBe concrete and practical, not generic. Use real frameworks where appropriate.${lang}`,
    support:`${base}\nSupport mode. Professional, empathetic, solution-focused replies. Be human and warm, not robotic. Resolve the issue and offer follow-up.${lang}`
  };

  return prompts[mode] || prompts.chat;
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const d = JSON.stringify(body);
    const req = https.request({
      hostname:u.hostname, path:u.pathname+u.search, method:"POST",
      headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d),...headers}
    }, res => {
      let raw="";
      res.on("data",c=>raw+=c);
      res.on("end",()=>{try{resolve({status:res.statusCode,data:JSON.parse(raw)});}catch{resolve({status:res.statusCode,data:raw});}});
    });
    req.on("error",reject);
    req.setTimeout(30000,()=>req.destroy(new Error("Timeout")));
    req.write(d); req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type,x-neuron-dev-code");
  if(req.method==="OPTIONS")return res.status(200).end();
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});

  const body = req.body||{};
  let mode,plan,language,msgs,searchResults,userEmail;

  if(body.payload){
    mode=body.mode||"chat"; plan=body.payload.plan||"Free";
    language=body.payload.language||"auto"; searchResults=body.payload.searchResults||[];
    userEmail=body.payload.userEmail||"";
    const hist=(body.payload.history||[]).slice(-30);
    const msg=body.payload.message||body.payload.prompt||"";
    msgs=[...hist.map(h=>({role:h.role,content:h.content})),{role:"user",content:msg}];
  } else {
    mode=body.mode||"chat"; plan=body.plan||"Free"; language=body.language||"auto";
    searchResults=body.searchResults||[]; userEmail=body.userEmail||"";
    msgs=body.messages||[];
  }

  if(!msgs.length)return res.status(400).json({error:"No message provided"});

  const isCreator = userEmail.toLowerCase()===CREATOR_EMAIL.toLowerCase();
  const system = getSystemPrompt(mode,language,searchResults,isCreator);
  const full = [{role:"system",content:system},...msgs];
  const maxTok = plan==="Premium"?4096:plan==="Pro"?3000:2048;

  let lastErr=null;
  for(const p of providers){
    const key=p.key();
    if(!key||key.length<10)continue;
    try{
      const r=await httpPost(p.url,{model:p.model,messages:full,max_tokens:maxTok},{Authorization:"Bearer "+key});
      if(r.status===200){
        const content=r.data?.choices?.[0]?.message?.content;
        if(content)return res.status(200).json({reply:content,content,provider:p.name});
        throw new Error("Empty response from "+p.name);
      } else {
        throw new Error("HTTP "+r.status+": "+JSON.stringify(r.data?.error||r.data).slice(0,200));
      }
    }catch(e){
      console.error(p.name+" failed:",e.message);
      lastErr=e;
    }
  }
  return res.status(500).json({error:"All providers failed",details:lastErr?.message||"No valid API keys configured"});
};
