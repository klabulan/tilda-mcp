#!/usr/bin/env node
// Explore 14: open ZB editor, find animation/transition controls, capture how
// they encode into the saved JSON.

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142152986"; // smoke3 page
const RECORD_ID = process.env.RECORD_ID ?? "2278551161";

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

  const zeroCalls = [];
  context.on("response", async (res) => {
    const u = res.request().url();
    if (!u.includes("/zero/")) return;
    if (u.match(/\.(css|png|svg|jpe?g|gif|woff|woff2|ico|js)\b/)) return;
    try {
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("json") || ct.includes("text") || ct.includes("javascript")) {
        const full = (await res.body()).toString("utf8");
        zeroCalls.push({ url: u, status: res.status(), postData: res.request().postData() || "", body: full.slice(0, 20_000) });
      }
    } catch {}
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { console.log(`  DIALOG: ${d.message().substring(0, 100)}`); await d.accept(); });

  console.log(`[1] open ZB editor for record ${RECORD_ID}`);
  await page.goto(`https://tilda.ru/zero/?recordid=${RECORD_ID}&pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await jitter(3000, 5000);

  console.log("[2] probe Tilda Zero Block animation/effect related functions");
  const fns = await page.evaluate(() => {
    const out = [];
    for (const k of Object.keys(window)) {
      try {
        if (typeof window[k] === "function" && /anim|effect|transition|trigger|hover|scroll|appear|zoom|rotate|fadein|slide|reveal|tn_set|tn_apply|tn_animation/i.test(k)) {
          out.push(k);
        }
      } catch {}
    }
    return out.sort();
  });
  console.log(`  ${fns.length} animation/effect fns:`);
  fns.slice(0, 50).forEach(f => console.log(`    ${f}`));

  console.log("\n[3] examine getzerocode response for elements with animation fields");
  // wait a bit more for getzerocode response
  await jitter(2000, 3000);
  const getzero = zeroCalls.find(z => z.postData.includes("getzerocode"));
  if (getzero) {
    console.log(`  body len: ${getzero.body.length}`);
    // Try to find any animation-related fields in the current data
    const m = getzero.body.match(/"(anim[^"]*|effect[^"]*|trigger[^"]*|appear[^"]*|hover[^"]*|scroll[^"]*|transition[^"]*|animation[^"]*)":\s*[^,}]+/g);
    if (m) {
      console.log("  animation-related fields found in current ZB data:");
      m.slice(0, 20).forEach(s => console.log(`    ${s.substring(0, 120)}`));
    } else {
      console.log("  no animation fields in current ZB data (placeholder content has no animations) — expected");
    }
  }

  console.log("\n[4] probe animation panel triggers in DOM (zb effect buttons typically under per-element settings)");
  const eff = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[class*="effect"], [class*="anim"], [class*="trigger"], [data-effect], [data-animation]').forEach(el => {
      const t = (el.innerText || el.textContent || '').trim().slice(0, 60);
      const cls = (el.className || '').toString().slice(0, 100);
      const dt = el.getAttribute('data-effect') || el.getAttribute('data-animation') || '';
      if (t || cls || dt) out.push({ t, cls, dt });
    });
    return out.slice(0, 30);
  });
  console.log(`  effect-panel candidates: ${eff.length}`);
  eff.slice(0, 20).forEach(e => console.log(`    "${e.t}" data="${e.dt}" cls="${e.cls.slice(0, 60)}"`));

  // Dump everything
  writeFileSync(join(OUT_DIR, "explore14_zero_calls.txt"), zeroCalls.map(z => `=== ${z.url} (${z.status}) ===\nPOST:\n${z.postData}\n\nBODY:\n${z.body}`).join("\n\n---\n\n"));

  console.log("\n[5] keep window open 8s");
  await new Promise(r => setTimeout(r, 8000));
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
