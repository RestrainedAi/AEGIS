const { chromium } = require("playwright");

const url = "https://suno.com/@unshakableechos2341?page=songs";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  const html = await page.content();

  console.log("TITLE:", title);
  console.log("HTML_LEN:", html.length);

  const needles = [
    "Just a moment",
    "Checking your browser",
    "Attention Required",
    "cloudflare",
    "cf-challenge",
    "verify you are human",
  ];
  for (const n of needles) {
    console.log(`HAS("${n}"):`, html.toLowerCase().includes(n.toLowerCase()));
  }

  // quick UUID count in the HTML we got
  const uuids = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig) || [];
  console.log("UUID_HITS:", uuids.length, "UNIQUE:", new Set(uuids.map(x=>x.toLowerCase())).size);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
