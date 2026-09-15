const { applyCors, handleOptions, cleanText }=require('./_security');
const { geminiKeys, request, attachments, failure }=require('./_providers');
module.exports=async function(req,res){
  applyCors(req,res,'POST, OPTIONS');if(handleOptions(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const body=req.body||{},prompt=cleanText(body.prompt,12000);
    if(!prompt)return res.status(400).json({error:'Describe the image you want to create.'});
    // A saved key is not evidence of free image-model access. No paid fallback.
    if(process.env.IMAGE_FREE_ACCESS_CONFIRMED!=='true')return res.status(503).json({error:'Image generation is not enabled yet: free image-model access needs to be verified. No placeholder image has been substituted.',code:'FREE_IMAGE_ACCESS_REQUIRED'});
    const model=String(process.env.GEMINI_IMAGE_MODEL||'').trim();
    if(!/^[a-z0-9.-]+$/.test(model))throw failure('An accessible image model has not been configured.',503,'MODEL_NOT_CONFIGURED');
    const keys=geminiKeys();if(!keys.length)throw failure('Image generation is not configured.',503,'NOT_CONFIGURED');
    const aspect=body.aspectRatio||'1:1';if(!['1:1','16:9','9:16'].includes(aspect))throw failure('Choose square, landscape, or portrait.',400);
    const files=attachments(body.attachments);
    if(files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.mimeType)))throw failure('Reference files must be PNG, JPG, or WebP images.',400);
    const style=cleanText(body.style,80);
    const parts=[{text:prompt+(style?'\nVisual style: '+style:'')},...files.map(f=>({inlineData:{mimeType:f.mimeType,data:f.data}}))];
    const data=await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
      contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:aspect}}
    },{'x-goog-api-key':keys[0]},48000);
    const candidate=data.candidates?.[0];
    if(data.promptFeedback?.blockReason||['SAFETY','PROHIBITED_CONTENT','IMAGE_SAFETY'].includes(candidate?.finishReason))throw failure('The image provider declined this request. Please revise the prompt.',422,'CONTENT_BLOCKED');
    const generated=candidate?.content?.parts?.find(p=>['image/png','image/jpeg','image/webp'].includes(p.inlineData?.mimeType))?.inlineData;
    if(!generated?.data)throw failure('The provider returned no image. Check image-model access and available quota.',502,'NO_IMAGE');
    const bytes=Buffer.from(generated.data,'base64');
    const valid=generated.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):generated.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid)throw failure('The provider returned an invalid image.',502,'INVALID_IMAGE');
    if(generated.data.length>4*1024*1024)throw failure('The generated image is too large to deliver. Choose a smaller output.',413,'IMAGE_TOO_LARGE');
    return res.status(200).json({imageUrl:`data:${generated.mimeType};base64,${generated.data}`,provider:'Gemini',model});
  }catch(error){return res.status(error.status||502).json({error:error.status?error.message:'Image generation failed. Please retry.',code:error.code||'IMAGE_FAILED'});}
};
