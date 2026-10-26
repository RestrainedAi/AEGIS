// Sets Firebase custom claim role=master_admin on ONE account. Not run yet.
// Usage (needs Thomas's yes): node set-master-admin-claim.cjs software@blahnikdigitaldesigns.com --apply
const admin = require("firebase-admin");
const [email, flag] = process.argv.slice(2);
if (!email) { console.error("usage: node set-master-admin-claim.cjs <email> [--apply]"); process.exit(2); }
admin.initializeApp({ projectId: "stable-framing-482501-t9" });
(async () => {
  const user = await admin.auth().getUserByEmail(email);
  const claims = { ...(user.customClaims || {}), role: "master_admin" };
  console.log(`${flag === "--apply" ? "APPLY" : "DRY RUN"}: ${email} uid=${user.uid} claims ->`, claims);
  if (flag === "--apply") await admin.auth().setCustomUserClaims(user.uid, claims);
})().catch((e) => { console.error(e.message); process.exit(1); });
