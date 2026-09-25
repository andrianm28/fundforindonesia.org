import {
  decideSubmission,
  isSubmissionDecision,
  LifecycleValidationError,
} from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * A Verifier approves or rejects a Submitted Campaign: `{ action }`. There
 * is no `suspend`: a Verifier raises a Flag and an Admin decides on
 * Suspension (ADR 0005, FFI-07b), so `suspend` is refused like any other
 * unknown action.
 */
export const PATCH = lifecycleRoute({
  campaign: "id",
  command: decideSubmission,
  input: ({ body }) => {
    if (!isSubmissionDecision(body.action)) {
      throw new LifecycleValidationError("Aksi tidak valid. Gunakan approve atau reject.", "action");
    }
    return { decision: body.action };
  },
});
