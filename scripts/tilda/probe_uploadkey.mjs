import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, args: ["--no-sandbox"], viewport: { width: 1920, height: 1080 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36" });
const fs = await import("node:fs");
const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
await ctx.addCookies(state.cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: c.sameSite === "Lax" ? "Lax" : c.sameSite === "None" ? "None" : "Lax" })));
const page = await ctx.newPage();
await page.goto("https://tilda.ru/zero/?recordid=2278551161&pageid=142152986", { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(()=>{});
await new Promise(r => setTimeout(r, 3000));

const info = await page.evaluate(() => {
  const out = {};
  // Look at Tildaupload source
  if (typeof window.Tildaupload === "function") {
    out.Tildaupload = window.Tildaupload.toString().slice(0, 800);
  }
  // Look at any 'publickey' globals
  const candidates = ["tildaupload_publickey", "upload_publickey", "tu_publickey", "tu", "Tildaupload"];
  for (const k of Object.keys(window)) {
    if (/publickey|upload.*key|tildaupload/i.test(k)) {
      try { 
        const v = window[k];
        if (typeof v === "string" || typeof v === "number") out[k] = String(v);
      } catch {}
    }
  }
  // Also: Tilda's tu object
  if (window.tu) {
    out.tu_keys = Object.keys(window.tu).slice(0, 20);
    if (window.tu.publickey) out.tu_publickey = String(window.tu.publickey);
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await ctx.close();
