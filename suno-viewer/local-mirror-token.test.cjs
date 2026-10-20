'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { installLocalMirrorTokenRoute } = require('./local-mirror-token.cjs');
const secret = 'a'.repeat(64);
const identity = 'sundrop-local-reader@stable-framing-482501-t9.iam.gserviceaccount.com';
function configure() {
  process.env.SUNDROP_LOCAL_MIRROR_CLIENT_SHA256 = createHash('sha256').update(secret).digest('hex');
  process.env.SUNDROP_LOCAL_MIRROR_SERVICE_ACCOUNT = identity;
}
async function invoke({ authorization = `Bearer ${secret}`, fetchImpl, getAccessToken = async () => 'workload-test-token' } = {}) {
  let handler;
  installLocalMirrorTokenRoute({ post(path, callback) { assert.equal(path, '/api/local-mirror/token'); handler = callback; } }, { getAccessToken, fetchImpl });
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
    process.env.SUNDROP_LOCAL_MIRROR_CLIENT_SHA256 = hash;
    process.env.SUNDROP_LOCAL_MIRROR_SERVICE_ACCOUNT = account;
    const result = await invoke({ getAccessToken() { assert.fail('workload auth attempted'); } });
    assert.equal(result.status, 503);
  }
});
test('success sends fixed target, read-only scope, and ten-minute lifetime', async () => {
  configure();
  const expiry = new Date(Date.now() + 600000).toISOString();
  const result = await invoke({ fetchImpl: async (url, options) => {
    assert.equal(url, `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${identity}:generateAccessToken`);
    assert.deepEqual(JSON.parse(options.body), { scope: ['https://www.googleapis.com/auth/devstorage.read_only'], lifetime: '600s' });
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
    assert.deepEqual(result.body, { error: 'Local mirror token exchange failed.' });
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
