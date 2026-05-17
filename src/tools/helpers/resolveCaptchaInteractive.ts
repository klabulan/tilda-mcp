import { z } from "zod";
import { log } from "../../logging.js";

export const resolveCaptchaInteractiveSchema = z.object({
  pageid: z.string().nullable().optional().describe("Optional context — which page was being acted on when CAPTCHA appeared"),
});

/**
 * STUB.
 *
 * Real implementation requires Playwright to expose the current context mid-flow,
 * which is non-trivial (see fork_spec.md §5.4: headless↔headed toggle is not supported,
 * we have to save state + close + relaunch headed).
 *
 * For v0: this tool tells the user to delete state.json and re-run login_headed_bootstrap.
 * v0.1 will spawn a headed window over the same context after fixing the save-close-relaunch dance.
 */
export async function handleResolveCaptchaInteractive(
  _params: z.infer<typeof resolveCaptchaInteractiveSchema>,
): Promise<string> {
  log("warn", "resolve_captcha_interactive", "STUB v0 — fallback to manual re-bootstrap.");
  return JSON.stringify(
    {
      resolved: false,
      retries_remaining: 0,
      hint: "v0 limitation: delete ~/.config/tilda-mcp/state.json and call login_headed_bootstrap to re-establish a clean session. v0.1 will solve CAPTCHA in-place.",
    },
    null,
    2,
  );
}
