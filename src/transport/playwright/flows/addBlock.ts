import type { Page } from "playwright";
import { humanDelay } from "../antibot.js";
import { selectors } from "../selectors.js";
import type { AddBlockResult } from "../../writeTransport.js";
import { log } from "../../../logging.js";

/**
 * TBD: Real implementation pending selector capture.
 * Flow outline:
 *   1. goto editor URL for pageid
 *   2. click addBlockButton (between blocks at `position`, or at the end if null)
 *   3. wait for blockTypePanel
 *   4. click blockTypeOption(block_type) — e.g. T396 for Zero Block, T123 for header
 *   5. wait for the new block to appear in editor; extract its block_id (DOM attribute / network response)
 */
export async function addBlockFlow(
  page: Page,
  pageid: string,
  block_type: string,
  position: number | null,
): Promise<AddBlockResult> {
  log("warn", "add_block", "STUB: selectors not yet captured. Implement after t01b codegen session.");
  await page.goto(`https://tilda.cc/page/?pageid=${encodeURIComponent(pageid)}`);
  await humanDelay();
  void selectors;
  void block_type;
  void position;
  throw new Error("add_block flow not yet implemented — pending selector capture.");
}
