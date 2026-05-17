import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { loadConfig } from "../../config.js";
import { log } from "../../logging.js";
import {
  SessionExpiredError,
  TransportNotImplementedError,
  type AddBlockResult,
  type CreatePageResult,
  type DeletePageResult,
  type ImportZeroblockResult,
  type PublishResult,
  type SetPageSettingsResult,
  type TransportHealth,
  type WriteTransport,
} from "../writeTransport.js";
import { applyAntibotInitScript, launchArgs, realisticContextOptions } from "./antibot.js";
import { stateAgeDays, stateIsStale } from "./auth.js";

const TILDA_HOST = "tilda.ru";
const BASE_URL = `https://${TILDA_HOST}`;

// PlaywrightTransport drives Tilda editor XHRs via Playwright's APIRequestContext.
// This is *not* UI scripting — it's HTTP, but the cookie jar, TLS stack, and the User-Agent
// all come from a real Chromium browser. Tilda's anti-bot can't distinguish these calls from
// the ones its own frontend makes when the editor is open in a tab.
//
// Slower than raw fetch (~2-4s/op vs ~200ms) because each request goes through Chromium.
// But anti-bot resistant.
export class PlaywrightTransport implements WriteTransport {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private stateFilePath: string;
  private warmedUp = false;

  constructor(stateFilePath?: string) {
    this.stateFilePath = stateFilePath ?? loadConfig().stateFilePath;
  }

  async init(): Promise<void> {
    if (!existsSync(this.stateFilePath)) {
      throw new SessionExpiredError(
        `No storage state at ${this.stateFilePath}. Call login_headed_bootstrap first.`
      );
    }
    if (stateIsStale(this.stateFilePath)) {
      log("warn", "playwright.init", `Storage state is stale (>14 days). Re-bootstrap recommended.`);
    }
    this.browser = await chromium.launch({ headless: true, args: launchArgs });
    this.context = await this.browser.newContext({
      ...realisticContextOptions(),
      storageState: this.stateFilePath,
    });
    await applyAntibotInitScript(this.context);
    log("info", "playwright.init", `Playwright HTTP transport ready`);
  }

  /** Warm-up: open tilda.ru/projects/ in a page so .tildacdn.com cookies populate +
   * Tilda refreshes the CSRF/session sliding window. Same behaviour as the user
   * hitting F5 in their own browser when "Request timeout" pops up.
   * If after warmup we're still redirected to /login/, the storageState is fully
   * dead and the caller must run login_headed_bootstrap. */
  private async warmup(force = false): Promise<void> {
    if (this.warmedUp && !force) return;
    if (!this.context) return;
    const page = await this.context.newPage();
    try {
      await page.goto(`${BASE_URL}/projects/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await new Promise(r => setTimeout(r, 800));
      const url = page.url();
      const titlePromise = page.title().catch(() => "");
      const title = await titlePromise;
      if (url.includes("/login") || /sign\s*in/i.test(title)) {
        // Hard dead state — bubble up a typed error
        this.warmedUp = false;
        throw new SessionExpiredError(
          `storageState is fully expired (warmup landed at ${url}). Run login_headed_bootstrap to refresh cookies.`,
        );
      }
      log("debug", "pw.warmup", `warmup ok (force=${force}, url=${url.slice(0, 80)})`);
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e;
      log("warn", "pw.warmup", `warmup fail: ${(e as Error).message.slice(0, 100)}`);
    } finally {
      await page.close().catch(() => undefined);
      this.warmedUp = true;
    }
  }

  /** Wrap an HTTP attempt with auto-retry on session-expired or transient-Tilda-error.
   * Tilda's session sliding window invalidates ~every 5-10 min or 5-8 reqs; the user's
   * native Chrome sees the same "Request timeout" dialog (informally confirmed). One
   * warmup-and-retry mirrors what a human does (F5 + click again).
   */
  private async withRetry<T>(label: string, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (e) {
      const msg = (e as Error).message || "";
      const isSession = e instanceof SessionExpiredError || /not authorized|<!DOCTYPE|<div /i.test(msg);
      const isTimeout = /timeout|ECONN|socket hang up|ETIMEDOUT|Request timeout/i.test(msg);
      if (!isSession && !isTimeout) throw e;
      log("warn", `pw.${label}.retry`, `transient error → warmup + retry once: ${msg.slice(0, 120)}`);
      await this.warmup(true);
      // Small backoff to let Tilda settle
      await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 800)));
      return await attempt();
    }
  }

  private async pace(): Promise<void> {
    // Light jitter between API calls, in addition to the cost of the request itself.
    const ms = 300 + Math.floor(Math.random() * 500);
    await new Promise(r => setTimeout(r, ms));
  }

  private refererFor(path: string, body: Record<string, string>): string {
    if (path.startsWith("/zero/") && body.pageid) {
      const rid = body.recordid ?? "";
      return `${BASE_URL}/zero/?recordid=${encodeURIComponent(rid)}&pageid=${encodeURIComponent(body.pageid)}`;
    }
    if (path.startsWith("/page/") && body.pageid) {
      return `${BASE_URL}/page/?pageid=${encodeURIComponent(body.pageid)}`;
    }
    if (path.startsWith("/projects/") && body.projectid) {
      return `${BASE_URL}/projects/?projectid=${encodeURIComponent(body.projectid)}`;
    }
    return `${BASE_URL}/projects/`;
  }

  /** Form-urlencoded POST via Playwright's APIRequestContext. With auto-retry on
   * Tilda session-flake (mirrors the user-hits-F5 behaviour). */
  private async post(path: string, body: Record<string, string>): Promise<string> {
    return this.withRetry(`POST ${path}`, async () => {
      if (!this.context) throw new Error("PlaywrightTransport not initialised");
      await this.warmup();
      await this.pace();
      const form: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) form[k] = v == null ? "" : String(v);
      const res = await this.context.request.post(`${BASE_URL}${path}`, {
        form,
        headers: {
          "Origin": BASE_URL,
          "Referer": this.refererFor(path, form),
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/plain, */*",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        },
        timeout: 30_000,
      });
      const text = (await res.text()).replace(/^<!--tlp-->\s*/, "");
      if (!res.ok()) throw new Error(`Tilda HTTP ${res.status()} on ${path}: ${text.slice(0, 200)}`);
      if (text.includes("you are not authorized") || text.startsWith("<div ") || text.startsWith("<!DOCTYPE")) {
        throw new SessionExpiredError(`Tilda returned auth-error page on ${path} — re-login.`);
      }
      return text;
    });
  }

  /** multipart/form-data POST (for /zero/get/ and /zero/submit/). */
  private async postMultipart(path: string, fields: Record<string, string>): Promise<string> {
    return this.withRetry(`POST-multi ${path}`, async () => {
      if (!this.context) throw new Error("PlaywrightTransport not initialised");
      await this.warmup();
      await this.pace();
      const multipart: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) multipart[k] = v == null ? "" : String(v);
      const res = await this.context.request.post(`${BASE_URL}${path}`, {
        multipart,
        headers: {
          "Origin": BASE_URL,
          "Referer": this.refererFor(path, fields),
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/plain, */*",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        },
        timeout: 30_000,
      });
      const text = (await res.text()).replace(/^<!--tlp-->\s*/, "");
      if (!res.ok()) throw new Error(`Tilda HTTP ${res.status()} on ${path}: ${text.slice(0, 200)}`);
      if (text.includes("you are not authorized") || text.startsWith("<div ") || text.startsWith("<!DOCTYPE")) {
        throw new SessionExpiredError(`Tilda returned auth-error page on ${path} — re-login.`);
      }
      return text;
    });
  }

  // ---- WriteTransport interface ----

  async createPage(projectid: string, title: string, alias: string | null): Promise<CreatePageResult> {
    const text = await this.post("/projects/submit/", {
      comm: "addnewpagedublicateexample",
      projectid, examplepageid: "1231", folderid: "", csrf: "",
    });
    const pageId = text.trim();
    if (!/^\d+$/.test(pageId)) throw new Error(`create_page returned non-numeric: ${text.slice(0, 80)}`);
    log("info", "pw.create_page", `pageid=${pageId} project=${projectid}`);
    void title; void alias;
    return { page_id: pageId, alias: alias ?? "", preview_url: `${BASE_URL}/page/?pageid=${pageId}`, published_url: null };
  }

  async setPageSettings(pageid: string, title: string | null, descr: string | null, alias: string | null): Promise<SetPageSettingsResult> {
    await this.post("/projects/submit/", {
      comm: "savepagesettings", pageid, test: "test4.0",
      title: title ?? "", descr: descr ?? "", alias: alias ?? "",
      imgfile: "", "img-tuinfo-uuid": "", "img-tuinfo-cdnurl": "", "img-tuinfo-name": "",
      "img-tuinfo-width": "", "img-tuinfo-size": "",
      fb_title: "", fb_descr: "", fb_imgfile: "",
      "fb_img-tuinfo-uuid": "", "fb_img-tuinfo-cdnurl": "", "fb_img-tuinfo-name": "",
      "fb_img-tuinfo-width": "", "fb_img-tuinfo-size": "",
      fb_img: "", fb_url: "", fb_appid: "", twitter_site: "", csrf: "",
    });
    log("info", "pw.set_page_settings", `pageid=${pageid}`);
    return { success: true, republish_required: alias !== null };
  }

  async setSiteSettings(projectid: string, patch: Record<string, string>): Promise<{ success: boolean }> {
    const body: Record<string, string> = { comm: "saveprojectsettings", projectid, csrf: "" };
    for (const [k, v] of Object.entries(patch)) {
      if (k === "comm" || k === "projectid" || k === "csrf") continue;
      body[k] = v == null ? "" : String(v);
    }
    const text = await this.post("/projects/submit/", body);
    if (!text.trim().toUpperCase().startsWith("OK")) throw new Error(`set_site_settings: ${text.slice(0, 200)}`);
    log("info", "pw.set_site_settings", `project=${projectid} (${Object.keys(patch).length} fields)`);
    return { success: true };
  }

  async deletePage(pageid: string): Promise<DeletePageResult> {
    const text = await this.post("/projects/submit/", { comm: "delpage", pageid, csrf: "" });
    const ok = text.trim().toUpperCase().startsWith("OK") || text.trim() === "" || text.trim() === "1";
    if (!ok) throw new Error(`delete_page: ${text.slice(0, 200)}`);
    log("info", "pw.delete_page", `pageid=${pageid}`);
    return { success: true };
  }

  async addBlock(pageid: string, block_type: string, position: number | null): Promise<AddBlockResult> {
    const tplid = block_type.replace(/^T/i, "");
    if (!/^\d+$/.test(tplid)) throw new Error(`invalid block_type "${block_type}"`);
    const text = await this.post("/page/submit/", {
      comm: "addnewrecord", pageid, tplid, with_code: "yes",
    });
    let parsed: { html?: string };
    try { parsed = JSON.parse(text); } catch { throw new Error(`add_block non-JSON: ${text.slice(0, 200)}`); }
    const m = parsed.html?.match(/id="record(\d+)"/);
    if (!m) throw new Error("add_block: no recordid in html");
    void position;
    log("info", "pw.add_block", `block_id=${m[1]} tplid=${tplid} page=${pageid}`);
    return { block_id: m[1] };
  }

  async importZeroBlock(pageid: string, json: unknown, _position: number | null): Promise<ImportZeroblockResult> {
    const payload = (json && typeof json === "object" && "code" in (json as Record<string, unknown>))
      ? (json as { recordid?: string; code: unknown })
      : { recordid: undefined as string | undefined, code: json };
    if (!payload.recordid) throw new Error("import_zeroblock requires recordid");
    const codeStr = typeof payload.code === "string" ? payload.code : JSON.stringify(payload.code);
    const text = await this.postMultipart("/zero/submit/", {
      comm: "savezerocode", pageid, recordid: payload.recordid,
      onlythisfield: "code", fromzero: "yes", code: codeStr, zb_grid: "reset",
    });
    if (!text.trim().toUpperCase().startsWith("OK")) throw new Error(`import_zeroblock: ${text.slice(0, 200)}`);
    log("info", "pw.import_zeroblock", `record=${payload.recordid} page=${pageid} ${codeStr.length}b`);
    return { block_id: payload.recordid, success: true, log: [`POST /zero/submit/ ${codeStr.length}b → OK`] };
  }

  async getZeroBlock(pageid: string, recordid: string): Promise<unknown> {
    const text = await this.postMultipart("/zero/get/", { comm: "getzerocode", pageid, recordid });
    try { return JSON.parse(text); } catch { throw new Error(`getZeroBlock non-JSON: ${text.slice(0, 200)}`); }
  }

  async editBlock(blockid: string, patch: unknown): Promise<void> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("edit_block patch must be plain object");
    const p = patch as Record<string, unknown>;
    if (!p.pageid) throw new Error("edit_block patch needs pageid");
    const body: Record<string, string> = {
      comm: "saverecord", pageid: String(p.pageid), recordid: blockid,
    };
    for (const [k, v] of Object.entries(p)) {
      if (k === "pageid" || k === "comm" || k === "recordid") continue;
      body[k] = v == null ? "" : String(v);
    }
    const text = await this.post("/page/submit/", body);
    if (!text.trim().toUpperCase().startsWith("OK")) throw new Error(`edit_block: ${text.slice(0, 200)}`);
    log("info", "pw.edit_block", `record=${blockid} page=${p.pageid}`);
  }

  async publish(pageid: string): Promise<PublishResult> {
    const text = await this.post("/page/publish/", {
      comm: "pagepublish", pageid, csrf: "", returnjson: "yes",
    });
    let parsed: { link?: string; pageid?: string };
    try { parsed = JSON.parse(text); } catch { throw new Error(`publish non-JSON: ${text.slice(0, 200)}`); }
    const rawLink = (parsed.link ?? "").replace(/\/$/, "");
    const publishedUrl = /\.html?(?:$|\?)/i.test(rawLink)
      ? rawLink
      : `${rawLink}/page${parsed.pageid}.html`;
    log("info", "pw.publish", `published page ${pageid} → ${publishedUrl}`);
    return { published_url: publishedUrl, published_at: new Date().toISOString() };
  }

  async healthCheck(): Promise<TransportHealth> {
    const age = stateAgeDays(this.stateFilePath);
    const writeStatus = age < 0 ? "playwright_session_expired" : stateIsStale(this.stateFilePath) ? "playwright_session_expired" : "playwright_ready";
    return { read_api: "ok", write_transport: writeStatus, storage_state_age_days: age, active_transport: "playwright" };
  }

  async dispose(): Promise<void> {
    if (this.context) await this.context.close().catch(() => undefined);
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.warmedUp = false;
  }

  // (keep import alive for future use)
  private _unused = TransportNotImplementedError;
}
