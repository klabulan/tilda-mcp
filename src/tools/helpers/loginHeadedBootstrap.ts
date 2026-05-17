import { z } from "zod";
import { bootstrapHeadedLogin } from "../../transport/playwright/auth.js";

export const loginHeadedBootstrapSchema = z.object({
  email: z.string().nullable().optional().describe("Tilda account email; null/omit → no prefill, fully manual entry"),
  state_path: z.string().nullable().optional().describe("Override storageState path; null/omit → default ~/.config/tilda-mcp/state.json"),
});

export async function handleLoginHeadedBootstrap(params: z.infer<typeof loginHeadedBootstrapSchema>): Promise<string> {
  const result = await bootstrapHeadedLogin(params.email ?? null, params.state_path ?? null);
  return JSON.stringify(result, null, 2);
}
