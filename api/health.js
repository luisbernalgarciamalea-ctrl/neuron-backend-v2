const {applyCors,handleOptions}=require('./_security');
const {providers,geminiKeys}=require('./_providers');
module.exports=async function(req,res){
  applyCors(req,res,'GET, OPTIONS');if(handleOptions(req,res))return;
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  return res.status(200).json({ok:true,service:'athena-ai',timestamp:new Date().toISOString(),chatProviders:providers(),providers:{
    gemini:geminiKeys().length>0,groq:providers().groq.configured,openrouter:providers().openrouter.configured,search:Boolean(process.env.TAVILY_API_KEY),database:Boolean(process.env.MONGO_URI),
    image:process.env.IMAGE_FREE_ACCESS_CONFIRMED==='true'&&Boolean(process.env.GEMINI_IMAGE_MODEL)&&geminiKeys().length>0,video:false
  },note:'Configuration status only. Keys and quotas have not been tested.'});
};
