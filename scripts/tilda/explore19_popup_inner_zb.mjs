#!/usr/bin/env node
// Explore 19: open main editor; enumerate ZB inner records (incl. those inside popups).

import { chromium } from "playwright";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".config/tilda-mcp/state.json");
const PROFILE_DIR = join(homedir(), ".cache/tilda-mcp-profile");
const OUT_DIR = join(process.cwd(), "scripts/tilda/explore-out");
const PAGE_ID = process.env.PAGE_ID ?? "142153826";

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

  const page = context.pages()[0] ?? await context.newPage();
  page.on("dialog", async (d) => { await d.accept(); });

  console.log(`[1] open main editor for page ${PAGE_ID}`);
  await page.goto(`https://tilda.ru/page/?pageid=${PAGE_ID}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('text="Настройки"', { timeout: 60_000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));
  if (await page.locator('#alert-dialog.td-popup_opened').count() > 0) {
    await page.keyboard.press("Escape");
    await new Promise(r => setTimeout(r, 800));
  }

  console.log("[2] inventory all records on the page (DOM)");
  const recs = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("[id^='record'], [recordid]").forEach(el => {
      const id = el.getAttribute("id") || `record${el.getAttribute("recordid")}`;
      const recordType = el.getAttribute("data-record-type") || el.getAttribute("data-cod") || "";
      const cls = (el.className || "").toString().slice(0, 80);
      out.push({ id, recordType, cls });
    });
    return out;
  });
  console.log(`  ${recs.length} records:`);
  recs.forEach(r => console.log(`    ${r.id} type=${r.recordType} class=${r.cls.slice(0, 50)}`));

  console.log("\n[3] call t396__getZeroBlocks (which records are ZB)");
  const zbs = await page.evaluate(() => {
    if (typeof window.t396__getZeroBlocks !== "function") return null;
    try {
      const r = window.t396__getZeroBlocks();
      // r is likely a NodeList or array of element refs; serialize key info
      if (Array.isArray(r) || (r && typeof r.length === "number")) {
        return Array.from(r).map(el => ({
          id: el?.id || "",
          recordid: el?.getAttribute?.("data-record-id") || el?.dataset?.recordId || el?.dataset?.recordid || "",
          dataset: el?.dataset ? { ...el.dataset } : {},
          parentRec: el?.closest?.("[id^='record']")?.id || "",
        }));
      }
      return { type: typeof r, value: String(r).slice(0, 200) };
    } catch (e) {
      return { err: String(e) };
    }
  });
  console.log(`  zbs:`, JSON.stringify(zbs, null, 2)?.slice(0, 2000));

  console.log("\n[4] dive into popup record DOM");
  const popup = await page.evaluate(() => {
    const p = document.getElementById("record2278563131");
    if (!p) return { err: "no record2278563131" };
    return {
      outerHtmlStart: p.outerHTML.slice(0, 400),
      // find all child elements with recordid
      childRecords: [...p.querySelectorAll("[data-record-id], [recordid], [id^='record'], [data-tplid='396']")].map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        recordid: el.getAttribute("data-record-id") || el.getAttribute("recordid") || "",
        tplid: el.getAttribute("data-tplid") || "",
        zid: el.getAttribute("data-zb-id") || "",
        cls: (el.className || "").toString().slice(0, 60),
      })).slice(0, 10),
    };
  });
  console.log("  popup record probe:", JSON.stringify(popup, null, 2));

  writeFileSync(join(OUT_DIR, "explore19_records.json"), JSON.stringify({ recs, zbs, popup }, null, 2));
  await context.close();
}

main().catch((e) => { console.error("fail:", e.message); process.exit(1); });
