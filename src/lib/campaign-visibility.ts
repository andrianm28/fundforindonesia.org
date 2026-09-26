import { Assignment, CampaignStatus } from "@/generated/prisma/client";
import { hasAssignment } from "./withAssignmentCheck";

/**
 * Who may open a Campaign's page (CONTEXT.md, Campaign Status). A Campaign
 * that has not been approved (Draft, Submitted, Rejected) opens only for its
 * Fundraiser and for holders of the VERIFIER or ADMIN assignment; every
 * approved status opens for anyone.
 *
 * Viewing is not acting, so the Capacity rule (./capacity.ts) that bars a
 * Verifier or Admin from acting on their own Campaign does not apply here:
 * an owner who holds VERIFIER sees their Campaign like any Verifier, and as
 * its Fundraiser anyway.
 *
 * Pure: it reads nothing. Keyed by every status, so a status added later
 * fails to compile until someone decides whether it is public.
 */
const PUBLIC: Record<CampaignStatus, boolean> = {
  DRAFT: false,
  SUBMITTED: false,
  REJECTED: false,
  ACTIVE: true,
  SUSPENDED: true,
  CANCELLED: true,
  COMPLETED: true,
  EXPIRED: true,
};

/**
 * Whether a Campaign in this effective status opens for anyone, so its
 * answer may be the same for every viewer. False for an unknown status:
 * deny by default.
 */
export function isPubliclyViewable(status: CampaignStatus): boolean {
  return PUBLIC[status] === true;
}

/** The signed-in viewer, as the session carries them; null when anonymous. */
export type CampaignViewer = {
  id: string;
  assignments?: Assignment[];
} | null | undefined;

/** Whether this viewer may open a Campaign in this effective status. */
export function mayViewCampaign(
  campaign: { status: CampaignStatus; creatorId: string },
  viewer: CampaignViewer
): boolean {
  if (isPubliclyViewable(campaign.status)) return true;
  if (!viewer?.id) return false;
  return (
    viewer.id === campaign.creatorId ||
    hasAssignment(viewer.assignments, Assignment.VERIFIER) ||
    hasAssignment(viewer.assignments, Assignment.ADMIN)
  );
}
