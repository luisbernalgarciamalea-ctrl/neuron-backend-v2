const {applyCors,handleOptions}=require('./_security');
// No verified free motion-video API is configured. Do not substitute a slideshow.
module.exports=async function(req,res){
  applyCors(req,res,'POST, OPTIONS');if(handleOptions(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  return res.status(503).json({error:'AI video generation is not connected yet. A free provider that generates moving scenes still needs to be verified. You can explicitly choose Storyboard for a text plan.',code:'FREE_VIDEO_PROVIDER_REQUIRED',status:'unavailable'});
};
