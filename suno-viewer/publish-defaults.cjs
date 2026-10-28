"use strict";

// DEV-43 publish defaults: one system set for everyone (publishDefaults/system),
// each user's saved changes on top (users/{uid}/publishDefaults/current), and a
// reset ("Return to default") that deletes the user's set.

const SYSTEM_FALLBACK = Object.freeze({
  privacy: "private",
  language: "en",
  license: "youtube",
  category: "10",
  alteredContent: true,
  shortsRemixing: true,
  promptPolicy: "none",
  lyricsPolicy: "excerpt",
  description: "",
});

const ENUMS = {
  privacy: ["private", "unlisted", "public"],
  license: ["youtube", "creativeCommon"],
  promptPolicy: ["none", "excerpt", "full-note"],
  lyricsPolicy: ["none", "excerpt", "full"],
};

// Per-song fields: never saved as defaults and hidden in batch mode.
const PER_SONG_FIELDS = ["title", "description", "tags"];
const BATCH_HIDDEN_FIELDS = PER_SONG_FIELDS;

function sanitize(input = {}) {
  const out = {};
  for (const key of Object.keys(SYSTEM_FALLBACK)) {
    if (!(key in input) || input[key] === undefined || input[key] === null) continue;
    const v = input[key];
    if (typeof SYSTEM_FALLBACK[key] === "boolean") {
      if (typeof v === "boolean") out[key] = v;
    } else if (ENUMS[key]) {
      if (ENUMS[key].includes(String(v))) out[key] = String(v);
    } else if (key === "category") {
      if (/^\d{1,3}$/.test(String(v))) out[key] = String(v);
    } else if (key === "language") {
      if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(v))) out[key] = String(v);
    } else if (key === "description") {
      out[key] = String(v).slice(0, 5000);
    }
  }
  return out;
}

/** system -> user -> effective. Unknown or invalid values are dropped, never applied. */
function effectiveDefaults({ system = {}, user = {} } = {}) {
  const sys = { ...SYSTEM_FALLBACK, ...sanitize(system) };
  return { system: sys, user: sanitize(user), effective: { ...sys, ...sanitize(user) } };
}

/** Only keep values that differ from the system set, so later system changes still flow through. */
function userOverrides(saved = {}, system = {}) {
  const sys = { ...SYSTEM_FALLBACK, ...sanitize(system) };
  const clean = sanitize(saved);
  return Object.fromEntries(Object.entries(clean).filter(([k, v]) => sys[k] !== v));
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) };
  }
  return fields;
}

module.exports = { SYSTEM_FALLBACK, ENUMS, PER_SONG_FIELDS, BATCH_HIDDEN_FIELDS, sanitize, effectiveDefaults, userOverrides, toFirestoreFields };
