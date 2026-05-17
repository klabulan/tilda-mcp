import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const createPageSchema = z.object({
  projectid: z.string().describe("Tilda project id (e.g. \"25668306\")"),
  title: z.string().describe("Page title (human-readable)"),
  alias: z.string().nullable().optional().describe("URL slug; null/omit → Tilda auto-generates"),
});

export async function handleCreatePage(params: z.infer<typeof createPageSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    const result = await t.createPage(params.projectid, params.title, params.alias ?? null);
    resetFailureCounter();
    log("info", "create_page", `Created page ${result.page_id} (alias=${result.alias}) in project ${params.projectid}`);
    return JSON.stringify(result, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
