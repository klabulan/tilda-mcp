export interface TransportHealth {
  read_api: "ok" | "auth_failed" | "rate_limited" | "unreachable";
  write_transport:
    | "playwright_ready"
    | "playwright_session_expired"
    | "xhr_ready"
    | "xhr_signatures_stale"
    | "unreachable";
  storage_state_age_days: number;
  active_transport: "playwright" | "xhr";
}

export interface CreatePageResult {
  page_id: string;
  alias: string;
  preview_url: string;
  published_url: string | null;
}

export interface AddBlockResult {
  block_id: string;
}

export interface ImportZeroblockResult {
  block_id: string;
  success: boolean;
  log: string[];
}

export interface PublishResult {
  published_url: string;
  published_at: string;
}

export interface SetPageSettingsResult {
  success: boolean;
  republish_required: boolean;
}

export interface DeletePageResult {
  success: boolean;
}

export interface WriteTransport {
  init(): Promise<void>;
  createPage(projectid: string, title: string, alias: string | null): Promise<CreatePageResult>;
  setPageSettings(pageid: string, title: string | null, descr: string | null, alias: string | null): Promise<SetPageSettingsResult>;
  deletePage(pageid: string): Promise<DeletePageResult>;
  addBlock(pageid: string, block_type: string, position: number | null): Promise<AddBlockResult>;
  importZeroBlock(pageid: string, json: unknown, position: number | null): Promise<ImportZeroblockResult>;
  getZeroBlock?(pageid: string, recordid: string): Promise<unknown>;
  editBlock(blockid: string, patch: unknown): Promise<void>;
  publish(pageid: string): Promise<PublishResult>;
  healthCheck(): Promise<TransportHealth>;
  dispose(): Promise<void>;
}

export class SessionExpiredError extends Error {
  constructor(msg = "Tilda session expired — call login_headed_bootstrap to refresh") {
    super(msg);
    this.name = "SessionExpiredError";
  }
}

export class CaptchaEncounteredError extends Error {
  constructor(msg = "CAPTCHA encountered — call resolve_captcha_interactive to continue") {
    super(msg);
    this.name = "CaptchaEncounteredError";
  }
}

export class AccountLockoutError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, msg = "Tilda account temporarily locked") {
    super(msg);
    this.name = "AccountLockoutError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class TransportNotImplementedError extends Error {
  constructor(transport: string, operation: string) {
    super(`Transport "${transport}" does not implement "${operation}"`);
    this.name = "TransportNotImplementedError";
  }
}
