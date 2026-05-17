import {
  TransportNotImplementedError,
  type AddBlockResult,
  type CreatePageResult,
  type ImportZeroblockResult,
  type PublishResult,
  type TransportHealth,
  type WriteTransport,
} from "../writeTransport.js";

/**
 * XHR-RE transport — STUB.
 *
 * Capture methodology lives in fork_spec.md §2.3. Concrete signatures will be captured in a
 * separate session by opening DevTools → Network → XHR on editor.tilda.cc, performing each
 * action manually, and recording url/method/headers/body into src/transport/xhr/signatures/*.json.
 *
 * Until signatures exist, every write operation throws TransportNotImplementedError.
 * The MCP layer should not route here while `TILDA_MCP_TRANSPORT=playwright` (the default).
 */
export class XhrTransport implements WriteTransport {
  async init(): Promise<void> {
    // Future: load + validate signatures from src/transport/xhr/signatures/
  }

  async createPage(): Promise<CreatePageResult> {
    throw new TransportNotImplementedError("xhr", "createPage");
  }

  async addBlock(): Promise<AddBlockResult> {
    throw new TransportNotImplementedError("xhr", "addBlock");
  }

  async importZeroBlock(): Promise<ImportZeroblockResult> {
    throw new TransportNotImplementedError("xhr", "importZeroBlock");
  }

  async editBlock(): Promise<void> {
    throw new TransportNotImplementedError("xhr", "editBlock");
  }

  async publish(): Promise<PublishResult> {
    throw new TransportNotImplementedError("xhr", "publish");
  }

  async healthCheck(): Promise<TransportHealth> {
    return {
      read_api: "ok",
      write_transport: "xhr_signatures_stale",
      storage_state_age_days: -1,
      active_transport: "xhr",
    };
  }

  async dispose(): Promise<void> {
    /* no-op */
  }
}
