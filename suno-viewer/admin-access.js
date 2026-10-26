"use strict";
// Master Admin role + "view as user" impersonation (plan step 5).
// Pure helpers; server.js wires them behind MASTER_ADMIN_ENABLED (default off).
// Server-side enforcement only: hiding UI is cosmetic.

const crypto = require("crypto");

const ROLES = Object.freeze({ client: 0, support: 1, master_admin: 2 });
const IMPERSONATION_TTL_MS = 30 * 60 * 1000;
const WRITE_MODE_TTL_MS = 10 * 60 * 1000;
const RECENT_LOGIN_MS = 15 * 60 * 1000;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function roleOf(claims) {
  const role = claims && typeof claims.role === "string" ? claims.role : "client";
  return Object.prototype.hasOwnProperty.call(ROLES, role) ? role : "client";
}

function hasRole(claims, needed) {
  return ROLES[roleOf(claims)] >= ROLES[needed];
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload, secret) {
  if (!secret || secret.length < 32) throw new Error("impersonation secret missing or too short");
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

function verify(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(mac || ""), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!payload || typeof payload.exp !== "number" || payload.exp <= now) return null;
  return payload;
}

/**
 * Start a view-as session. `actorClaims` are the admin's verified Firebase claims
 * (auth_time in seconds). Returns {token, session} or throws with .status.
 */
function startImpersonation({ actorUid, actorClaims, subjectUid, reason, secret, now = Date.now(), mode = "read_only" }) {
  const fail = (status, msg) => Object.assign(new Error(msg), { status });
  if (!hasRole(actorClaims, "master_admin")) throw fail(403, "master_admin required");
  if (!subjectUid || subjectUid === actorUid) throw fail(400, "pick another user");
  if (!reason || String(reason).trim().length < 4) throw fail(400, "reason required (e.g. ticket #)");
  const authTimeMs = Number(actorClaims.auth_time || 0) * 1000;
  if (!authTimeMs || now - authTimeMs > RECENT_LOGIN_MS) throw fail(401, "re-authenticate (login older than 15 min)");
  if (mode !== "read_only" && mode !== "write") throw fail(400, "bad mode");
  const ttl = mode === "write" ? WRITE_MODE_TTL_MS : IMPERSONATION_TTL_MS;
  const session = {
    sessionId: crypto.randomUUID(), actor: actorUid, subject: subjectUid,
    mode, reason: String(reason).trim().slice(0, 200), startedAt: now, exp: now + ttl,
  };
  return { token: sign(session, secret), session };
}

function auditEntry(session, event, req, extra = {}) {
  return {
    sessionId: session.sessionId, actor: session.actor, subject: session.subject,
    mode: session.mode, event, at: new Date().toISOString(),
    method: req && req.method, path: req && (req.originalUrl || req.url),
    ip: req && (req.headers?.["x-forwarded-for"] || req.ip || ""),
    userAgent: req && req.headers?.["user-agent"] || "", ...extra,
  };
}

/**
 * Express middleware. Reads header x-view-as-session; when valid, sets
 * req.viewAs = session and req.effectiveUid = subject; blocks writes in
 * read-only mode; calls writeAudit(entry) for every request (never awaits failure).
 */
function viewAsMiddleware({ secret, writeAudit, getActorUid }) {
  return function viewAs(req, res, next) {
    const raw = req.headers["x-view-as-session"];
    if (!raw) return next();
    const session = verify(String(raw), secret);
    if (!session) return res.status(401).json({ error: "view-as session invalid or expired" });
    const actor = getActorUid(req);
    if (!actor || actor !== session.actor) return res.status(403).json({ error: "view-as session belongs to another admin" });
    const blocked = session.mode === "read_only" && MUTATING.has(String(req.method).toUpperCase());
    Promise.resolve(writeAudit(auditEntry(session, blocked ? "write_blocked" : "request", req))).catch(() => {});
    if (blocked) return res.status(403).json({ error: "read-only view-as session: changes are blocked" });
    req.viewAs = session;
    req.effectiveUid = session.subject;
    res.setHeader("x-view-as-active", "1");
    return next();
  };
}

/** Fields never shown to an impersonating admin. */
const REDACT_FOR_VIEW_AS = ["passwordHash", "paymentMethods", "apiTokens", "stripeCustomerId", "refreshToken"];
function redactForViewAs(userDoc) {
  const copy = { ...(userDoc || {}) };
  for (const k of REDACT_FOR_VIEW_AS) if (k in copy) copy[k] = "[hidden]";
  return copy;
}

module.exports = {
  ROLES, IMPERSONATION_TTL_MS, WRITE_MODE_TTL_MS, roleOf, hasRole, sign, verify,
  startImpersonation, auditEntry, viewAsMiddleware, redactForViewAs,
};
