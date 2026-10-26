const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const trust = require("../auth-trust");
const { bearerMatches, configuredHashes, createRateLimiter } = require("../token-hash-auth.cjs");
const { installLocalMirrorTokenRoute } = require("../local-mirror-token.cjs");
const { installMaintenanceTokenRoute } = require("../maintenance-token.cjs");

const google = (x = {}) => ({ email: "Blahnikdigitaldesigns@gmail.com", email_verified: true, firebase: { sign_in_provider: "google.com" }, ...x });
const fsBool = (doc, k) => Boolean(doc && doc[k]);
const boot = new Set(["blahnikdigitaldesigns@gmail.com", "aegis@aeonimus.ai", "software@blahnikdigitaldesigns.com"]);

test("S3 trusted identity requires verified email and google.com", () => {
  assert.equal(trust.isTrustedIdentity(google()), true);
  assert.equal(trust.isTrustedIdentity(google({ email_verified: false })), false);
  assert.equal(trust.isTrustedIdentity(google({ firebase: { sign_in_provider: "password" } })), false);
  assert.equal(trust.isTrustedIdentity(google({ firebase: { sign_in_provider: "anonymous" } })), false);
  assert.equal(trust.isTrustedIdentity({ email: "a@b" }), false);
  assert.equal(trust.isTrustedIdentity(null), false);
});

test("S3 provider allow-list env defaults to google.com", () => {
  assert.deepEqual(trust.allowedProviders(""), ["google.com"]);
  assert.deepEqual(trust.allowedProviders("google.com, apple.com"), ["google.com", "apple.com"]);
});

test("S3 bootstrap email only works through verified Google", () => {
  assert.equal(trust.isPlatformAdminIdentity({ decoded: google(), adminDoc: null, bootstrapEmails: boot, fsBool }), true);
  assert.equal(trust.isPlatformAdminIdentity({ decoded: google({ firebase: { sign_in_provider: "password" } }), bootstrapEmails: boot, fsBool }), false);
  assert.equal(trust.isPlatformAdminIdentity({ decoded: google({ email_verified: false }), bootstrapEmails: boot, fsBool }), false);
  assert.equal(trust.isPlatformAdminIdentity({ decoded: google({ email: "someone@else.com" }), bootstrapEmails: boot, fsBool }), false);
});

test("S3 software@ master admin via claim, and admins doc", () => {
  assert.equal(trust.isPlatformAdminIdentity({ decoded: google({ email: "x@y.com", role: "master_admin" }), bootstrapEmails: new Set(), fsBool }), true);
  assert.equal(trust.isPlatformAdminIdentity({ decoded: google({ email: "software@blahnikdigitaldesigns.com" }), bootstrapEmails: boot, fsBool }), true);
  assert.equal(trust.isPlatformAdminIdentity({ decoded: google({ email: "x@y.com" }), adminDoc: { isActive: true }, bootstrapEmails: new Set(), fsBool }), true);
  assert.equal(trust.isPlatformAdminIdentity({ decoded: google({ email: "x@y.com", firebase: { sign_in_provider: "password" }, role: "master_admin" }), bootstrapEmails: boot, fsBool }), false);
});

test("S3 trustedEmail ignores unverified tokens", () => {
  assert.equal(trust.trustedEmail(google()), "blahnikdigitaldesigns@gmail.com");
  assert.equal(trust.trustedEmail(google({ email_verified: false })), "");
});

const secretA = "a".repeat(43), secretB = "b".repeat(43);
const h = (s) => createHash("sha256").update(s).digest("hex");

test("S4 bearer hash list supports rotation", () => {
  assert.equal(bearerMatches(`Bearer ${secretA}`, ""), null);
  assert.equal(bearerMatches(`Bearer ${secretA}`, h(secretA)), true);
  assert.equal(bearerMatches(`Bearer ${secretB}`, `${h(secretA)},${h(secretB)}`), true);
  assert.equal(bearerMatches(`Bearer ${"c".repeat(43)}`, `${h(secretA)},${h(secretB)}`), false);
  assert.equal(bearerMatches(undefined, h(secretA)), false);
  assert.equal(bearerMatches("Bearer short", h(secretA)), false);
  assert.deepEqual(configuredHashes(" , nothex, " + h(secretA)), [h(secretA)]);
});

function fakeApp() { const routes = {}; return { routes, post(p, fn) { routes[p] = fn; } }; }
function fakeRes() { return { code: 0, body: null, headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; }

test("S4 harvest-test route is gone, local-mirror route kept", () => {
  process.env.SUNDROP_HARVEST_TEST_UNTIL = "2099-01-01T00:00:00Z";
  const app = fakeApp();
  installLocalMirrorTokenRoute(app, { getAccessToken: async () => "w", fetchImpl: async () => { throw new Error("no"); } });
  assert.deepEqual(Object.keys(app.routes), ["/api/local-mirror/token"]);
  delete process.env.SUNDROP_HARVEST_TEST_UNTIL;
});

test("S4 local-mirror route rejects bad bearer, mints read-only token with good one", async () => {
  process.env.SUNDROP_LOCAL_MIRROR_CLIENT_SHA256 = `${h(secretA)},${h(secretB)}`;
  process.env.SUNDROP_LOCAL_MIRROR_SERVICE_ACCOUNT = "sundrop-local-reader@stable-framing-482501-t9.iam.gserviceaccount.com";
  let body = null;
  const app = fakeApp();
  installLocalMirrorTokenRoute(app, { getAccessToken: async () => "w", fetchImpl: async (_u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ accessToken: "t", expireTime: new Date(Date.now() + 600000).toISOString() }) }; } });
  const r1 = fakeRes(); await app.routes["/api/local-mirror/token"]({ headers: { authorization: "Bearer " + "z".repeat(43) } }, r1); assert.equal(r1.code, 401);
  const r2 = fakeRes(); await app.routes["/api/local-mirror/token"]({ headers: { authorization: "Bearer " + secretB } }, r2); assert.equal(r2.code, 200);
  assert.deepEqual(body.scope, ["https://www.googleapis.com/auth/devstorage.read_only"]);
});

test("S4 maintenance module exposes only the token route", () => {
  const m = require("../maintenance-token.cjs");
  assert.deepEqual(Object.keys(m), ["installMaintenanceTokenRoute"]);
  delete process.env.SUNDROP_MAINTENANCE_CLIENT_SHA256;
  const app = fakeApp(); installMaintenanceTokenRoute(app, { getAccessToken: async () => "w" });
  const r = fakeRes(); return app.routes["/api/maintenance/token"]({ headers: {} }, r).then(() => assert.equal(r.code, 503));
});

test("S4 rate limiter returns 429 after the limit", () => {
  let t0 = 0; const rl = createRateLimiter({ windowMs: 1000, max: 2, now: () => t0 });
  const run = () => { const r = fakeRes(); let passed = false; rl({ headers: { "x-forwarded-for": "1.2.3.4" } }, r, () => { passed = true; }); return passed ? 200 : r.code; };
  assert.equal(run(), 200); assert.equal(run(), 200); assert.equal(run(), 429); t0 = 1500; assert.equal(run(), 200);
});
