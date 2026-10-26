const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../admin-access");

const SECRET = "x".repeat(40);
const now = Date.now();
const admin = { role: "master_admin", auth_time: Math.floor(now / 1000) - 60 };

function run(mw, req) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, status(c) { this.code = c; return this; },
      json(b) { resolve({ res: this, body: b, next: false }); }, setHeader(k, v) { this.headers[k] = v; } };
    mw(req, res, () => resolve({ res, next: true }));
  });
}

test("roles ladder and unknown roles default to client", () => {
  assert.equal(A.hasRole(admin, "support"), true);
  assert.equal(A.hasRole({ role: "support" }, "master_admin"), false);
  assert.equal(A.roleOf({ role: "god" }), "client");
});

test("only a recently signed-in master admin with a reason can start", () => {
  assert.throws(() => A.startImpersonation({ actorUid: "a", actorClaims: { role: "support", auth_time: admin.auth_time }, subjectUid: "u", reason: "TKT-1", secret: SECRET }), /master_admin/);
  assert.throws(() => A.startImpersonation({ actorUid: "a", actorClaims: admin, subjectUid: "u", reason: "", secret: SECRET }), /reason/);
  assert.throws(() => A.startImpersonation({ actorUid: "a", actorClaims: { ...admin, auth_time: 1 }, subjectUid: "u", reason: "TKT-1", secret: SECRET }), /re-authenticate/);
  const { session } = A.startImpersonation({ actorUid: "a", actorClaims: admin, subjectUid: "u", reason: "TKT-1", secret: SECRET });
  assert.equal(session.mode, "read_only");
  assert.equal(session.exp - session.startedAt, A.IMPERSONATION_TTL_MS);
});

test("tampered or expired tokens are rejected", () => {
  const { token } = A.startImpersonation({ actorUid: "a", actorClaims: admin, subjectUid: "u", reason: "TKT-1", secret: SECRET });
  assert.ok(A.verify(token, SECRET));
  assert.equal(A.verify(token.slice(0, -2) + "zz", SECRET), null);
  assert.equal(A.verify(token, SECRET, now + A.IMPERSONATION_TTL_MS + 1000), null);
});

test("read-only session blocks writes, allows reads, audits both", async () => {
  const log = [];
  const mw = A.viewAsMiddleware({ secret: SECRET, writeAudit: (e) => log.push(e), getActorUid: () => "a" });
  const { token } = A.startImpersonation({ actorUid: "a", actorClaims: admin, subjectUid: "u", reason: "TKT-1", secret: SECRET });
  const read = await run(mw, { method: "GET", url: "/api/songs", headers: { "x-view-as-session": token } });
  assert.equal(read.next, true);
  const write = await run(mw, { method: "POST", url: "/api/x", headers: { "x-view-as-session": token } });
  assert.equal(write.res.code, 403);
  assert.deepEqual(log.map((e) => e.event), ["request", "write_blocked"]);
});

test("another admin cannot reuse a session; redaction hides secrets", async () => {
  const mw = A.viewAsMiddleware({ secret: SECRET, writeAudit: () => {}, getActorUid: () => "b" });
  const { token } = A.startImpersonation({ actorUid: "a", actorClaims: admin, subjectUid: "u", reason: "TKT-1", secret: SECRET });
  assert.equal((await run(mw, { method: "GET", headers: { "x-view-as-session": token } })).res.code, 403);
  assert.equal(A.redactForViewAs({ email: "e", apiTokens: ["t"] }).apiTokens, "[hidden]");
});
