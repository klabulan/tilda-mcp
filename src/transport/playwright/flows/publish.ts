import type { Page } from "playwright";
import { humanDelay } from "../antibot.js";
import { selectors } from "../selectors.js";
import type { PublishResult } from "../../writeTransport.js";
import { log } from "../../../logging.js";

/**
 * TBD: Real implementation pending selector capture.
 * Flow outline:
 *   1. goto editor for pageid
 *   2. click publishButton
 *   3. wait for confirmation toast / publishedUrlReadout
 *   4. extract published URL (preferred) or compute from project alias + page alias
 *   5. return { published_url, published_at: ISO timestamp }
 *
 * Fallback if publishedUrlReadout not capturable: poll get_page(pageid) (read-MCP) until published=1,
 * then construct URL as `https://<project-alias>.tilda.ws/<page-alias>.html`.
 */
export async function publishFlow(
  page: Page,
  pageid: string,
): Promise<PublishResult> {
  log("warn", "publish", "STUB: selectors not yet captured. Implement after t01b codegen session.");
  await page.goto(`https://tilda.cc/page/?pageid=${encodeURIComponent(pageid)}`);
  await humanDelay();
  void selectors;
  throw new Error("publish flow not yet implemented — pending selector capture.");
}
