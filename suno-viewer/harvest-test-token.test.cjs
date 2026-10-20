const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {installHarvestTestTokenRoute}=require('./harvest-test-token.cjs');
const secret='b'.repeat(64);
async function invoke({until=Date.now()+3600000,authorization='Bearer '+secret,fetchImpl}={}) {
 process.env.SUNDROP_HARVEST_TEST_UNTIL=new Date(until).toISOString();
 process.env.SUNDROP_LOCAL_MIRROR_CLIENT_SHA256=createHash('sha256').update(secret).digest('hex');
 let handler;installHarvestTestTokenRoute({post(path,fn){assert.equal(path,'/api/local-mirror/harvest-test-token');handler=fn;}},{getAccessToken:async()=> 'workload',fetchImpl});
 const result={};const res={set(){return this;},status(n){result.status=n;return this;},json(body){result.body=body;return this;}};
 await handler({headers:{authorization},body:{serviceAccount:'other',scope:'admin'}},res);return result;
}
test('expired authorization and bad secret cannot invoke IAM',async()=>{
 const fail=()=>assert.fail('IAM should not be called');
 assert.equal((await invoke({until:Date.now()-1000,fetchImpl:fail})).status,403);
 assert.equal((await invoke({authorization:'Bearer wrong',fetchImpl:fail})).status,401);
});
test('only fixed test-runner identity and short token allowed',async()=>{
 const result=await invoke({fetchImpl:async(url,opt)=>{
  assert.ok(url.includes('/sundrop-harvest-test-runner@stable-framing-482501-t9.iam.gserviceaccount.com:'));
  assert.deepEqual(JSON.parse(opt.body),{scope:['https://www.googleapis.com/auth/cloud-platform'],lifetime:'600s'});
  return {ok:true,json:async()=>({accessToken:'test',expireTime:new Date(Date.now()+600000).toISOString()})};}});
 assert.equal(result.status,200);
});
test('provider failures do not expose secret errors',async()=>{
 const result=await invoke({fetchImpl:async()=>{throw new Error(secret);}});
 assert.equal(result.status,502);assert.ok(!JSON.stringify(result).includes(secret));
});
