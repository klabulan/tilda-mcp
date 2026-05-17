import { z } from "zod";
import { getWriteTransport, reportTransportFailure, resetFailureCounter } from "../../transport/factory.js";
import { log } from "../../logging.js";

export const publishSchema = z.object({
  pageid: z.string().describe("Tilda page id"),
});

export async function handlePublish(params: z.infer<typeof publishSchema>): Promise<string> {
  try {
    const t = await getWriteTransport();
    const result = await t.publish(params.pageid);
    resetFailureCounter();
    log("info", "publish", `Published page ${params.pageid} → ${result.published_url}`);
    return JSON.stringify(result, null, 2);
  } catch (e) {
    await reportTransportFailure();
    throw e;
  }
}
