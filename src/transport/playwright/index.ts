import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { loadConfig } from "../../config.js";
import { log } from "../../logging.js";
import {
  AccountLockoutError,
  CaptchaEncounteredError,
  SessionExpiredError,
  type AddBlockResult,
  type CreatePageResult,
  type ImportZeroblockResult,
  type PublishResult,
  type TransportHealth,
  type WriteTransport,
} from "../writeTransport.js";
import { applyAntibotInitScript, detectCaptcha, launchArgs, realisticContextOptions } from "./antibot.js";
import { stateAgeDays, stateIsStale } from "./auth.js";
import { createPageFlow } from "./flows/createPage.js";
import { addBlockFlow } from "./flows/addBlock.js";
import { importZeroBlockFlow } from "./flows/importZeroBlock.js";
import { editBlockFlow } from "./flows/editBlock.js";
import { publishFlow } from "./flows/publish.js";

export class PlaywrightTransport implements WriteTransport {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private stateFilePath: string;
  private headlessMode = true;

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
    this.browser = await chromium.launch({
      headless: this.headlessMode,
      args: launchArgs,
    });
    this.context = await this.browser.newContext({
      ...realisticContextOptions(),
      storageState: this.stateFilePath,
    });
    await applyAntibotInitScript(this.context);
    log("info", "playwright.init", `Context initialised (headless=${this.headlessMode})`);
  }

  private async withPage<T>(tool: string, fn: (page: Page) => Promise<T>): Promise<T> {
    if (!this.context) throw new Error("PlaywrightTransport not initialised — call init() first");
    const page = await this.context.newPage();
    try {
      const res = await fn(page);
      // captcha guard right before close
      if (await detectCaptcha(page)) {
        throw new CaptchaEncounteredError(`CAPTCHA appeared during ${tool}`);
      }
      return res;
    } catch (err) {
      // surface 429 as AccountLockoutError if response status visible
      if (err instanceof Error && /429/.test(err.message)) {
        throw new AccountLockoutError(60, `429 from editor.tilda.cc during ${tool}`);
      }
      throw err;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async createPage(projectid: string, title: string, alias: string | null): Promise<CreatePageResult> {
    return this.withPage("create_page", (page) => createPageFlow(page, projectid, title, alias));
  }

  async addBlock(pageid: string, block_type: string, position: number | null): Promise<AddBlockResult> {
    return this.withPage("add_block", (page) => addBlockFlow(page, pageid, block_type, position));
  }

  async importZeroBlock(pageid: string, json: unknown, position: number | null): Promise<ImportZeroblockResult> {
    return this.withPage("import_zeroblock", (page) => importZeroBlockFlow(page, pageid, json, position));
  }

  async editBlock(blockid: string, patch: unknown): Promise<void> {
    await this.withPage("edit_block", (page) => editBlockFlow(page, blockid, patch));
  }

  async publish(pageid: string): Promise<PublishResult> {
    return this.withPage("publish", (page) => publishFlow(page, pageid));
  }

  async healthCheck(): Promise<TransportHealth> {
    const age = stateAgeDays(this.stateFilePath);
    const writeStatus = age < 0 ? "playwright_session_expired" : stateIsStale(this.stateFilePath) ? "playwright_session_expired" : "playwright_ready";
    return {
      read_api: "ok",
      write_transport: writeStatus,
      storage_state_age_days: age,
      active_transport: "playwright",
    };
  }

  async dispose(): Promise<void> {
    if (this.context) await this.context.close().catch(() => undefined);
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
  }
}
