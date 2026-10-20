'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { installMaintenanceTokenRoute } = require('./maintenance-token.cjs');
const secret = 'a'.repeat(64);
const identity = 'sundrop-maintenance@stable-framing-482501-t9.iam.gserviceaccount.com';
function configure() {
  process.env.SUNDROP_MAINTENANCE_CLIENT_SHA256 = createHash('sha256').update(secret).digest('hex');
  process.env.SUNDROP_MAINTENANCE_SERVICE_ACCOUNT = identity;
}
async function invoke({ authorization = `Bearer ${secret}`, fetchImpl, getAccessToken = async () => 'workload-test-token' } = {}) {
  let handler;
  installMaintenanceTokenRoute({ post(path, callback) { assert.equal(path, '/api/maintenance/token'); handler = callback; } }, { getAccessToken, fetchImpl });
  const result = { headers: {} };
  const res = { set(k, v) { result.headers[k] = v; return this; }, status(v) { result.status = v; return this; }, json(v) { result.body = v; return this; } };
  await handler({ headers: { authorization }, body: { serviceAccount: 'attacker', scope: ['cloud-platform'], lifetime: '3600s' } }, res);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  return result;
}
test('missing or incorrect authorization never obtains workload token or calls IAM', async () => {
  configure();
  for (const authorization of ['', 'Bearer wrong', `Bearer ${'b'.repeat(64)}`]) {
    const result = await invoke({ authorization, getAccessToken() { assert.fail('workload auth attempted'); }, fetchImpl() { assert.fail('IAM attempted'); } });
    assert.equal(result.status, 401);
  }
});
test('absent config and unexpected identities fail closed', async () => {
  for (const [hash, account] of [['', identity], ['not-a-hash', identity], ['a'.repeat(64), 'other@example.com']]) {
    process.env.SUNDROP_MAINTENANCE_CLIENT_SHA256 = hash;
    process.env.SUNDROP_MAINTENANCE_SERVICE_ACCOUNT = account;
    const result = await invoke({ getAccessToken() { assert.fail('workload auth attempted'); } });
    assert.equal(result.status, 503);
  }
});
test('success sends fixed target, cloud-platform scope, and ten-minute lifetime', async () => {
  configure();
  const expiry = new Date(Date.now() + 600000).toISOString();
  const result = await invoke({ fetchImpl: async (url, options) => {
    assert.equal(url, `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${identity}:generateAccessToken`);
    assert.deepEqual(JSON.parse(options.body), { scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '600s' });
    assert.equal(options.headers.Authorization, 'Bearer workload-test-token');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ accessToken: 'restricted-test-token', expireTime: expiry }) };
  } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { access_token: 'restricted-test-token', token_type: 'Bearer', expires_at: expiry });
});
test('provider errors never leak tokens, client secrets or error response bodies', async () => {
  configure();
  for (const fetchImpl of [async () => { throw new Error(`secret ${secret} workload-test-token`); }, async () => ({ ok: false, json() { assert.fail('error body read'); } })]) {
    const result = await invoke({ fetchImpl });
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { error: 'Maintenance token exchange failed.' });
  }
});
test('expired, malformed and excessive token expiration rejected', async () => {
  configure();
  for (const expireTime of ['invalid', new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 3600000).toISOString()]) {
    const result = await invoke({ fetchImpl: async () => ({ ok: true, json: async () => ({ accessToken: 'must-not-leak', expireTime }) }) });
    assert.equal(result.status, 502);
    assert.equal(JSON.stringify(result.body).includes('must-not-leak'), false);
  }
});

test('reader credential configuration cannot enable maintenance broker', async () => {
  delete process.env.SUNDROP_MAINTENANCE_CLIENT_SHA256;
  process.env.SUNDROP_LOCAL_MIRROR_CLIENT_SHA256 = createHash('sha256').update(secret).digest('hex');
  const result = await invoke({ getAccessToken() { assert.fail('workload auth attempted'); } });
  assert.equal(result.status, 503);
});

const { installMaintenanceBuildRoutes } = require('./maintenance-token.cjs');
const rid = '11111111-1111-4111-8111-111111111111';
const bid = '22222222-2222-4222-8222-222222222222';
const input = { component:'harvest',sourceObject:'maintenance/build-source/test.tgz',sourceGeneration:'123',sourceSha256:'a'.repeat(64),requestId:rid };
function memoryStore() {
 const values=new Map();return {values,verifySource:async()=>{},read:async(id,s)=>values.get(id+s)||null,claim:async(id,v)=>{if(values.has(id+'claim'))return false;values.set(id+'claim',v);return true;},receipt:async(id,v)=>values.set(id+'receipt',v)};
}
async function callBuild({body=input,authorization=`Bearer ${secret}`,store=memoryStore(),fetchImpl,method='post',params={}}={}) {
 configure();let handlers={};installMaintenanceBuildRoutes({post(p,h){handlers.post=h;},get(p,h){handlers.get=h;}},{getAccessToken:async()=> 'workload-secret',buildStore:store,fetchImpl});
 const result={};const res={set(){return this;},status(s){result.status=s;return this;},json(v){result.body=v;return this;}};
 await handlers[method]({body,headers:{authorization},params},res);return result;
}
test('build validates exact input and authorization before storage or dispatch',async()=>{
 for(const body of [{...input,serviceAccount:'evil'},{...input,sourceObject:'maintenance/build-source/../x.tgz'},{...input,sourceGeneration:'-1'},{...input,sourceSha256:'bad'},{...input,component:'other'}]) {
  assert.equal((await callBuild({body,fetchImpl(){assert.fail('fetch');}})).status,400);
 }
 assert.equal((await callBuild({authorization:'wrong',fetchImpl(){assert.fail('fetch');}})).status,401);
});
test('build fixes builder/source generation/project/steps, and duplicate dispatch reuses receipt',async()=>{
 const store=memoryStore();let calls=0;
 const fetchImpl=async(url,o)=>{calls++;assert.equal(url,'https://cloudbuild.googleapis.com/v1/projects/stable-framing-482501-t9/builds');const b=JSON.parse(o.body);assert.equal(b.serviceAccount,'projects/stable-framing-482501-t9/serviceAccounts/sundrop-release-builder@stable-framing-482501-t9.iam.gserviceaccount.com');assert.equal(b.source.storageSource.generation,'123');assert.equal(b.steps.length,2);assert.equal(b.steps[0].args[2],'Dockerfile.harvest');assert.equal(b.steps[1].args[0],'push');assert.equal(b.options.logging,'CLOUD_LOGGING_ONLY');assert.equal(o.redirect,'error');return {ok:true,json:async()=>({metadata:{build:{id:bid}}})};};
 assert.equal((await callBuild({store,fetchImpl})).status,202);
 assert.equal((await callBuild({store,fetchImpl})).status,200);assert.equal(calls,1);
 assert.equal((await callBuild({store,fetchImpl,body:{...input,sourceGeneration:'456'}})).status,409);
});
test('uncertain dispatch and receipt failure keep claim, never retry POST',async()=>{
 for(const failure of ['post','receipt']) {
  const store=memoryStore();let calls=0;if(failure==='receipt')store.receipt=async()=>{throw Error('sensitive');};
  const fetchImpl=async()=>{calls++;if(failure==='post')throw Error('workload-secret');return {ok:true,json:async()=>({metadata:{build:{id:bid}}})};};
  const first=await callBuild({store,fetchImpl});assert.equal(first.status,502);assert.equal(JSON.stringify(first).includes('workload-secret'),false);
  assert.equal((await callBuild({store,fetchImpl})).status,409);assert.equal(calls,1);
 }
});
test('source mismatch and claim race do not dispatch',async()=>{
 let store=memoryStore();store.verifySource=async()=>{throw Error('sha mismatch');};assert.equal((await callBuild({store,fetchImpl(){assert.fail('fetch');}})).status,502);
 store=memoryStore();store.claim=async()=>false;assert.equal((await callBuild({store,fetchImpl(){assert.fail('fetch');}})).status,409);
});
test('status cannot select arbitrary URL or expose unrelated builds/provider bodies',async()=>{
 assert.equal((await callBuild({method:'get',params:{buildId:'../bad'},fetchImpl(){assert.fail('fetch');}})).status,400);
 const fetchImpl=async()=>({ok:true,json:async()=>({id:bid,status:'SUCCESS',serviceAccount:'other',tags:['sundrop-maintenance'],secret:'sensitive'})});
 assert.equal((await callBuild({method:'get',params:{buildId:bid},fetchImpl})).status,404);
});

test('GCS store pins source generation, hashes bytes and claims create-only',async()=>{
 const {createBuildStore}=require('./maintenance-token.cjs'); const bytes=Buffer.from('archive');const calls=[];
 const storage={bucket(name){assert.equal(name,'aeonimus-workspaces');return {file(name,opts){calls.push({name,opts});return {getMetadata:async()=>[{generation:'123',size:String(bytes.length)}],createReadStream:async function*(){yield bytes;},save:async(data,opts)=>{assert.equal(opts.preconditionOpts.ifGenerationMatch,0);assert.equal(opts.resumable,false);}};}};}};
 const store=createBuildStore(storage);await store.verifySource({...input,sourceSha256:createHash('sha256').update(bytes).digest('hex')});assert.equal(calls[0].opts.generation,'123');assert.equal(await store.claim(rid,{requestHash:'x'}),true);
 await assert.rejects(store.verifySource(input),/Invalid source/);
});
test('GCS claim precondition conflict returns false without overwrite',async()=>{
 const {createBuildStore}=require('./maintenance-token.cjs');const store=createBuildStore({bucket(){return {file(){return {save:async()=>{throw Object.assign(new Error('exists'),{code:412});}};}};}});
 assert.equal(await store.claim(rid,{}),false);
});
