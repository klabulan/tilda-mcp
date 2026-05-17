import { loadConfig } from "../../config.js";
import { log } from "../../logging.js";
import {
  TransportNotImplementedError,
  SessionExpiredError,
  type AddBlockResult,
  type CreatePageResult,
  type DeletePageResult,
  type ImportZeroblockResult,
  type PublishResult,
  type SetPageSettingsResult,
  type TransportHealth,
  type WriteTransport,
} from "../writeTransport.js";
import { cookieHeaderForHost } from "./cookies.js";
import { stateAgeDays, stateIsStale } from "../playwright/auth.js";

const TILDA_HOST = "tilda.ru"; // captured 2026-05-17: cookies persist on .ru after login
const BASE_URL = `https://${TILDA_HOST}`;
const REALISTIC_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

// Browser-realistic headers Chrome 148 sends on XHR/fetch. Tilda's anti-bot stack
// invalidates sessions that lack these (Sec-Fetch-* + Sec-Ch-Ua are sentinel checks).
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": REALISTIC_UA,
  "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
  "Accept-Encoding": "gzip, deflate",
  "Sec-Ch-Ua": '"Chromium";v="148", "Not.A/Brand";v="24", "Google Chrome";v="148"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Linux"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

// Human-pace jitter — last call timestamp per process, enforces min interval between POSTs.
let _lastCallTs = 0;
const MIN_INTERVAL_MS = 850;
async function paceCall(): Promise<void> {
  const now = Date.now();
  const since = now - _lastCallTs;
  if (since < MIN_INTERVAL_MS) {
    const wait = MIN_INTERVAL_MS - since + Math.floor(Math.random() * 600);
    await new Promise((r) => setTimeout(r, wait));
  } else {
    // small jitter even when interval natural-passed
    await new Promise((r) => setTimeout(r, 120 + Math.floor(Math.random() * 380)));
  }
  _lastCallTs = Date.now();
}

/** Build a per-request Referer that matches what a human browser would send when
 * sitting on the relevant editor page. Anti-bot checks Referer ≈ Origin context.
 */
function refererForPath(path: string, body?: URLSearchParams | Record<string, string>): string {
  const get = (k: string) => {
    if (!body) return undefined;
    if (body instanceof URLSearchParams) return body.get(k) ?? undefined;
    return (body as Record<string, string>)[k];
  };
  const pageid = get("pageid");
  const projectid = get("projectid");
  if (path.startsWith("/zero/") && pageid) {
    const recordid = get("recordid");
    return `${BASE_URL}/zero/?recordid=${encodeURIComponent(recordid ?? "")}&pageid=${encodeURIComponent(pageid)}`;
  }
  if (path.startsWith("/page/") && pageid) {
    return `${BASE_URL}/page/?pageid=${encodeURIComponent(pageid)}`;
  }
  if (path.startsWith("/projects/") && projectid) {
    return `${BASE_URL}/projects/?projectid=${encodeURIComponent(projectid)}`;
  }
  return `${BASE_URL}/projects/`;
}

interface PublishResponse {
  projectid: string;
  pageid: string;
  publishonepage?: string;
  link: string;
  linkstr?: string;
}

interface AddBlockResponse {
  html: string;
}

/**
 * XHR-RE transport — drives the same endpoints Tilda's editor frontend uses.
 *
 * Signatures live in src/transport/xhr/signatures/*.template.json (captured 2026-05-17
 * against tilda.ru via Playwright network observation).
 *
 * Auth: reads cookies from the same storageState file Playwright uses (default
 * ~/.config/tilda-mcp/state.json). Public + secret API keys are NOT used here —
 * those are for the read-only Export API in src/client.ts, a separate auth model.
 */
export class XhrTransport implements WriteTransport {
  private cookieHeader: string | null = null;
  private stateFilePath: string;

  constructor(stateFilePath?: string) {
    this.stateFilePath = stateFilePath ?? loadConfig().stateFilePath;
  }

  async init(): Promise<void> {
    if (stateIsStale(this.stateFilePath)) {
      throw new SessionExpiredError(
        `storageState stale or missing at ${this.stateFilePath} — call login_headed_bootstrap.`
      );
    }
    this.cookieHeader = cookieHeaderForHost(this.stateFilePath, TILDA_HOST);
    log("info", "xhr.init", `XHR transport ready (cookies for ${TILDA_HOST} loaded)`);
  }

  private async post(path: string, body: URLSearchParams): Promise<{ status: number; text: string }> {
    if (!this.cookieHeader) throw new Error("XhrTransport not initialised — call init() first");
    await paceCall();
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json, text/plain, */*",
        "Cookie": this.cookieHeader,
        "Origin": BASE_URL,
        "Referer": refererForPath(path, body),
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    });
    const rawText = await res.text();
    const text = rawText.replace(/^<!--tlp-->\s*/, "");
    if (!res.ok) {
      throw new Error(`Tilda XHR ${res.status} ${res.statusText} on ${path}: ${text.slice(0, 200)}`);
    }
    // Sentinel-detect Tilda's "not authorized" HTML response (200 OK but content == error page)
    if (text.includes("you are not authorized") || text.startsWith("<div ")) {
      throw new SessionExpiredError(`Tilda returned auth-error page on ${path} — session invalidated. Run login_headed_bootstrap.`);
    }
    return { status: res.status, text };
  }

  /** multipart/form-data POST — required by the ZB editor endpoints (/zero/get/, /zero/submit/). */
  private async postMultipart(path: string, fields: Record<string, string>): Promise<{ status: number; text: string }> {
    if (!this.cookieHeader) throw new Error("XhrTransport not initialised — call init() first");
    await paceCall();
    // Use WebKit-style boundary string so it looks like a real Chrome form upload.
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2, 18)}`;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
    }
    parts.push(`--${boundary}--\r\n`);
    const body = parts.join("");
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Accept": "application/json, text/plain, */*",
        "Cookie": this.cookieHeader,
        "Origin": BASE_URL,
        "Referer": refererForPath(path, fields),
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
    });
    const rawText = await res.text();
    const text = rawText.replace(/^<!--tlp-->\s*/, "");
    if (!res.ok) throw new Error(`Tilda XHR ${res.status} ${res.statusText} on ${path}: ${text.slice(0, 200)}`);
    if (text.includes("you are not authorized") || text.startsWith("<div ")) {
      throw new SessionExpiredError(`Tilda returned auth-error page on ${path} — session invalidated.`);
    }
    return { status: res.status, text };
  }

  async createPage(projectid: string, title: string, alias: string | null): Promise<CreatePageResult> {
    // Tilda's create-page = duplicate a template. Template 1231 = Blank.
    const body = new URLSearchParams({
      comm: "addnewpagedublicateexample",
      projectid,
      examplepageid: "1231",
      folderid: "",
      csrf: "",
    });
    const { text } = await this.post("/projects/submit/", body);
    const pageId = text.trim();
    if (!/^\d+$/.test(pageId)) {
      throw new Error(`create_page returned non-numeric pageid: "${text.slice(0, 80)}"`);
    }
    log("info", "xhr.create_page", `pageid=${pageId} in project ${projectid}`);

    // TODO(v0.1): set title + alias via setpagesettings endpoint (TBD capture).
    // For v0, the page is created with default title "Blank page" and empty alias.
    void title;
    void alias;

    return {
      page_id: pageId,
      alias: alias ?? "",
      preview_url: `${BASE_URL}/page/?pageid=${pageId}`,
      published_url: null,
    };
  }

  async setPageSettings(pageid: string, title: string | null, descr: string | null, alias: string | null): Promise<SetPageSettingsResult> {
    const body = new URLSearchParams({
      comm: "savepagesettings",
      pageid,
      test: "test4.0",   // observed in captured signature; safe constant
      title: title ?? "",
      descr: descr ?? "",
      alias: alias ?? "",
      imgfile: "",
      "img-tuinfo-uuid": "",
      "img-tuinfo-cdnurl": "",
      "img-tuinfo-name": "",
      "img-tuinfo-width": "",
      "img-tuinfo-size": "",
      fb_title: "",
      fb_descr: "",
      fb_imgfile: "",
      "fb_img-tuinfo-uuid": "",
      "fb_img-tuinfo-cdnurl": "",
      "fb_img-tuinfo-name": "",
      "fb_img-tuinfo-width": "",
      "fb_img-tuinfo-size": "",
      fb_img: "",
      fb_url: "",
      fb_appid: "",
      twitter_site: "",
      csrf: "",
    });
    await this.post("/projects/submit/", body);
    log("info", "xhr.set_page_settings", `pageid=${pageid} title=${title ?? "<unchanged>"} alias=${alias ?? "<unchanged>"}`);
    // Alias change requires republish for the filename on CDN to flip.
    return { success: true, republish_required: alias !== null };
  }

  async setSiteSettings(projectid: string, patch: Record<string, string>): Promise<{ success: boolean }> {
    const body = new URLSearchParams();
    body.set("comm", "saveprojectsettings");
    body.set("projectid", projectid);
    body.set("csrf", "");
    for (const [k, v] of Object.entries(patch)) {
      if (k === "comm" || k === "projectid" || k === "csrf") continue;
      body.set(k, v == null ? "" : String(v));
    }
    const { text } = await this.post("/projects/submit/", body);
    if (!text.trim().toUpperCase().startsWith("OK")) {
      throw new Error(`set_site_settings unexpected response: "${text.slice(0, 200)}"`);
    }
    log("info", "xhr.set_site_settings", `Updated site ${projectid} (${Object.keys(patch).length} field(s))`);
    return { success: true };
  }

  async deletePage(pageid: string): Promise<DeletePageResult> {
    const body = new URLSearchParams({
      comm: "delpage",
      pageid,
      csrf: "",
    });
    const { text } = await this.post("/projects/submit/", body);
    const ok = text.trim().toUpperCase().startsWith("OK") || text.trim() === "" || text.trim() === "1";
    if (!ok) {
      throw new Error(`delete_page returned unexpected response: "${text.slice(0, 200)}"`);
    }
    log("info", "xhr.delete_page", `pageid=${pageid} deleted`);
    return { success: true };
  }

  async addBlock(pageid: string, block_type: string, position: number | null): Promise<AddBlockResult> {
    // block_type expected as "T396" or "396" — strip leading T.
    const tplid = block_type.replace(/^T/i, "");
    if (!/^\d+$/.test(tplid)) {
      throw new Error(`add_block invalid block_type "${block_type}" — expected T<number> or <number>`);
    }
    const body = new URLSearchParams({
      comm: "addnewrecord",
      pageid,
      tplid,
      with_code: "yes",
    });
    // NOTE: position param TBD (capture not yet performed). v0 appends to end.
    void position;
    const { text } = await this.post("/page/submit/", body);
    let parsed: AddBlockResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`add_block returned non-JSON: ${text.slice(0, 200)}`);
    }
    const m = parsed.html?.match(/id="record(\d+)"/);
    if (!m) {
      throw new Error(`add_block response missing recordid in html`);
    }
    log("info", "xhr.add_block", `block_id=${m[1]} (tplid=${tplid}) on page ${pageid}`);
    return { block_id: m[1] };
  }

  async importZeroBlock(pageid: string, json: unknown, _position: number | null): Promise<ImportZeroblockResult> {
    // Required ZB-save fields:
    //   comm=savezerocode, pageid, recordid, onlythisfield=code, fromzero=yes,
    //   code=<stringified JSON>, zb_grid=reset
    // The caller is expected to pass `recordid` either as `json.recordid` or wrap as { recordid, code }.
    const payload = (json && typeof json === "object" && "code" in (json as Record<string, unknown>))
      ? (json as { recordid?: string; code: unknown })
      : { recordid: undefined as string | undefined, code: json };

    if (!payload.recordid) {
      throw new Error("import_zeroblock requires `recordid` (either as json.recordid or fetch via getZeroBlock first)");
    }
    const codeStr = typeof payload.code === "string" ? payload.code : JSON.stringify(payload.code);

    const { text } = await this.postMultipart("/zero/submit/", {
      comm: "savezerocode",
      pageid,
      recordid: payload.recordid,
      onlythisfield: "code",
      fromzero: "yes",
      code: codeStr,
      zb_grid: "reset",
    });
    const ok = text.trim().toUpperCase().startsWith("OK");
    if (!ok) throw new Error(`import_zeroblock unexpected response: "${text.slice(0, 200)}"`);
    log("info", "xhr.import_zeroblock", `Saved ZB content for record ${payload.recordid} on page ${pageid} (${codeStr.length} bytes)`);
    return { block_id: payload.recordid, success: true, log: [`POST /zero/submit/ savezerocode ${codeStr.length}b → OK`] };
  }

  /** Read current Zero Block content. Returned JSON conforms to import_zeroblock's `code` schema. */
  async getZeroBlock(pageid: string, recordid: string): Promise<unknown> {
    const { text } = await this.postMultipart("/zero/get/", {
      comm: "getzerocode",
      pageid,
      recordid,
    });
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`getZeroBlock non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  async editBlock(blockid: string, patch: unknown): Promise<void> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("edit_block patch must be a plain object {pageid, field1, field2, ...}");
    }
    const p = patch as Record<string, unknown>;
    if (!p.pageid) {
      throw new Error("edit_block patch must include pageid (the page that contains the block)");
    }
    const body = new URLSearchParams();
    body.set("comm", "saverecord");
    body.set("pageid", String(p.pageid));
    body.set("recordid", blockid);
    for (const [k, v] of Object.entries(p)) {
      if (k === "pageid" || k === "comm" || k === "recordid") continue;
      body.set(k, v == null ? "" : String(v));
    }
    const { text } = await this.post("/page/submit/", body);
    if (!text.trim().toUpperCase().startsWith("OK")) {
      throw new Error(`edit_block unexpected response: "${text.slice(0, 200)}"`);
    }
    log("info", "xhr.edit_block", `Updated block ${blockid} on page ${p.pageid} (${Object.keys(p).length - 1} field(s))`);
  }

  async publish(pageid: string): Promise<PublishResult> {
    const body = new URLSearchParams({
      comm: "pagepublish",
      pageid,
      csrf: "",
      returnjson: "yes",
    });
    const { text } = await this.post("/page/publish/", body);
    let parsed: PublishResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`publish returned non-JSON: ${text.slice(0, 200)}`);
    }
    // Tilda's `link` is sometimes the project root (e.g. on first publish or repeat publish of
    // the index page) and sometimes the page-specific URL (`<root>/page<id>.html` or
    // `<root>/<alias>.html`). Detect:
    const rawLink = (parsed.link ?? "").replace(/\/$/, "");
    const publishedUrl = /\.html?(?:$|\?)/i.test(rawLink)
      ? rawLink
      : `${rawLink}/page${parsed.pageid}.html`;
    log("info", "xhr.publish", `published page ${pageid} → ${publishedUrl}`);
    return {
      published_url: publishedUrl,
      published_at: new Date().toISOString(),
    };
  }

  async healthCheck(): Promise<TransportHealth> {
    const age = stateAgeDays(this.stateFilePath);
    return {
      read_api: "ok",
      write_transport: this.cookieHeader && !stateIsStale(this.stateFilePath) ? "xhr_ready" : "playwright_session_expired",
      storage_state_age_days: age,
      active_transport: "xhr",
    };
  }

  async dispose(): Promise<void> {
    this.cookieHeader = null;
  }
}
