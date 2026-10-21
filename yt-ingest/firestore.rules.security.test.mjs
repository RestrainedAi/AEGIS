// Emulator tests for S1-S3 plus the existing versioning/audit rules.
// Run: RULES=path/to/firestore.rules npx firebase emulators:exec --only firestore "node firestore.rules.security.test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc } from 'firebase/firestore';
import fs from 'fs';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-vault', firestore: { rules: fs.readFileSync(process.env.RULES, 'utf8'), host, port: Number(port) } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, 'admins/adm'), { isActive: true });
  await setDoc(doc(db, 'admins/pwadm'), { isActive: true });
  await setDoc(doc(db, 'sunoSongs/s1'), { title: 't' });
  await setDoc(doc(db, 'sunoSongs/s1/versions/1'), { n: 1 });
  await setDoc(doc(db, 'adminAuditLog/a1'), { e: 1 });
  await setDoc(doc(db, 'users/u1'), { email: 'u1@x.com', displayName: 'U', betaStatus: 'active', betaExpiresAt: '2026-11-01T00:00:00Z' });
  await setDoc(doc(db, 'workspaces/w1'), { n: 1 });
  await setDoc(doc(db, 'workspaces/w1/memberships/u1'), { status: 'active', role: 'viewer' });
});
const g = (extra = {}) => ({ email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...extra });
const anon = env.unauthenticatedContext().firestore();
const user = env.authenticatedContext('u1', g({ email: 'u1@x.com' })).firestore();
const member = env.authenticatedContext('m1', g({ vaultMember: true })).firestore();
const master = env.authenticatedContext('ma', g({ role: 'master_admin', email: 'software@blahnikdigitaldesigns.com' })).firestore();
const adm = env.authenticatedContext('adm', g()).firestore();
const pwAdmin = env.authenticatedContext('pwadm', { email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore();
const unverified = env.authenticatedContext('uv', { email_verified: false, firebase: { sign_in_provider: 'google.com' }, vaultMember: true, role: 'master_admin' }).firestore();
const results = [];
async function t(name, p, ok) { try { await (ok ? assertSucceeds(p) : assertFails(p)); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
// S1
await t('S1 anon get sunoSongs denied', getDoc(doc(anon, 'sunoSongs/s1')), false);
await t('S1 anon list sunoSongs denied', getDocs(collection(anon, 'sunoSongs')), false);
await t('S1 plain signed-in user denied', getDoc(doc(user, 'sunoSongs/s1')), false);
await t('S1 vaultMember reads', getDoc(doc(member, 'sunoSongs/s1')), true);
await t('S1 master_admin reads', getDoc(doc(master, 'sunoSongs/s1')), true);
await t('S1 admin doc reads + lists', getDocs(collection(adm, 'sunoSongs')), true);
await t('S1 unverified claims denied', getDoc(doc(unverified, 'sunoSongs/s1')), false);
await t('S1 anon write denied', setDoc(doc(anon, 'sunoSongs/s2'), { a: 1 }), false);
await t('S1 member write denied', updateDoc(doc(member, 'sunoSongs/s1'), { a: 1 }), false);
// S2
await t('S2 user reads own profile', getDoc(doc(user, 'users/u1')), true);
await t('S2 user updates displayName/photoURL', updateDoc(doc(user, 'users/u1'), { displayName: 'New', photoURL: 'https://x/p.png' }), true);
await t('S2 user betaExpiresAt write denied', updateDoc(doc(user, 'users/u1'), { betaExpiresAt: '2099-01-01T00:00:00Z' }), false);
await t('S2 user betaStatus write denied', updateDoc(doc(user, 'users/u1'), { betaStatus: 'lifetime' }), false);
await t('S2 user email write denied', updateDoc(doc(user, 'users/u1'), { email: 'blahnikdigitaldesigns@gmail.com' }), false);
await t('S2 user mixed write denied', updateDoc(doc(user, 'users/u1'), { displayName: 'x', status: 'active' }), false);
await t('S2 user delete own profile denied', deleteDoc(doc(user, 'users/u1')), false);
await t('S2 new user create with only cosmetics ok', setDoc(doc(env.authenticatedContext('u9', g()).firestore(), 'users/u9'), { displayName: 'n' }), true);
await t('S2 new user create with audience denied', setDoc(doc(env.authenticatedContext('u8', g()).firestore(), 'users/u8'), { displayName: 'n', audience: 'beta' }), false);
await t('S2 user reads other profile denied', getDoc(doc(user, 'users/adm')), false);
await t('S2 admin edits user profile', updateDoc(doc(adm, 'users/u1'), { betaStatus: 'expired' }), true);
// S3
await t('S3 password-provider admin doc gets no admin read', getDoc(doc(pwAdmin, 'settings/x')), false);
await t('S3 password-provider admin cannot write songs', updateDoc(doc(pwAdmin, 'sunoSongs/s1'), { a: 1 }), false);
await t('S3 unverified master_admin claim denied', getDoc(doc(unverified, 'adminAuditLog/a1')), false);
await t('S3 master_admin claim writes songs', updateDoc(doc(master, 'sunoSongs/s1'), { a: 1 }), true);
// carried-over behavior
await t('member reads workspace', getDoc(doc(user, 'workspaces/w1')), true);
await t('admin writes sunoSongs', updateDoc(doc(adm, 'sunoSongs/s1'), { b: 1 }), true);
await t('admin writes other collection', setDoc(doc(adm, 'settings/x'), { a: 1 }), true);
await t('admin creates version', setDoc(doc(adm, 'sunoSongs/s1/versions/2'), { n: 2 }), true);
await t('admin update version denied', updateDoc(doc(adm, 'sunoSongs/s1/versions/1'), { n: 9 }), false);
await t('admin delete version denied', deleteDoc(doc(adm, 'sunoSongs/s1/versions/1')), false);
await t('admin stats write ok', setDoc(doc(adm, 'sunoSongs/s1/stats/2026-10-20'), { p: 1 }), true);
await t('admin reads audit log', getDoc(doc(adm, 'adminAuditLog/a1')), true);
await t('admin create audit denied', addDoc(collection(adm, 'adminAuditLog'), { e: 2 }), false);
await t('admin delete audit denied', deleteDoc(doc(adm, 'adminAuditLog/a1')), false);
await t('anon reads version denied', getDoc(doc(env.unauthenticatedContext().firestore(), 'sunoSongs/s1/versions/1')), false);
await t('anon reads version (fresh) denied', getDoc(doc(env.unauthenticatedContext().firestore(), 'sunoSongs/s1/versions/2')), false);
await t('plain user reads version denied', getDoc(doc(user, 'sunoSongs/s1/versions/1')), false);
await env.cleanup();
for (const r of results) console.log(r.join(' | '));
const f = results.filter((r) => r[0] === 'FAIL').length; console.log(`${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);

