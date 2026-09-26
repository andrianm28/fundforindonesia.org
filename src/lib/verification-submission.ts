import type { CampaignLifecycleStatus } from "@/types/campaign";

/**
 * Submitting a Campaign to a Verifier, as both the server and the browser
 * need it (verification-request 01). Free of Prisma values, so pages can
 * import it.
 */

/** The statuses a Fundraiser may submit from: `submitCampaign` runs from these, and pages offer the action on them. */
export const SUBMITTABLE_STATUSES: readonly CampaignLifecycleStatus[] = ["DRAFT", "REJECTED"];

/**
 * Asks the server to submit the Campaign, opening its Verification Request.
 * Resolves to null on success, or to the Indonesian refusal to show.
 */
export async function submitToVerifier(slug: string): Promise<string | null> {
  const fallback = "Gagal mengajukan campaign ke Verifier.";
  try {
    const res = await fetch(`/api/campaigns/${slug}/verification-requests`, { method: "POST" });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return typeof body.error === "string" && body.error !== "" ? body.error : fallback;
  } catch {
    return fallback;
  }
}
