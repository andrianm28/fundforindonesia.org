import type { CampaignLifecycleStatus } from "@/types/campaign";

/**
 * Submitting a Campaign to a Verifier, and withdrawing that submission, as
 * both the server and the browser need it (verification-request 01, 03). Free of Prisma values, so pages can
 * import it.
 */

/** The statuses a Fundraiser may submit from: `submitCampaign` runs from these, and pages offer the action on them. */
export const SUBMITTABLE_STATUSES: readonly CampaignLifecycleStatus[] = ["DRAFT", "REJECTED"];

/**
 * Asks the server to submit the Campaign, opening its Verification Request.
 * Resolves to null on success, or to the Indonesian refusal to show.
 */
export function submitToVerifier(slug: string): Promise<string | null> {
  return post(`/api/campaigns/${slug}/verification-requests`, "Gagal mengajukan campaign ke Verifier.");
}

/**
 * Asks the server to withdraw the Campaign's pending Verification Request
 * (verification-request 03). Resolves to null on success, or to the
 * Indonesian refusal to show.
 */
export function withdrawFromVerifier(slug: string, requestId: string): Promise<string | null> {
  return post(
    `/api/campaigns/${slug}/verification-requests/${requestId}/withdraw`,
    "Gagal menarik pengajuan campaign."
  );
}

/** A bodiless POST: null on success, else the server's refusal or `fallback`. */
async function post(url: string, fallback: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "POST" });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return typeof body.error === "string" && body.error !== "" ? body.error : fallback;
  } catch {
    return fallback;
  }
}
