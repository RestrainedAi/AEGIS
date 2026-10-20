'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const EXPECTED_SERVICE_ACCOUNT = 'sundrop-maintenance@stable-framing-482501-t9.iam.gserviceaccount.com';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function installMaintenanceTokenRoute(app, { getAccessToken, fetchImpl = global.fetch }) {
  app.post('/api/maintenance/token', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const expected = process.env.SUNDROP_MAINTENANCE_CLIENT_SHA256 || '';
    const serviceAccount = process.env.SUNDROP_MAINTENANCE_SERVICE_ACCOUNT || EXPECTED_SERVICE_ACCOUNT;
    if (!/^[a-fA-F0-9]{64}$/.test(expected) || serviceAccount !== EXPECTED_SERVICE_ACCOUNT) {
      return res.status(503).json({ error: 'Maintenance authentication is unavailable.' });
    }
    const authorization = req.headers?.authorization;
    // A 256-bit random value encoded as hex or base64url; never accept arbitrary bodies/targets.
    const match = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization);
    const supplied = createHash('sha256').update(match ? match[1] : '').digest();
    const authorized = timingSafeEqual(supplied, Buffer.from(expected, 'hex'));
    if (!match || !authorized) return res.status(401).json({ error: 'Unauthorized.' });
    try {
      const workloadToken = await getAccessToken();
      if (typeof workloadToken !== 'string' || !workloadToken) throw new Error('Missing workload identity');
      const response = await fetchImpl(
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${EXPECTED_SERVICE_ACCOUNT}:generateAccessToken`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${workloadToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: [SCOPE], lifetime: '600s' }),
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        }
      );
      if (!response.ok) throw new Error('IAM token exchange failed');
      const payload = await response.json();
      const expiresAt = Date.parse(payload.expireTime);
      const remaining = expiresAt - Date.now();
      if (typeof payload.accessToken !== 'string' || !payload.accessToken ||
          !Number.isFinite(expiresAt) || remaining <= 0 || remaining > 660000) {
        throw new Error('Invalid token response');
      }
      return res.status(200).json({ access_token: payload.accessToken, token_type: 'Bearer', expires_at: new Date(expiresAt).toISOString() });
    } catch (_) {
      // Never return provider bodies, exception messages, workload tokens, or client secrets.
      return res.status(502).json({ error: 'Maintenance token exchange failed.' });
    }
  });
}

module.exports = { installMaintenanceTokenRoute };

const PROJECT = 'stable-framing-482501-t9';
const BUILD_BUCKET = 'aeonimus-workspaces';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function maintenanceAuthorized(req, res) {
  res.set('Cache-Control', 'no-store');
  const expected = process.env.SUNDROP_MAINTENANCE_CLIENT_SHA256 || '';
  if (!/^[a-fA-F0-9]{64}$/.test(expected)) { res.status(503).json({ error: 'Maintenance authentication is unavailable.' }); return false; }
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(req.headers?.authorization || '');
  const digest = createHash('sha256').update(match ? match[1] : '').digest();
  if (!timingSafeEqual(digest, Buffer.from(expected, 'hex')) || !match) { res.status(401).json({ error: 'Unauthorized.' }); return false; }
  return true;
}
function buildInput(body) {
  const keys = ['component', 'sourceObject', 'sourceGeneration', 'sourceSha256', 'requestId'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k)) || keys.some(k => typeof body[k] !== 'string')) throw new Error('Invalid request');
  if (!['harvest', 'viewer'].includes(body.component) || !UUID.test(body.requestId) || !/^[1-9][0-9]{0,19}$/.test(body.sourceGeneration) || !/^[a-f0-9]{64}$/.test(body.sourceSha256) || !/^maintenance\/build-source\/[A-Za-z0-9_-]+\.(tgz|tar\.gz)$/.test(body.sourceObject)) throw new Error('Invalid request');
  return Object.fromEntries(keys.map(k => [k, body[k]]));
}
function createBuildStore(storage) {
  const bucket = storage.bucket(BUILD_BUCKET);
  const object = (id, suffix) => bucket.file(`maintenance/build-requests/${id}/${suffix}.json`);
  return {
    async verifySource(input) {
      const file = bucket.file(input.sourceObject, { generation: input.sourceGeneration });
      const [meta] = await file.getMetadata();
      if (String(meta.generation) !== input.sourceGeneration || !Number.isFinite(Number(meta.size)) || Number(meta.size) <= 0 || Number(meta.size) > 262144000) throw new Error('Invalid source');
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of file.createReadStream()) { bytes += chunk.length; if (bytes > 262144000) throw new Error('Source too large'); hash.update(chunk); }
      if (bytes !== Number(meta.size) || hash.digest('hex') !== input.sourceSha256) throw new Error('Invalid source');
    },
    async claim(id, value) {
      try { await object(id, 'claim').save(JSON.stringify(value), { resumable: false, contentType: 'application/json', preconditionOpts: { ifGenerationMatch: 0 } }); return true; }
      catch (e) { if (Number(e.code) === 412) return false; throw e; }
    },
    async read(id, suffix) {
      try { const [data] = await object(id, suffix).download(); return JSON.parse(data.toString('utf8')); }
      catch (e) { if (Number(e.code) === 404) return null; throw e; }
    },
    async receipt(id, value) { await object(id, 'receipt').save(JSON.stringify(value), { resumable: false, contentType: 'application/json', preconditionOpts: { ifGenerationMatch: 0 } }); },
  };
}
function installMaintenanceBuildRoutes(app, { getAccessToken, storage, buildStore, fetchImpl = global.fetch }) {
  // Lazy storage adapter allows server registration before storage initialization.
  const store = () => buildStore || createBuildStore(typeof storage === 'function' ? storage() : storage);
  app.post('/api/maintenance/builds', async (req, res) => {
    if (!maintenanceAuthorized(req, res)) return;
    let input;
    try { input = buildInput(req.body); } catch (_) { return res.status(400).json({ error: 'Invalid maintenance build request.' }); }
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    try {
      const s = store();
      // Existing claim is never cleared/retried: reconcile uncertain POST first.
      const existing = await s.read(input.requestId, 'claim');
      if (existing) {
        if (existing.requestHash !== hash) return res.status(409).json({ error: 'Request ID already belongs to different input.' });
        const receipt = await s.read(input.requestId, 'receipt');
        if (receipt && receipt.requestHash === hash) return res.status(200).json(receipt);
        return res.status(409).json({ error: 'Build dispatch outcome requires reconciliation.', requestId: input.requestId });
      }
      await s.verifySource(input);
      const workloadToken = await getAccessToken();
      if (typeof workloadToken !== 'string' || !workloadToken) throw new Error('Unavailable identity');
      if (!await s.claim(input.requestId, { requestHash: hash, input, claimedAt: new Date().toISOString() })) return res.status(409).json({ error: 'Build request already claimed; reconcile before retry.', requestId: input.requestId });
      const imageName = input.component === 'harvest' ? 'harvest-job' : 'suno-viewer';
      const image = `us-central1-docker.pkg.dev/${PROJECT}/aeonimus-repo/${imageName}:maintenance-${input.requestId}`;
      const body = {
        serviceAccount: `projects/${PROJECT}/serviceAccounts/sundrop-release-builder@${PROJECT}.iam.gserviceaccount.com`,
        source: { storageSource: { bucket: BUILD_BUCKET, object: input.sourceObject, generation: input.sourceGeneration } },
        steps: [{ name: 'gcr.io/cloud-builders/docker', args: ['build', '-f', input.component === 'harvest' ? 'Dockerfile.harvest' : 'Dockerfile', '-t', image, '.'] }, { name: 'gcr.io/cloud-builders/docker', args: ['push', image] }],
        options: { logging: 'CLOUD_LOGGING_ONLY' }, timeout: '1800s', tags: ['sundrop-maintenance', input.requestId],
      };
      const response = await fetchImpl(`https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/builds`, { method: 'POST', headers: { Authorization: `Bearer ${workloadToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (!response.ok) throw new Error('Build dispatch rejected');
      const data = await response.json();
      const buildId = data.metadata?.build?.id;
      if (typeof buildId !== 'string' || !UUID.test(buildId)) throw new Error('Uncertain build receipt');
      const receipt = { requestId: input.requestId, requestHash: hash, buildId, image, status: 'DISPATCHED' };
      await s.receipt(input.requestId, receipt);
      return res.status(202).json(receipt);
    } catch (_) { return res.status(502).json({ error: 'Maintenance build failed or dispatch outcome is uncertain; reconcile request before retry.', requestId: input.requestId }); }
  });
  app.get('/api/maintenance/builds/:buildId', async (req, res) => {
    if (!maintenanceAuthorized(req, res)) return;
    if (!UUID.test(req.params?.buildId || '')) return res.status(400).json({ error: 'Invalid build ID.' });
    try {
      const token = await getAccessToken();
      const response = await fetchImpl(`https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/builds/${req.params.buildId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error('Build lookup failed');
      const data = await response.json();
      if (data.serviceAccount !== `projects/${PROJECT}/serviceAccounts/sundrop-release-builder@${PROJECT}.iam.gserviceaccount.com` || !Array.isArray(data.tags) || !data.tags.includes('sundrop-maintenance')) return res.status(404).json({ error: 'Maintenance build not found.' });
      return res.status(200).json({ buildId: data.id, status: data.status, createTime: data.createTime, finishTime: data.finishTime });
    } catch (_) { return res.status(502).json({ error: 'Maintenance build status unavailable.' }); }
  });
}
module.exports.installMaintenanceBuildRoutes = installMaintenanceBuildRoutes;
module.exports.createBuildStore = createBuildStore;
