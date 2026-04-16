const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const HANDLE = process.argv[2] || "genxdreams";
const URL = `https://suno.com/@${HANDLE}?page=songs`;

const OUT_DIR = path.join(process.cwd(), "data", "suno");
const OUT_JSON = path.join(OUT_DIR, `${HANDLE}.public.full.json`);
const OUT_JSONL = path.join(OUT_DIR, `${HANDLE}.public.full.jsonl`);
const DBG_DIR = path.join(OUT_DIR, "debug");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractFromHtml(html) {
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
  const mp3Re = /https:\/\/cdn1\.suno\.ai\/([0-9a-f-]{36})\.mp3/ig;
  const mp4Re = /https:\/\/cdn1\.suno\.ai\/([0-9a-f-]{36})\.mp4/ig;

  const uuidHits = html.match(uuidRe) || [];
  const ids = new Set(uuidHits.map(x => x.toLowerCase()));

  const mp3 = new Set();
  let m;
  while ((m = mp3Re.exec(html)) !== null) mp3.add(m[1].toLowerCase());

  const mp4 = new Set();
  while ((m = mp4Re.exec(html)) !== null) mp4.add(m[1].toLowerCase());

  return { ids, mp3, mp4, uuidHitCount: uuidHits.length };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DBG_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  });

  const page = await context.newPage();

  console.log(`Opening: ${URL}`);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Hydration time
  await page.waitForTimeout(4500);

  // Identify best scroll container (overflow-y auto/scroll and tall scrollHeight)
  const scrollInfo = await page.evaluate(() => {
    const els = [...document.querySelectorAll("*")]
      .map(e => {
        const s = getComputedStyle(e);
        const oy = s.overflowY;
        if ((oy !== "auto" && oy !== "scroll") || e.scrollHeight <= e.clientHeight + 500) return null;
        return {
          tag: e.tagName,
          id: e.id || "",
          cls: (e.className || "").toString(),
          sh: e.scrollHeight,
          ch: e.clientHeight,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.sh - b.ch) - (a.sh - a.ch));

    const best = els[0] || null;
    return best;
  });

  if (!scrollInfo) {
    console.log("Could not find a scrollable container. Falling back to window scroll.");
  } else {
    console.log("Scroll container:", scrollInfo);
  }

  // Build a selector for the scroll container.
  // If it matches your earlier class exactly, prefer that.
  const SCROLL_SEL = "div.h-full.w-full.overflow-x-hidden.overflow-y-auto";

  const seen = new Map(); // songKey -> item

  async function collectOnce() {
    const html = await page.content();
    const { ids, mp3, mp4, uuidHitCount } = extractFromHtml(html);

    let added = 0;
    for (const id of ids) {
      const prev = seen.get(id) || { songKey: id, title: "", audio_url: "", video_url: "", image_url: "" };
      if (!seen.has(id)) added++;

      if (mp3.has(id)) prev.audio_url = `https://cdn1.suno.ai/${id}.mp3`;
      if (mp4.has(id)) prev.video_url = `https://cdn1.suno.ai/${id}.mp4`;

      seen.set(id, prev);
    }
    return { added, total: seen.size, uuidHitCount };
  }

  async function scrollContainerStep() {
    // Try preferred selector first; if missing, scroll the "best" container we found
    return page.evaluate((sel) => {
      function findBest() {
        const candidates = [...document.querySelectorAll("*")].filter(e => {
          const s = getComputedStyle(e);
          return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 500;
        });
        candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
        return candidates[0] || null;
      }

      const el = document.querySelector(sel) || findBest();
      if (!el) return { ok: false, reason: "no-scroll-el" };

      const before = el.scrollTop;
      const step = Math.floor(el.clientHeight * 0.92);
      el.scrollTop = Math.min(el.scrollTop + step, el.scrollHeight);
      const after = el.scrollTop;

      return {
        ok: true,
        before,
        after,
        sh: el.scrollHeight,
        ch: el.clientHeight,
        atBottom: after >= el.scrollHeight - el.clientHeight - 5,
      };
    }, SCROLL_SEL);
  }

  // Initial collect
  let r = await collectOnce();
  console.log(`Initial: +${r.added}, total=${r.total}, uuidHits=${r.uuidHitCount}`);

  // Lazy pagination loop
  let stableRounds = 0;
  let waitMs = 2500;
  const maxRounds = 1500;   // enough runway for ~933 items
  const stableLimit = 14;   // be patient (you observed long stalls)

  for (let round = 1; round <= maxRounds; round++) {
    const sc = await scrollContainerStep();
    await sleep(waitMs);

    const before = seen.size;
    r = await collectOnce();
    const after = seen.size;

    process.stdout.write(
      `Round ${round}: +${r.added}, total=${r.total}, wait=${waitMs}ms, uuidHits=${r.uuidHitCount}, atBottom=${sc.atBottom ?? "?"}        \r`
    );

    if (after === before) {
      stableRounds++;
      waitMs = Math.min(waitMs + 1000, 25000);
    } else {
      stableRounds = 0;
      waitMs = Math.max(2000, waitMs - 250);
    }

    // Debug snapshot every 75 rounds
    if (round % 75 === 0) {
      const snapPath = path.join(DBG_DIR, `round_${round}_total_${seen.size}.html`);
      fs.writeFileSync(snapPath, await page.content(), "utf-8");
    }

    // If we’ve been stable for a while AND container reports bottom, we can stop sooner.
    if (stableRounds >= stableLimit) {
      console.log(`\nStopping: no new items for ${stableRounds} rounds.`);
      break;
    }
  }

  const all = Array.from(seen.values()).sort((a, b) => a.songKey.localeCompare(b.songKey));
  fs.writeFileSync(OUT_JSON, JSON.stringify({ handle: HANDLE, url: URL, count: all.length, items: all }, null, 2), "utf-8");
  fs.writeFileSync(OUT_JSONL, all.map(x => JSON.stringify(x)).join("\n") + "\n", "utf-8");

  console.log(`\nSaved: ${OUT_JSON}`);
  console.log(`Saved: ${OUT_JSONL}`);
  console.log(`Final count: ${all.length}`);

  await browser.close();
})().catch((err) => {
  console.error("\nCollector failed:", err);
  process.exit(1);
});
