import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const setPageSettingsSchema = z.object({
  pageid: z.string().describe("Tilda page id"),
  title: z.string().nullable().optional().describe("New page title (visible in browser tab + project list)"),
  descr: z.string().nullable().optional().describe("Meta description (SEO)"),
  alias: z.string().nullable().optional().describe("URL slug — non-empty means page publishes as <project>.tilda.ws/<alias>.html instead of pageNNN.html"),
});

export async function handleSetPageSettings(params: z.infer<typeof setPageSettingsSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    const result = await t.setPageSettings(
      params.pageid,
      params.title ?? null,
      params.descr ?? null,
      params.alias ?? null,
    );
    resetFailureCounter();
    log("info", "set_page_settings", `Updated page ${params.pageid}; republish_required=${result.republish_required}`);
    return JSON.stringify(result, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
