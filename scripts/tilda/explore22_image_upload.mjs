#!/usr/bin/env node
// Explore 22: capture Tilda image upload endpoint.
// Approach: open a Zero Block editor, drag-drop a local PNG into the image elem upload UI,
// capture the multipart upload XHR.
//
// Setup: clean test page + ZB block via XHR; then headed mode; programmatically trigger
// the file-input via setInputFiles().

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PROJECT_ID = "25668306";

mkdirSync(OUT_DIR, { recursive: true });

// Make a tiny test PNG (1×1) on the fly to upload
async function createTestPng() {
  const path = "/tmp/tilda-mcp-test.png";
  if (existsSync(path)) return path;
  // 1×1 red PNG via base64
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, Buffer.from(b64, "base64"));
  return path;
}

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }
async function dump(page, label) {
  const safe = label.replace(/[^a-z0-9_-]/gi, "_");
  await page.screenshot({ path: join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
  writeFileSync(join(OUT_DIR, `${safe}.html`), await page.content().catch(() => "<error>"));
}

async function loadCookieHeader() {
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const now = Date.now() / 1000;
  return state.cookies
    .filter((c) => (c.domain.startsWith(".") ? c.domain.slice(1) : c.domain) === "tilda.ru" || c.domain === ".tilda.ru")
    .filter((c) => c.expires < 0 || c.expires > now)
    .map((c) => `${c.name}=${c.value}`).join("; ");
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

async function main() {
  const cookieHeader = await loadCookieHeader();
  const { pageId, recordId } = await setupViaXhr(cookieHeader);
  console.log(`page=${pageId} zb=${recordId}`);

  const testPng = await createTestPng();
  console.log(`test png: ${testPng}`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", slowMo: 200,
  });
  const fs = await import("node:fs");
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  await context.addCookies(state.cookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires,
    httpOnly: !!c.httpOnly, secure: !!c.secure,
    sameSite: c.sameSite === "Lax" ? "Lax" : c.sameSite === "None" ? "None" : c.sameSite === "Strict" ? "Strict" : "Lax",
  })));

  const uploadCalls = [];
  context.on("request", (req) => {
    const u = req.url();
    if (!u.match(/tilda/)) return;
    if (req.method() !== "POST") return;
    const pd = req.postData() || "";
    if (/upload|image|file|cdn/i.test(u) || pd.length > 1000) {
      uploadCalls.push({ phase: "req", url: u, method: req.method(), headers: req.headers(), postDataPreview: pd.slice(0, 400), postSize: pd.length });
    }
  });
  context.on("response", async (res) => {
    const req = res.request();
    const u = req.url();
    if (!u.match(/tilda/)) return;
    if (req.method() !== "POST") return;
    if (!/upload|image|file|cdn/i.test(u)) return;
    let body = "";
    try { body = (await res.body()).toString("utf8").slice(0, 1500); } catch {}
    uploadCalls.push({ phase: "res", url: u, status: res.status(), body });
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] open ZB editor");
  await page.goto(`https://tilda.ru/zero/?recordid=${recordId}&pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(4000, 6000);
  await dump(page, "220_zb_open");

  console.log("[2] probe upload-related JS functions");
  const fns = await page.evaluate(() => {
    const out = [];
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /upload|chooseFile|attachFile|imageFromComp|tu_upload|fileuploader/i.test(k)) {
          out.push(k);
        }
      } catch {}
    }
    return out.sort();
  });
  console.log(`  ${fns.length} upload fns:`);
  fns.slice(0, 30).forEach(f => console.log(`    ${f}`));

  console.log("\n[3] enumerate file inputs in DOM");
  const inputs = await page.evaluate(() => {
    return [...document.querySelectorAll('input[type="file"]')].map(el => ({
      name: el.name || "", id: el.id || "",
      accept: el.accept || "", cls: (el.className || "").toString().slice(0, 80),
      parentCls: (el.parentElement?.className || "").toString().slice(0, 80),
    }));
  });
  console.log(`  file inputs: ${inputs.length}`);
  inputs.forEach(i => console.log(`    name="${i.name}" id="${i.id}" accept="${i.accept}" cls="${i.cls.slice(0, 50)}"`));

  console.log("\n[4] add Image element via JS — programmatic addElem__createImage");
  const addRes = await page.evaluate(() => {
    if (typeof window.addElem__create !== "function") return { err: "no addElem__create" };
    try {
      const r = window.addElem__create({ elem_type: "image" });
      return { ok: true, result: typeof r === "object" ? "<elem>" : String(r) };
    } catch (e) { return { err: String(e).slice(0, 200) }; }
  });
  console.log("  add image result:", addRes);
  await jitter(2000, 3000);

  console.log("\n[5] now find newly-added image element and trigger its upload");
  // After addElem__createImage we should have a new tn-elem with image atom. Find file input that appeared.
  const inputs2 = await page.evaluate(() => {
    return [...document.querySelectorAll('input[type="file"]')].map(el => ({
      name: el.name || "", id: el.id || "",
      accept: el.accept || "", cls: (el.className || "").toString().slice(0, 80),
    }));
  });
  console.log(`  file inputs now: ${inputs2.length}`);
  inputs2.forEach(i => console.log(`    name="${i.name}" id="${i.id}" accept="${i.accept}" cls="${i.cls.slice(0, 50)}"`));

  // Find an upload <input type=file> with image accept and setInputFiles
  if (inputs2.length > 0) {
    const preUpload = uploadCalls.length;
    const target = inputs2.find(i => /image/i.test(i.accept) || /image/i.test(i.cls)) ?? inputs2[0];
    const sel = target.id ? `input#${target.id}` : (target.name ? `input[name="${target.name}"]` : 'input[type="file"]');
    console.log(`  uploading test PNG into ${sel}`);
    try {
      await page.locator(sel).first().setInputFiles(testPng, { timeout: 5000 });
    } catch (e) {
      console.log(`    setInputFiles err: ${e.message.substring(0, 120)}`);
    }
    await jitter(5000, 8000);
    console.log(`\n  upload-related calls: ${uploadCalls.length - preUpload}`);
    uploadCalls.slice(preUpload).forEach((c, i) => {
      console.log(`    [${preUpload + i}] ${c.phase} ${c.status || c.method} ${c.url.substring(0, 90)}`);
      if (c.postDataPreview && c.postDataPreview.length < 300) console.log(`       post: ${c.postDataPreview.substring(0, 200)}`);
      if (c.postSize) console.log(`       postSize: ${c.postSize}b`);
      if (c.body) console.log(`       body: ${c.body.substring(0, 250).replace(/\n/g, " ")}`);
    });
  }

  writeFileSync(join(OUT_DIR, "explore22_upload.json"), JSON.stringify(uploadCalls, null, 2));

  console.log("\n[cleanup] delete page");
  await deletePage(cookieHeader, pageId);
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
