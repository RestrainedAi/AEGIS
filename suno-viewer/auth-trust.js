"use strict";
// S3: who counts as a trusted, verified identity, and who is a platform admin.
// Pure helpers so they can be unit-tested without Firebase.

const DEFAULT_ALLOWED_PROVIDERS = ["google.com"];

function allowedProviders(envValue) {
  const list = String(envValue || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_ALLOWED_PROVIDERS;
}

// A decoded Firebase ID token is trusted only when the email is verified AND the
// sign-in provider is allowed (google.com by default). Password / anonymous /
// custom tokens are never trusted for access decisions.
function isTrustedIdentity(decoded, providers = DEFAULT_ALLOWED_PROVIDERS) {
  if (!decoded || typeof decoded !== "object") return false;
  if (decoded.email_verified !== true) return false;
  const provider = decoded.firebase && decoded.firebase.sign_in_provider;
  return typeof provider === "string" && providers.includes(provider);
}

function trustedEmail(decoded, providers) {
  return isTrustedIdentity(decoded, providers)
    ? String(decoded.email || "").trim().toLowerCase()
    : "";
}

// Platform admin = verified identity AND (custom claim role=master_admin OR an
// active admins/{uid} doc OR a bootstrap email from the token itself, never the profile).
function isPlatformAdminIdentity({ decoded, providers, adminDoc, bootstrapEmails, fsBool }) {
  if (!isTrustedIdentity(decoded, providers)) return false;
  if (decoded.role === "master_admin") return true;
  if (adminDoc && fsBool && (fsBool(adminDoc, "isActive") || fsBool(adminDoc, "is_active"))) return true;
  const email = trustedEmail(decoded, providers);
  return Boolean(email) && bootstrapEmails instanceof Set && bootstrapEmails.has(email);
}

module.exports = {
  DEFAULT_ALLOWED_PROVIDERS,
  allowedProviders,
  isTrustedIdentity,
  trustedEmail,
  isPlatformAdminIdentity,
};
