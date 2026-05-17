import { loadConfig } from "../../config.js";
import { log } from "../../logging.js";
import {
  TransportNotImplementedError,
  SessionExpiredError,
  type AddBlockResult,
  type CreatePageResult,
  type ImportZeroblockResult,
  type PublishResult,
  type TransportHealth,
  type WriteTransport,
} from "../writeTransport.js";
import { cookieHeaderForHost } from "./cookies.js";
import { stateAgeDays, stateIsStale } from "../playwright/auth.js";

const TILDA_HOST = "tilda.ru"; // captured 2026-05-17: cookies persist on .ru after login
const BASE_URL = `https://${TILDA_HOST}`;
const REALISTIC_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

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
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": this.cookieHeader,
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/`,
        "User-Agent": REALISTIC_UA,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/plain, */*",
      },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Tilda XHR ${res.status} ${res.statusText} on ${path}: ${text.slice(0, 200)}`);
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

  async importZeroBlock(): Promise<ImportZeroblockResult> {
    throw new TransportNotImplementedError(
      "xhr",
      "importZeroBlock — Zero Block content endpoints not yet captured. Run scripts/tilda/explore7_zeroblock_setdata.mjs."
    );
  }

  async editBlock(): Promise<void> {
    throw new TransportNotImplementedError(
      "xhr",
      "editBlock — generic block-edit endpoints not yet captured."
    );
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
