const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const HANDLE = "genxdreams";
const URL = `https://suno.com/@${HANDLE}?page=songs`;

(async () => {
  const outDir = path.join(process.cwd(), "data", "suno");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${HANDLE}.playback_media_urls.json`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const hits = []; // {type,url,method,resourceType,status,ct}

  // Capture outbound requests that look like media
  page.on("request", (req) => {
    const u = req.url();
    if (
      u.includes(".mp3") || u.includes(".mp4") ||
      u.includes("m3u8") || u.includes("mpd") ||
      u.includes("cdn1.suno.ai") ||
      u.includes("cloudfront") ||
      u.includes("/stream") || u.includes("/media") || u.includes("/audio") || u.includes("/video")
    ) {
      hits.push({
        type: "request",
        method: req.method(),
        url: u,
        resourceType: req.resourceType(),
      });
    }
  });

  // Capture responses too (status + content-type)
  page.on("response", async (res) => {
    const u = res.url();
    if (
      u.includes(".mp3") || u.includes(".mp4") ||
      u.includes("m3u8") || u.includes("mpd") ||
      u.includes("cdn1.suno.ai") ||
      u.includes("cloudfront") ||
      u.includes("/stream") || u.includes("/media") || u.includes("/audio") || u.includes("/video")
    ) {
      const headers = res.headers();
      hits.push({
        type: "response",
        status: res.status(),
        url: u,
        contentType: (headers["content-type"] || ""),
      });
    }
  });

  console.log("Opening:", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(6000);

  // Try to click a Play button.
  // We try a few common patterns because Suno UI changes.
  const clicked = await page.evaluate(() => {
    function clickFirst(sel) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
      return false;
    }

    // Common candidates
    const selectors = [
      'button[aria-label*="Play" i]',
      'button[title*="Play" i]',
      '[role="button"][aria-label*="Play" i]',
      'button:has(svg)', // last resort, might click wrong thing
    ];

    for (const s of selectors) {
      if (clickFirst(s)) return `clicked:${s}`;
    }

    // Try within the first clip card
    const firstCard = document.querySelector("a[href*='/song/'], a[href*='/clip/'], li, article, div");
    if (firstCard) {
      const btn = firstCard.querySelector('button[aria-label*="Play" i], [role="button"][aria-label*="Play" i]');
      if (btn) { btn.click(); return "clicked:card_play"; }
    }

    return "no_play_button_found";
  });

  console.log("Play click result:", clicked);

  // Wait for playback/network to kick in
  await page.waitForTimeout(12000);

  fs.writeFileSync(outPath, JSON.stringify({ url: URL, captured: hits }, null, 2), "utf-8");
  console.log("Wrote:", outPath);
  console.log("Captured events:", hits.length);

  // Print the most interesting unique URLs
  const urls = Array.from(new Set(hits.map(h => h.url)));
  console.log("\nUnique URLs (first 30):");
  urls.slice(0, 30).forEach(u => console.log(u));

  await browser.close();
})();
