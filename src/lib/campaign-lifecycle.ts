import { CampaignStatus } from "@/generated/prisma/client";

/**
 * Single source of the legacy-string to lifecycle-enum mapping.
 * Every writer that sets the `status` string sets `lifecycleStatus`
 * through this function, so the two columns cannot diverge.
 *
 * Unknown strings throw rather than map to a default: writing a
 * lifecycle state that is not one of the six known legacy values
 * must fail loudly, never silently land somewhere plausible.
 */
const STRING_TO_LIFECYCLE: Record<string, CampaignStatus> = {
  pending: CampaignStatus.SUBMITTED,
  active: CampaignStatus.ACTIVE,
  rejected: CampaignStatus.REJECTED,
  suspended: CampaignStatus.SUSPENDED,
  completed: CampaignStatus.COMPLETED,
  expired: CampaignStatus.EXPIRED,
};

export function toLifecycleStatus(status: string): CampaignStatus {
  const mapped = STRING_TO_LIFECYCLE[status];
  if (!mapped) {
    throw new Error(
      `Unknown legacy campaign status: ${JSON.stringify(status)}`
    );
  }
  return mapped;
}
