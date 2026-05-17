import type { Page } from "playwright";
import { humanDelay } from "../antibot.js";
import { selectors } from "../selectors.js";
import { log } from "../../../logging.js";

/**
 * TBD: Real implementation pending selector capture + patch shape per block type.
 * Flow outline:
 *   1. resolve blockid → pageid via internal mapping (or accept pageid as part of patch)
 *   2. goto editor
 *   3. click block by blockid
 *   4. apply patch:
 *        - Zero Block: open ZB editor, iterate elements, set props
 *        - T-block: open block settings panel, set fields from patch.settings/content
 *   5. save
 */
export async function editBlockFlow(
  page: Page,
  blockid: string,
  patch: unknown,
): Promise<void> {
  log("warn", "edit_block", "STUB: selectors + patch shape not yet captured. Implement after t01b codegen.");
  await humanDelay();
  void page;
  void selectors;
  void blockid;
  void patch;
  throw new Error("edit_block flow not yet implemented — pending selector capture.");
}
