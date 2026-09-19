const { applyCors, handleOptions, cleanText, cleanHistory, cleanSearchResults }=require('./_security');
const { chat, attachments }=require('./_providers');
const { codingInstructions, workingFile }=require('./_coding');
const { generateCode }=require('./_code-quality');
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
      searchResults.map((r, i) => `[${i+1}] ${r.title}: ${r.snippet}\nURL: ${r.url}`).join("\n");
  }

  const base = `You are Athena AI, a helpful creative assistant created by Luis Bernal Garcia-Malea.${date}${lang}${creat}`;

  const p = {
    chat:         `${base}\nBe sharp, warm, direct. Use markdown. Never pad.${src}`,
    research:     `${base}\nResearch mode. Give a clear summary, key facts, and linked sources. Cite only supplied URLs; if no live results were supplied, state that the answer is not web-verified.${src}`,
    docs:         `${base}\nDocs mode. Polished professional documents. Clear structure and precise language.`,
    code:         `${base}\nCode mode — senior engineer. Rules:\n1. For web pages, write one complete HTML file with embedded CSS and JavaScript. For other requested languages, write that language. Put source code in a fenced code block labelled with its language\n2. Be CONCISE — clean readable code, not bloated\n3. For e-commerce/websites: include working UI, CSS styling, JavaScript functionality\n4. Give a short explanation followed by the complete source code\n5. After the code add a brief ## How to use section`,
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
    support:      `${base}\nSupport. Empathetic, solution-focused, warm, complete resolution.`,
    songwriter:   `${base}\nSong Writer mode. Write complete, professional song lyrics with clear structure labels: [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro]. Match the genre's style, rhyme scheme, and rhythm precisely. Make the chorus memorable with a strong hook. Make it emotionally resonant and authentic.`
  };
  return p[mode] || p.chat;
}


module.exports=async function(req,res){
  applyCors(req,res,'POST, OPTIONS');if(handleOptions(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const body=req.body||{}, payload=body.payload||body;
    const mode=cleanText(body.mode,40)||'chat';
    const messages=payload.message ? [...cleanHistory(payload.history),{role:'user',content:cleanText(payload.message,24000)}] : cleanHistory(payload.messages);
    if(!messages.length)return res.status(400).json({error:'Enter a prompt or attach a file.'});
    const system=getSystemPrompt(mode,cleanText(payload.language,80),cleanSearchResults(payload.searchResults),false);
    const files=attachments(payload.attachments);
    const current=mode==='code'?workingFile(payload.codeContext):null;
    if(current)files.push(current);
    // The full working file supersedes old code snippets without losing the user's requests.
    const context=mode==='code'?messages.slice(-10).map(m=>current&&m.role==='assistant'?{...m,content:m.content.replace(/```[\s\S]*?(?:```|$)/g,'[Earlier code; use CURRENT_WORKING_FILE.]')}:m):messages;
    const options={system:system+(mode==='code'?'\n\n'+codingInstructions:''),messages:context,provider:payload.provider||'auto',files,maxTokens:mode==='code'?16384:4096,allowFallback:payload.allowFallback!==false,coding:mode==='code'};
    return res.status(200).json(mode==='code'?await generateCode(options,chat):await chat(options));
  }catch(error){return res.status(error.status||502).json({error:error.status?error.message:'Generation failed. Please retry.',code:error.code||'GENERATION_FAILED'});}
};
