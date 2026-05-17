import { z } from "zod";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { chromium, type Page } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { log } from "../../logging.js";
import { loadConfig } from "../../config.js";

// Tilda's upload API rejects raw POSTs (server-issued uploadkey + per-session CSRF).
// The reliable path is to drive the editor UI in headless Playwright: open a Zero Block,
// add a transient image element, setInputFiles() on the resulting file input, and capture
// the cdnUrl from the network response. Slow (~10-15s/upload) but uses Tilda's own auth.

export const uploadImageSchema = z.object({
  file_path: z.string().describe("Absolute or working-dir-relative path. Accepts images (.png/.jpg/.gif/.svg/.webp), CSS (.css), JS (.js), fonts (.woff/.woff2/.ttf/.otf), PDF, JSON. CSS upload returns a CDN URL usable as `customcssfile` in set_site_settings."),
  name: z.string().nullable().optional().describe("Override uploaded filename (default: basename of file_path)"),
  scratch_recordid: z.string().describe(
    "Existing ZB record id (T396) to use as the upload scratch context. "
    + "The upload happens through that ZB editor (we don't actually save the element). "
    + "If you don't have one, create_page + add_block T396 first."
  ),
  scratch_pageid: z.string().describe("Page id that owns scratch_recordid"),
});

interface TildaUploadEntry {
  originalUrl: string;
  paramName: string;
  name: string;
  size: number;
  type: string;
  uuid: string;
  isImage: number;
  width: number;
  height: number;
  cdnUrl: string;
  ext: string;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".css": "text/css", ".js": "application/javascript", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".pdf": "application/pdf",
};

export async function handleUploadImage(params: z.infer<typeof uploadImageSchema>): Promise<string> {
  const filePath = params.file_path;
  const finfo = await stat(filePath).catch(() => null);
  if (!finfo || !finfo.isFile()) throw new Error(`file not found or not a file: ${filePath}`);
  const ext = extname(filePath).toLowerCase();
  if (!MIME_BY_EXT[ext]) throw new Error(`unsupported file extension '${ext}' (supported: ${Object.keys(MIME_BY_EXT).join(", ")})`);
  const filename = params.name ?? basename(filePath);

  const cfg = loadConfig();
  if (!existsSync(cfg.stateFilePath)) {
    throw new Error(`upload_image needs ${cfg.stateFilePath} (run login_headed_bootstrap first)`);
  }
  const state = JSON.parse(readFileSync(cfg.stateFilePath, "utf8"));

  log("info", "upload_image", `Uploading ${filename} via Playwright scratch ZB ${params.scratch_recordid} on page ${params.scratch_pageid}`);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      locale: "en-US", timezoneId: "Europe/Berlin",
    });
    await context.addCookies(state.cookies.map((c: { name: string; value: string; domain: string; path: string; expires: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires,
      httpOnly: !!c.httpOnly, secure: !!c.secure,
      sameSite: c.sameSite === "Lax" ? "Lax" as const : c.sameSite === "None" ? "None" as const : c.sameSite === "Strict" ? "Strict" as const : "Lax" as const,
    })));

    const uploadResults: TildaUploadEntry[] = [];
    context.on("response", async (res) => {
      const u = res.request().url();
      if (!u.includes("upload.tildacdn.com/api/upload")) return;
      try {
        const text = (await res.body()).toString("utf8");
        const data = JSON.parse(text);
        if (data?.result?.[0]?.cdnUrl) uploadResults.push(data.result[0]);
      } catch {}
    });

    const page: Page = await context.newPage();
    page.on("dialog", (d) => d.accept());

    await page.goto(
      `https://tilda.ru/zero/?recordid=${params.scratch_recordid}&pageid=${params.scratch_pageid}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await new Promise(r => setTimeout(r, 2500));

    // File inputs always present in Tilda ZB editor (one per image-upload widget).
    const inputs = await page.locator('input[type="file"][accept*="image"]').all();
    if (inputs.length === 0) {
      throw new Error(`no image file-input found in ZB editor (page ${params.scratch_pageid}, record ${params.scratch_recordid}) — confirm scratch_recordid is a Zero Block (T396)`);
    }

    // Use first image upload widget.
    await inputs[0].setInputFiles(filePath, { timeout: 5000 });

    // Wait for response (Tilda usually responds in <5s for small images).
    const deadline = Date.now() + 30_000;
    while (uploadResults.length === 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
    }
    if (uploadResults.length === 0) throw new Error("upload timed out (30s) — no /api/upload/ response captured");

    // Pick the result whose filename matches ours (if multiple uploads happened).
    const result = uploadResults.find(r => r.name === filename) ?? uploadResults[uploadResults.length - 1];
    log("info", "upload_image", `Uploaded ${result.name} (${result.size}b ${result.width}x${result.height}) → ${result.cdnUrl}`);

    return JSON.stringify({
      cdn_url: result.cdnUrl,
      uuid: result.uuid,
      width: result.width,
      height: result.height,
      size: result.size,
      mime: result.type,
      ext: result.ext,
      name: result.name,
      usage_hint: "Pass cdn_url as the `img` field of a ZB image element (elem_type:image), and width/height as `filewidth`/`fileheight`.",
    }, null, 2);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
