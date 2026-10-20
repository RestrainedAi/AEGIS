'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const ACCOUNT='sundrop-harvest-test-runner@stable-framing-482501-t9.iam.gserviceaccount.com';
function installHarvestTestTokenRoute(app,{getAccessToken,fetchImpl=global.fetch}) {
 app.post('/api/local-mirror/harvest-test-token',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const until=Date.parse(process.env.SUNDROP_HARVEST_TEST_UNTIL||'');
  const hash=process.env.SUNDROP_LOCAL_MIRROR_CLIENT_SHA256||'';
  if(!Number.isFinite(until)||Date.now()>=until||! /^[a-f0-9]{64}$/i.test(hash))return res.status(403).json({error:'Harvest test authorization is inactive.'});
  const match=/^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(req.headers?.authorization||'');
  const supplied=createHash('sha256').update(match?match[1]:'').digest();
  if(!match||!timingSafeEqual(supplied,Buffer.from(hash,'hex')))return res.status(401).json({error:'Unauthorized.'});
  try {
   const response=await fetchImpl(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${ACCOUNT}:generateAccessToken`,{
    method:'POST',headers:{Authorization:`Bearer ${await getAccessToken()}`,'Content-Type':'application/json'},
    body:JSON.stringify({scope:['https://www.googleapis.com/auth/cloud-platform'],lifetime:'600s'}),
    signal:AbortSignal.timeout(15000),redirect:'error'});
   if(!response.ok)throw new Error('exchange failed');
   const data=await response.json(),remaining=Date.parse(data.expireTime)-Date.now();
   if(typeof data.accessToken!=='string'||!data.accessToken||!Number.isFinite(remaining)||remaining<=0||remaining>660000)throw new Error('Invalid exchange');
   return res.status(200).json({access_token:data.accessToken,token_type:'Bearer',expires_at:data.expireTime});
  }catch(_){return res.status(502).json({error:'Harvest test machine-token exchange failed.'});}
 });
}
module.exports={installHarvestTestTokenRoute};
