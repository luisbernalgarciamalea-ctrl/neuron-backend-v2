const {applyCors,handleOptions,cleanText}=require('./_security');
const {request}=require('./_providers');
module.exports=async function(req,res){
  applyCors(req,res,'GET, POST, OPTIONS');if(handleOptions(req,res))return;
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  const q=cleanText(req.query?.q||req.body?.q,300);
  if(!q)return res.status(400).json({error:'Enter a search query.',results:[]});
  if(!process.env.TAVILY_API_KEY)return res.status(503).json({error:'Web search is not connected. The owner needs to configure Tavily’s free plan.',results:[]});
  try{
    const data=await request('https://api.tavily.com/search',{query:q,search_depth:'basic',max_results:6,include_answer:false,auto_parameters:false},{Authorization:`Bearer ${process.env.TAVILY_API_KEY}`},7500);
    const results=(data.results||[]).filter(r=>{try{return new URL(r.url).protocol==='https:';}catch{return false;}}).slice(0,6).map(r=>({title:cleanText(r.title,300),snippet:cleanText(r.content,1200),url:cleanText(r.url,1500)}));
    return res.status(200).json({results,source:'tavily'});
  }catch(error){return res.status(error.status||502).json({error:error.status?error.message:'Web search failed.',results:[]});}
};
