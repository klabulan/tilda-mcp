import type { Page } from "playwright";
import { humanDelay } from "../antibot.js";
import { selectors } from "../selectors.js";
import type { CreatePageResult } from "../../writeTransport.js";
import { log } from "../../../logging.js";

/**
 * TBD: Real implementation pending selector capture in t01b smoke session.
 * Flow outline:
 *   1. goto https://tilda.cc/projects/
 *   2. click projectCard for the given projectid
 *   3. click addPageButton
 *   4. fill newPage.titleInput, optionally newPage.aliasInput
 *   5. click newPage.blankTemplateOption
 *   6. click newPage.submitButton
 *   7. wait for editor URL containing the new page_id, extract it
 *   8. return { page_id, alias, preview_url, published_url: null }
 */
export async function createPageFlow(
  page: Page,
  projectid: string,
  title: string,
  alias: string | null,
): Promise<CreatePageResult> {
  log("warn", "create_page", "STUB: selectors not yet captured. Implement after t01b codegen session.");
  await page.goto(`https://tilda.cc/projects/?projectid=${encodeURIComponent(projectid)}`);
  await humanDelay();
  // Placeholder — actual interaction comes from captured selectors.
  void selectors;
  void title;
  void alias;
  throw new Error("create_page flow not yet implemented — pending selector capture.");
}
