#!/usr/bin/env node
import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const PROJECT_ID = "25668306";

async function loadCookieHeader() {
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const now = Date.now() / 1000;
  return state.cookies
    .filter(c => (c.domain.startsWith(".") ? c.domain.slice(1) : c.domain) === "tilda.ru" || c.domain === ".tilda.ru")
    .filter(c => c.expires < 0 || c.expires > now)
    .map(c => `${c.name}=${c.value}`).join("; ");
}
async function setupViaXhr(cookieHeader) {
  const baseHeaders = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": cookieHeader, "Origin": "https://tilda.ru", "Referer": "https://tilda.ru/projects/",
    "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  };
  const cp = await fetch("https://tilda.ru/projects/submit/", { method: "POST", headers: baseHeaders, body: new URLSearchParams({ comm: "addnewpagedublicateexample", projectid: PROJECT_ID, examplepageid: "1231", folderid: "", csrf: "" }) });
  const pageId = (await cp.text()).trim();
  const ab = await fetch("https://tilda.ru/page/submit/", { method: "POST", headers: baseHeaders, body: new URLSearchParams({ comm: "addnewrecord", pageid: pageId, tplid: "396", with_code: "yes" }) });
  const raw = (await ab.text()).replace(/^<!--tlp-->\s*/, "");
  const recordId = JSON.parse(raw).html.match(/id="record(\d+)"/)?.[1];
  return { pageId, recordId };
}
async function deletePage(cookieHeader, pageId) {
  await fetch("https://tilda.ru/projects/submit/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieHeader, "Origin": "https://tilda.ru", "Referer": "https://tilda.ru/projects/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*" },
    body: new URLSearchParams({ comm: "delpage", pageid: pageId, csrf: "" }),
  });
}

const cookieHeader = await loadCookieHeader();
const { pageId, recordId } = await setupViaXhr(cookieHeader);
console.log(`page=${pageId} zb=${recordId}`);

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  viewport: { width: 1920, height: 1080 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  locale: "en-US", timezoneId: "Europe/Berlin",
});
const fs = await import("node:fs");
const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
await context.addCookies(state.cookies.map(c => ({
  name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires,
  httpOnly: !!c.httpOnly, secure: !!c.secure,
  sameSite: c.sameSite === "Lax" ? "Lax" : c.sameSite === "None" ? "None" : c.sameSite === "Strict" ? "Strict" : "Lax",
})));

const page = context.pages()[0] ?? await context.newPage();
page.on("dialog", d => d.accept());

await page.goto(`https://tilda.ru/zero/?recordid=${recordId}&pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
await new Promise(r => setTimeout(r, 4000));

const dumps = await page.evaluate(() => {
  const out = {};
  const ef = window.tn?.elemFields;
  if (ef) {
    for (const key of ["bgImageField", "bgColorField", "effectsField", "linkFields", "basicAnimationFields", "sbsAnimationFields", "borderFields", "shadowFields", "imageFields", "imgUploadFields"]) {
      const v = ef[key];
      if (v == null) continue;
      try { out[key] = JSON.parse(JSON.stringify(v)); } catch { out[key] = String(v).slice(0, 1000); }
    }
  }
  // also ab_fields list — these are numbered, get their names
  if (window.tn?.ab_fields) {
    const abList = [];
    for (const [k, v] of Object.entries(window.tn.ab_fields)) {
      const f = typeof v === "object" && v.field ? v.field : (typeof v === "object" ? Object.keys(v) : v);
      abList.push({ k, name: typeof v === "object" ? v.field || v.name || v.t || "?" : "?", type: typeof v, keys: typeof v === "object" ? Object.keys(v).slice(0, 8) : null });
    }
    out._ab_fields = abList;
  }
  return out;
});

writeFileSync("/tmp/elem_fields_dump.json", JSON.stringify(dumps, null, 2));
console.log("dump len:", JSON.stringify(dumps).length);
console.log("\n=== summary ===");
console.log(`ab_fields entries: ${dumps._ab_fields?.length}`);
for (const k of Object.keys(dumps)) {
  if (k === "_ab_fields") continue;
  const v = dumps[k];
  console.log(`  ${k}: type=${typeof v}, ${Array.isArray(v) ? "array len=" + v.length : (typeof v === "object" ? "keys=" + Object.keys(v).join(",") : v.slice(0, 80))}`);
}
console.log("\n--- ab_fields ---");
dumps._ab_fields?.forEach(f => console.log(`  [${f.k}] name=${f.name} keys=${f.keys?.join(",")}`));

await deletePage(cookieHeader, pageId);
await context.close();
