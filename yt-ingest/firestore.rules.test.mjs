import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc } from 'firebase/firestore';
import fs from 'fs';
const rulesFile = process.env.RULES;
const env = await initializeTestEnvironment({ projectId: 'demo-vault', firestore: { rules: fs.readFileSync(rulesFile, 'utf8'), host: '127.0.0.1', port: 8085 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, 'admins/adm'), { isActive: true });
  await setDoc(doc(db, 'sunoSongs/s1'), { title: 't' });
  await setDoc(doc(db, 'sunoSongs/s1/versions/1'), { n: 1 });
  await setDoc(doc(db, 'adminAuditLog/a1'), { e: 1 });
  await setDoc(doc(db, 'users/u1'), { email: 'x' });
  await setDoc(doc(db, 'workspaces/w1'), { n: 1 });
  await setDoc(doc(db, 'workspaces/w1/memberships/u1'), { status: 'active', role: 'viewer' });
});
const anon = env.unauthenticatedContext().firestore();
const user = env.authenticatedContext('u1').firestore();
const adm = env.authenticatedContext('adm').firestore();
const only = process.env.ONLY_PUBLIC === '1';
const results = [];
async function t(name, p, ok) { try { await (ok ? assertSucceeds(p) : assertFails(p)); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
await t('public get sunoSongs/s1', getDoc(doc(anon, 'sunoSongs/s1')), true);
await t('public list sunoSongs', getDocs(collection(anon, 'sunoSongs')), true);
await t('signed-in user get sunoSongs/s1', getDoc(doc(user, 'sunoSongs/s1')), true);
await t('public write sunoSongs denied', setDoc(doc(anon, 'sunoSongs/s2'), { a: 1 }), false);
await t('user reads own profile', getDoc(doc(user, 'users/u1')), true);
await t('user writes own profile', updateDoc(doc(user, 'users/u1'), { a: 1 }), true);
await t('user reads other profile denied', getDoc(doc(user, 'users/adm')), false);
await t('member reads workspace', getDoc(doc(user, 'workspaces/w1')), true);
await t('admin writes sunoSongs', updateDoc(doc(adm, 'sunoSongs/s1'), { a: 1 }), true);
await t('admin writes other collection', setDoc(doc(adm, 'settings/x'), { a: 1 }), true);
await t('admin reads any', getDoc(doc(adm, 'settings/x')), true);
if (!only) {
  await t('admin creates version', setDoc(doc(adm, 'sunoSongs/s1/versions/2'), { n: 2 }), true);
  await t('admin reads version', getDoc(doc(adm, 'sunoSongs/s1/versions/1')), true);
  await t('admin update version denied', updateDoc(doc(adm, 'sunoSongs/s1/versions/1'), { n: 9 }), false);
  await t('admin delete version denied', deleteDoc(doc(adm, 'sunoSongs/s1/versions/1')), false);
  await t('admin stats write ok', setDoc(doc(adm, 'sunoSongs/s1/stats/2026-10-20'), { p: 1 }), true);
  await t('admin reads audit log', getDoc(doc(adm, 'adminAuditLog/a1')), true);
  await t('admin create audit denied', addDoc(collection(adm, 'adminAuditLog'), { e: 2 }), false);
  await t('admin update audit denied', updateDoc(doc(adm, 'adminAuditLog/a1'), { e: 3 }), false);
  await t('admin delete audit denied', deleteDoc(doc(adm, 'adminAuditLog/a1')), false);
  await t('user reads audit denied', getDoc(doc(user, 'adminAuditLog/a1')), false);
  await t('public reads version denied', getDoc(doc(anon, 'sunoSongs/s1/versions/1')), false);
}
await env.cleanup();
for (const r of results) console.log(r.join(' | '));
const f = results.filter(r => r[0] === 'FAIL').length; console.log(`${results.length - f}/${results.length} passed (${rulesFile})`); process.exit(f ? 1 : 0);
