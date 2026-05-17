import type { Page } from "playwright";
import { humanDelay } from "../antibot.js";
import { selectors } from "../selectors.js";
import type { ImportZeroblockResult } from "../../writeTransport.js";
import { log } from "../../../logging.js";

/**
 * Path A implementation: drive Zero Block primitives directly.
 * Does NOT use Tilda's built-in "Import from Figma" UI (user decision 2026-05-16).
 *
 * Flow outline (TBD after selector capture):
 *   1. goto editor URL for pageid
 *   2. add a Zero Block at `position` (or end)
 *   3. open Zero Block editor (double-click or "Edit" button)
 *   4. for each element in zero_block_json.elements:
 *        - click addElementButton
 *        - choose elementTypeOption(element.type) — text / image / shape / button
 *        - set props (x, y, w, h, content) per element schema
 *   5. saveButton → closeButton
 *   6. extract block_id from DOM/network and return
 *
 * zero_block_json schema: TBD in Tasks/<t02 design>/zeroblock_schema_v1.md
 */
export async function importZeroBlockFlow(
  page: Page,
  pageid: string,
  json: unknown,
  position: number | null,
): Promise<ImportZeroblockResult> {
  log("warn", "import_zeroblock", "STUB: selectors + schema not yet captured. Implement after t01b codegen + t02 schema.");
  await page.goto(`https://tilda.cc/page/?pageid=${encodeURIComponent(pageid)}`);
  await humanDelay();
  void selectors;
  void json;
  void position;
  throw new Error("import_zeroblock flow not yet implemented — pending selector capture + zeroblock_schema.");
}
