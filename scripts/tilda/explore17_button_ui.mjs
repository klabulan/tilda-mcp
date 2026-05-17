#!/usr/bin/env node
// Explore 17: open ZB editor, programmatically invoke tn_addElement (or similar) to add a button,
// trigger save, capture how Tilda encodes a real button in the JSON.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142153516";    // smoke6 page
const RECORD_ID = process.env.RECORD_ID ?? "2278559111";

async function jitter(min, max) { await new Promise((r) => setTimeout(r, min + Math.random() * (max - min))); }

async function main() {
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

  const zeroCalls = [];
  context.on("response", async (res) => {
    const u = res.request().url();
    if (!u.includes("/zero/")) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    try {
      const full = (await res.body()).toString("utf8");
      zeroCalls.push({ url: u, status: res.status(), postData: res.request().postData() || "", body: full.slice(0, 30_000) });
    } catch {}
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log("[1] open ZB editor");
  await page.goto(`https://tilda.ru/zero/?recordid=${RECORD_ID}&pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(4000, 6000);

  console.log("[2] probe element-creation fns (addElem__*)");
  const fns = await page.evaluate(() => {
    const out = [];
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /^(addElem__|elem__create|tn_addNew|tn_create|tn_button|addText|addButton|addShape|addImage|addInput|addInputField)/i.test(k)) {
          out.push({ name: k, src: window[k].toString().slice(0, 200) });
        }
      } catch {}
    }
    return out;
  });
  console.log(`  ${fns.length} candidates:`);
  fns.slice(0, 30).forEach(f => console.log(`    ${f.name}: ${f.src.slice(0, 100)}`));

  // Look at addElem__createDefault* functions
  const defaults = await page.evaluate(() => {
    const out = {};
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /addElem__createDefault[^_]/i.test(k)) {
          out[k] = window[k].toString().slice(0, 1500);
        }
      } catch {}
    }
    return out;
  });
  console.log("\n[3] addElem__createDefault* sources (these reveal element schemas):");
  for (const [n, src] of Object.entries(defaults).slice(0, 8)) {
    console.log(`\n  --- ${n} ---`);
    console.log(`  ${src}`);
  }

  // Try calling addElem__createDefaultButton if exists
  console.log("\n[4] try addElem__createDefaultButton()");
  const buttonDefault = await page.evaluate(() => {
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /^addElem__createDefault[A-Z][a-z]*$/.test(k) && /button|btn/i.test(k)) {
          try { return { fn: k, result: window[k]() }; } catch (e) { return { fn: k, err: String(e).slice(0, 200) }; }
        }
      } catch {}
    }
    return null;
  });
  console.log(`  ${JSON.stringify(buttonDefault, null, 2)}`);

  writeFileSync(join(OUT_DIR, "explore17_button_zero_calls.txt"), zeroCalls.map(z => `=== ${z.url} (${z.status}) ===\nPOST:\n${z.postData.slice(0, 500)}\n\nBODY:\n${z.body}`).join("\n\n---\n\n"));
  console.log("\n[5] keep window open 5s");
  await new Promise(r => setTimeout(r, 5000));
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
