'use strict';
const { bearerMatches } = require('./token-hash-auth.cjs');
const EXPECTED_SERVICE_ACCOUNT = 'sundrop-local-reader@stable-framing-482501-t9.iam.gserviceaccount.com';
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

function installLocalMirrorTokenRoute(app, { getAccessToken, fetchImpl = global.fetch }) {
  // The expired harvest-test token route was removed (S4, 2026-10-20).
  app.post('/api/local-mirror/token', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const serviceAccount = process.env.SUNDROP_LOCAL_MIRROR_SERVICE_ACCOUNT || '';
    // A 256-bit random value encoded as hex or base64url; env may list several hashes during rotation.
    const authorized = bearerMatches(req.headers?.authorization, process.env.SUNDROP_LOCAL_MIRROR_CLIENT_SHA256);
    if (authorized === null || serviceAccount !== EXPECTED_SERVICE_ACCOUNT) {
      return res.status(503).json({ error: 'Local mirror authentication is unavailable.' });
    }
    if (!authorized) return res.status(401).json({ error: 'Unauthorized.' });
    console.log(JSON.stringify({ severity: 'NOTICE', logName: 'token-mint', route: 'local-mirror' }));
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
      return res.status(502).json({ error: 'Local mirror token exchange failed.' });
    }
  });
}

module.exports = { installLocalMirrorTokenRoute };
