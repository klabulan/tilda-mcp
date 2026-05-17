#!/usr/bin/env node
// Explore 13: click "Инструменты" → add text element → trigger save (Ctrl+S or save button).
// Capture POST /zero/* save endpoint.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142152756";
const RECORD_ID = process.env.RECORD_ID ?? "2278548451";

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }

async function main() {
  console.log(`[setup] HEADED Chromium`);
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
  await context.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
  });

  const network = [];
  const zeroCalls = [];
  context.on("request", (req) => {
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    network.push({ phase: "req", method: req.method(), url: u, postData: req.postData(), hdr: req.headers() });
  });
  context.on("response", async (res) => {
    const req = res.request();
    const u = req.url();
    if (!u.match(/tilda\.(cc|ru)/)) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    let body = null;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript") || ct.includes("html")) {
        const buf = await res.body();
        const full = buf.toString("utf8");
        const pd = req.postData() || "";
        if (u.includes("/zero/")) {
          zeroCalls.push({ url: u, status: res.status(), postData: pd, body: full.slice(0, 10_000) });
        }
        body = full.slice(0, 2000);
      }
    } catch {}
    network.push({ phase: "res", url: u, status: res.status(), body });
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { console.log(`  DIALOG: ${d.message().substring(0, 100)}`); await d.accept(); });

  console.log(`[1] open ZB editor`);
  await page.goto(`https://tilda.ru/zero/?recordid=${RECORD_ID}&pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);

  console.log("[2] probe DOM after load: count toolbar items by class+text");
  const items = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[class*="tool" i], [class*="add" i], [class*="elem" i], button, a').forEach(el => {
      const t = (el.innerText || el.textContent || '').trim().slice(0, 30);
      const cls = (el.className || '').toString().slice(0, 100);
      const title = el.getAttribute('title') || '';
      const id = el.id || '';
      if (t || title || id) out.push({ t, cls, title, id });
    });
    return out.slice(0, 80);
  });
  console.log(`  ${items.length} candidates`);
  items.slice(0, 50).forEach((b, i) => {
    if (/add|элем|text|tool|panel|insert/i.test(b.t + " " + b.title + " " + b.cls)) {
      console.log(`    [${i}] "${b.t}" id="${b.id}" title="${b.title}" cls="${b.cls.slice(0, 60)}"`);
    }
  });

  // Try `tn_addElement` family — common Tilda Zero Block add fns
  console.log("\n[3] probe element-creation JS fns");
  const fns = await page.evaluate(() => {
    const out = [];
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /^tn_(add|insert|create|new|save|update)|^tnzb_/i.test(k)) out.push(k);
      } catch {}
    }
    return out.sort();
  });
  console.log(`  ${fns.length} relevant fns:`);
  fns.slice(0, 60).forEach(f => console.log(`    ${f}`));

  // Look at the save function specifically
  const saveFn = await page.evaluate(() => {
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /tn[_-]?save|save[_-]?zero|tn[_-]?update[_-]?all/i.test(k)) {
          return { name: k, src: window[k].toString().slice(0, 600) };
        }
      } catch {}
    }
    return null;
  });
  console.log("\n[4] save fn:");
  console.log(JSON.stringify(saveFn, null, 2));

  // Try to add a text element via JS directly using window.tn_addText / tn_addElement / etc.
  console.log("\n[5] try direct add-text via window.tn_addText / tn_addNewElement");
  for (const fname of ["tn_addText", "tn_addNewElement", "tn_addTextElement", "tn_addElement"]) {
    const r = await page.evaluate((fn) => {
      if (typeof window[fn] !== "function") return { fn, exists: false };
      return { fn, exists: true, src: window[fn].toString().slice(0, 200) };
    }, fname);
    console.log(`  ${JSON.stringify(r).substring(0, 300)}`);
  }

  // Try save by Ctrl+S
  console.log("\n[6] trigger Ctrl+S to force save");
  const preSave = network.length;
  await page.keyboard.press("Control+S");
  await jitter(4000, 6000);

  console.log("[7] post-save network (zero/* only):");
  const newCalls = zeroCalls.slice(zeroCalls.length - 10);
  newCalls.forEach((z, i) => {
    console.log(`  ${z.status} ${z.url}`);
    console.log(`    post: ${z.postData.substring(0, 200)}`);
    console.log(`    body[0..300]: ${z.body.substring(0, 300).replace(/\n/g, " ")}`);
  });

  writeFileSync(join(OUT_DIR, "explore13_zero_calls.txt"), zeroCalls.map(z => `=== ${z.url} (${z.status}) ===\nPOST:\n${z.postData}\n\nBODY:\n${z.body}`).join("\n\n---\n\n"));
  writeFileSync(join(OUT_DIR, "explore13_network.json"), JSON.stringify(network, null, 2));

  console.log("\n[8] keep window open 5s");
  await new Promise(r => setTimeout(r, 5000));
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
