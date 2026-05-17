#!/usr/bin/env node
// Explore 11: open ZB editor with correct URL, dump DOM & UI, capture getzerocode response (=current ZB JSON).

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PROJECT_ID = "25668306";

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
  console.log(`page=${pageId} record=${recordId}`);

  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US", timezoneId: "Europe/Berlin", storageState: STATE_PATH,
  });

  const network = [];
  const zeroCodeBodies = [];
  context.on("request", (req) => {
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    network.push({ phase: "req", method: req.method(), url: u, postData: req.postData() });
  });
  context.on("response", async (res) => {
    const req = res.request();
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico)\b/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        const buf = await res.body();
        // for getzerocode keep full body
        if (req.postData()?.includes("getzerocode")) {
          zeroCodeBodies.push({ url: u, body: buf.toString("utf8") });
        }
        body = buf.toString("utf8").slice(0, 1500);
      }
    } catch {}
    network.push({ phase: "res", url: u, status: res.status(), body });
  });

  const page = await context.newPage();
  page.on("dialog", async (d) => { console.log(`  DIALOG: ${d.message().substring(0, 100)}`); await d.accept(); });
  page.on("console", (msg) => { if (msg.type() === "error") console.error(`  [console.err] ${msg.text().substring(0, 150)}`); });

  console.log("[1] open ZB editor with correct URL");
  await page.goto(`https://tilda.ru/zero/?recordid=${recordId}&pageid=${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(5000, 8000);
  await dump(page, "110_zb_editor_real");

  console.log("[2] probe DOM");
  const probe = await page.evaluate(() => {
    const out = { iframes: [], toolbarItems: [], fns: [] };
    document.querySelectorAll("iframe").forEach(el => {
      out.iframes.push({ src: (el.src || "").slice(0, 100), id: el.id || "" });
    });
    document.querySelectorAll("[class*='toolbar' i], [class*='action' i], [class*='button' i]").forEach(el => {
      const text = (el.innerText || el.textContent || '').trim().slice(0, 40);
      const cls = (el.className || '').toString().slice(0, 80);
      if (text && text.length < 30) out.toolbarItems.push({ text, cls });
    });
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /tn[_-]?(add|create|insert|save|update)|zb[_-]?(add|save)/i.test(k)) {
          out.fns.push(k);
        }
      } catch {}
    }
    return out;
  });
  console.log(`  iframes: ${probe.iframes.length}`);
  probe.iframes.forEach(f => console.log(`    iframe id="${f.id}" src=${f.src}`));
  console.log(`  toolbar items: ${probe.toolbarItems.length}`);
  probe.toolbarItems.slice(0, 30).forEach(b => console.log(`    "${b.text}" cls="${b.cls}"`));
  console.log(`  fns:`, probe.fns.slice(0, 20));

  // Tilda zero editor is in an iframe. Get its content too.
  const frames = page.frames();
  console.log(`[3] frames: ${frames.length}`);
  for (const f of frames) {
    console.log(`  frame url: ${f.url().substring(0, 100)}`);
  }
  // probe iframe content for "Add text" etc.
  for (const f of frames) {
    if (f === page.mainFrame()) continue;
    if (f.url().includes("zero")) {
      console.log("[4] probe ZB iframe DOM");
      const fp = await f.evaluate(() => {
        const items = [];
        document.querySelectorAll("[class*='toolbar' i], [class*='action' i], button, a, [class*='tool' i]").forEach(el => {
          const t = (el.innerText || el.textContent || '').trim().slice(0, 40);
          const cls = (el.className || '').toString().slice(0, 80);
          const title = el.getAttribute('title') ?? '';
          if (t || title) items.push({ t, cls, title });
        });
        const fns = [];
        for (const k of Object.keys(window)) {
          try {
            if (typeof window[k] === "function" && /tn|atom|element|save|update/i.test(k)) fns.push(k);
          } catch {}
        }
        return { items: items.slice(0, 50), fns: fns.slice(0, 30) };
      }).catch(e => ({ err: e.message.substring(0, 100) }));
      console.log("  iframe probe:", JSON.stringify(fp, null, 2));
    }
  }

  console.log(`\n[5] getzerocode captures: ${zeroCodeBodies.length}`);
  zeroCodeBodies.forEach((z, i) => {
    console.log(`  [${i}] url=${z.url}`);
    console.log(`      body (first 800): ${z.body.substring(0, 800)}`);
  });
  if (zeroCodeBodies.length > 0) {
    writeFileSync(join(OUT_DIR, "explore11_getzerocode.txt"), zeroCodeBodies.map(z => `=== ${z.url} ===\n${z.body}`).join("\n\n"));
  }

  writeFileSync(join(OUT_DIR, "explore11_network.json"), JSON.stringify(network, null, 2));
  console.log(`\n[cleanup] delete page ${pageId}`);
  await deletePage(cookieHeader, pageId);
  await context.close(); await browser.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
