process.env.PLAYWRIGHT_VNC_CDP_URL = "http://192.168.117.5:9222";
process.env.PLAYWRIGHT_VNC_CAMOUFOX_WS = "ws://192.168.117.5:9224/camoufox";
const b = require("/app/lib/browser/index.js");
(async () => {
  const html = await b.loadPage("https://example.com/", {
    evaluate: async (page) => { await b.waitForChallengeToClear(page); return page.content(); },
  });
  console.log("example.com len:", html.length, "hasTitle:", html.includes("Example Domain"));
  const dataUrl = "data:text/html," + encodeURIComponent("<html><body><div id=o>orig</div><script>document.getElementById('o').textContent='JS_RAN_OK'</script></body></html>");
  const j = await b.loadPage(dataUrl, { waitUntil: "load", evaluate: async (p) => p.content() });
  console.log("js marker present:", j.includes("JS_RAN_OK"));
  await b.closeBrowser();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
