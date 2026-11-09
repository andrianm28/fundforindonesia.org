import type { CampaignLifecycleStatus } from "@/types/campaign";

/**
 * Submitting a Campaign to a Verifier, and withdrawing that submission, as
 * both the server and the browser need it (verification-request 01, 03). Free of Prisma values, so pages can
 * import it.
 */

/** The statuses a Fundraiser may submit from: `submitCampaign` runs from these, and pages offer the action on them. */
export const SUBMITTABLE_STATUSES: readonly CampaignLifecycleStatus[] = ["DRAFT", "REJECTED"];

/** Shown beside a submit button whose "pernyataan kebenaran data" is not ticked (PKS pasal 3.3). */
export const TRUTH_STATEMENT_REQUIRED = "Centang pernyataan kebenaran data untuk mengajukan Campaign.";

/**
 * Asks the server to submit the Campaign, opening its Verification Request.
 * `truthStatement` is the ticked "pernyataan kebenaran data" (PKS pasal 3.3):
 * unticked, nothing is sent. Resolves to null on success, or to the
 * Indonesian refusal to show.
 */
export function submitToVerifier(slug: string, truthStatement: boolean): Promise<string | null> {
  if (!truthStatement) return Promise.resolve(TRUTH_STATEMENT_REQUIRED);
  return post(`/api/campaigns/${slug}/verification-requests`, "Gagal mengajukan campaign ke Verifier.", {
    truthStatement: true,
  });
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

/** A POST, with a JSON body when given: null on success, else the server's refusal or `fallback`. */
async function post(url: string, fallback: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(
      url,
      body === undefined
        ? { method: "POST" }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (res.ok) return null;
    const refusal = await res.json().catch(() => ({}));
    return typeof refusal.error === "string" && refusal.error !== "" ? refusal.error : fallback;
  } catch {
    return fallback;
  }
}
