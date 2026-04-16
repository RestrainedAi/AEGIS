const { chromium } = require("playwright");

(async()=>{
  const url="https://suno.com/@unshakableechos2341?page=songs";
  const b=await chromium.launch({headless:true});
  const p=await (await b.newContext({viewport:{width:1280,height:900}})).newPage();

  p.on("request", req => {
    const u=req.url();
    if (u.includes("api") || u.includes("trpc") || u.includes("graphql") || u.includes(".json")) {
      console.log("REQ", req.method(), u);
    }
  });

  p.on("response", async res => {
    const u=res.url();
    const ct=(res.headers()["content-type"]||"").toLowerCase();
    if ((u.includes("api") || u.includes("trpc") || u.includes("graphql") || u.includes(".json")) && ct.includes("application/json")) {
      console.log("RES", res.status(), u, ct);
    }
  });

  await p.goto(url,{waitUntil:"domcontentloaded",timeout:120000});
  await p.waitForTimeout(5000);

  // scroll the known container a few times
  for (let i=0;i<18;i++){
    await p.evaluate(()=>{
      const el=document.querySelector("div.h-full.w-full.overflow-x-hidden.overflow-y-auto");
      if (el) el.scrollTop = Math.min(el.scrollTop + Math.floor(el.clientHeight*0.92), el.scrollHeight);
    });
    await p.waitForTimeout(3000);
  }

  await b.close();
})();
