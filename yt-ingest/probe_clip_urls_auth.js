const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const HANDLE = "unshakableechos2341";
const OUT_DIR = path.join(process.cwd(), "data", "suno");
const CSV_PATH = path.join(OUT_DIR, `${HANDLE}.studio_api.manifest.csv`);
const OUT = path.join(OUT_DIR, `${HANDLE}.auth_probe.json`);

function findUrls(obj, acc = []) {
  if (!obj) return acc;
  if (typeof obj === "string") {
    if (obj.startsWith("http")) acc.push(obj);
    return acc;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) findUrls(x, acc);
    return acc;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) findUrls(obj[k], acc);
  }
  return acc;
}

function isLikelyMedia(u) {
  return typeof u === "string" && (
    u.includes(".mp3") || u.includes(".mp4") ||
    u.includes("cdn1.suno.ai") || u.includes("cdn2.suno.ai")
  );
}

function isSigned(u) {
  return typeof u === "string" && u.includes("?") &&
    (u.includes("X-Amz-") || u.includes("token=") || u.includes("Signature") || u.includes("Expires"));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(CSV_PATH)) {
    console.error("Missing:", CSV_PATH);
    process.exit(1);
  }

  const lines = fs.readFileSync(CSV_PATH, "utf-8").split(/\r?\n/).slice(1).filter(Boolean);
  const ids = lines.slice(0, 10).map(l => l.split(",")[0]);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log("Opening Suno profile. If login is required, please login now.");
  await page.goto(`https://suno.com/@${HANDLE}?page=songs`, { waitUntil: "domcontentloaded", timeout: 120000 });

  console.log("Waiting 90s for login...");
  await page.waitForTimeout(90000);

  const results = [];
  for (const id of ids) {
    const url = `https://studio-api.prod.suno.com/api/clip/${id}`;
    const res = await page.request.get(url, { headers: { Accept: "application/json" } });
    const status = res.status();
    let data = null;
    try { data = await res.json(); } catch { data = null; }

    const urls = findUrls(data, []).filter(isLikelyMedia);
    const signed = urls.filter(isSigned);

    results.push({
      id,
      status,
      media_urls_count: urls.length,
      signed_urls_count: signed.length,
      sample_media_urls: urls.slice(0, 8),
      sample_signed_urls: signed.slice(0, 5),
    });

    console.log(`clip ${id}: status=${status} media_urls=${urls.length} signed=${signed.length}`);
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2), "utf-8");
  console.log("Wrote:", OUT);

  await browser.close();
})();
