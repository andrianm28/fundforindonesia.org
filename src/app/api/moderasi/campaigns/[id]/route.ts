import {
  decideVerificationRequest,
  isVerificationDecision,
  LifecycleValidationError,
} from "@/lib/campaign-lifecycle";
import { lifecycleRoute } from "@/lib/lifecycle-route";

/**
 * A Verifier decides the Campaign's PENDING Verification Request:
 * `{ action, requestId, ticked?, reason?, identityNote? }`. `action` is
 * approve or reject; `requestId` names the request the Verifier looked at,
 * so a stale page never decides a newer one; `ticked` lists the checklist
 * item ids they ticked; `reason` is required to reject (an approval takes
none, so one sent with it is ignored); `identityNote` goes
 * on the Fundraiser's Identity Verification if this approval records it.
 * There is no `suspend`: a Verifier raises a Flag and an Admin decides on
 * Suspension (ADR 0005, FFI-07b), so `suspend` is refused like any other
 * unknown action.
 */
export const PATCH = lifecycleRoute({
  campaign: "id",
  command: decideVerificationRequest,
  input: ({ body }) => {
    if (!isVerificationDecision(body.action)) {
      throw new LifecycleValidationError("Aksi tidak valid. Gunakan approve atau reject.", "action");
    }
    if (typeof body.requestId !== "string" || body.requestId === "") {
      throw new LifecycleValidationError("Verification Request wajib disebutkan.", "requestId");
    }
    return {
      decision: body.action,
      requestId: body.requestId,
      ticked: body.ticked,
      reason: body.reason,
      identityNote: body.identityNote,
    };
  },
});
