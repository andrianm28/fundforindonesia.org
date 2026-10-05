// Campaign entity types matching Prisma models

import type { CampaignStatus } from "@/generated/prisma/client";
import type { CampaignKind } from "@/lib/campaign-kind";
import type { CollectingEntityBlock } from "@/lib/collecting-entity";

/**
 * The Campaign Status as payloads and pages carry it, in `lifecycleStatus`
 * (the legacy `status` string is never sent). Sent effective: an Active
 * Campaign past its deadline already arrives as EXPIRED. A type-only import
 * of the Prisma enum, so the generated client never reaches a browser
 * bundle.
 */
export type CampaignLifecycleStatus = CampaignStatus;

export interface Campaign {
  id: string;
  slug: string;
  title: string;
  description: string;
  story: string;
  coverImage: string;
  targetAmount: number;
  collectedAmount: number;
  category: string;
  /** Which money rules it follows (CONTEXT.md, Kind). Optional so fixtures need not name it; every payload carries it. */
  kind?: CampaignKind;
  /** Effective. A reader that needs it treats absence as not Active. */
  lifecycleStatus?: CampaignLifecycleStatus;
  /** The Partner Organisation that collects its money (ADR 0010), as GET /api/campaigns/[slug] sends it. */
  collectingEntity?: { id: string; name: string } | null;
  /** Why an Active Campaign cannot take a Donation right now because of its Collecting Entity; null when it can. */
  donationBlock?: CollectingEntityBlock | null;
  /** Platform Fee rate in force, in basis points, as GET /api/campaigns/[slug] sends it (CONTEXT.md, Platform Fee). Optional so fixtures need not name it. */
  platformFeePercentBps?: number;
  /** Donations below this Gross carry no Platform Fee (same payload). */
  platformFeeThresholdAmount?: number;
  /** Escrow Hold length every new Payment freezes at creation (same payload). */
  escrowHoldDays?: number;
  isUrgent: boolean;
  /** Sample content marked by the task M9 migration -- see schema.prisma. Never take money from a campaign where this is true. */
  isDemo: boolean;
  deadline?: Date | null;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignUpdate {
  id: string;
  title: string;
  content: string;
  images: string[];
  campaignId: string;
  createdAt: Date;
}

export interface Disbursement {
  id: string;
  amount: number;
  description: string;
  proofImage?: string | null;
  campaignId: string;
  createdAt: Date;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  order: number;
}

// Relation types

export interface CampaignWithRelations extends Campaign {
  creator: import("./user").User;
  donations: import("./donation").Donation[];
  updates: CampaignUpdate[];
  disbursements: Disbursement[];
  prayers: import("./donation").Prayer[];
}

export interface CampaignWithCreator extends Campaign {
  creator: {
    id: string;
    name: string;
    avatar?: string | null;
  };
}

export interface CampaignWithDonations extends Campaign {
  donations: import("./donation").Donation[];
}

export interface CampaignWithUpdates extends Campaign {
  updates: CampaignUpdate[];
}

export interface CampaignUpdateWithCampaign extends CampaignUpdate {
  campaign: Campaign;
}

export interface DisbursementWithCampaign extends Disbursement {
  campaign: Campaign;
}

// Input/create types

export interface CreateCampaignInput {
  title: string;
  description: string;
  story: string;
  coverImage: string;
  targetAmount: number;
  category: string;
  isUrgent?: boolean;
  deadline?: Date | null;
}

export interface UpdateCampaignInput {
  title?: string;
  description?: string;
  story?: string;
  coverImage?: string;
  targetAmount?: number;
  category?: string;
  isUrgent?: boolean;
  deadline?: Date | null;
}

export interface CreateCampaignUpdateInput {
  title: string;
  content: string;
  images?: string[];
}

export interface CreateDisbursementInput {
  amount: number;
  description: string;
  proofImage?: string;
}

// Query/filter types

export interface CampaignFilters {
  category?: string;
  search?: string;
  urgent?: boolean;
}

export interface CampaignListResponse {
  campaigns: CampaignWithCreator[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Card display type (subset for rendering cards)

export interface CampaignCardData {
  id: string;
  slug: string;
  title: string;
  coverImage: string;
  collectedAmount: number;
  targetAmount: number;
  category: string;
  deadline: Date | null;
  isUrgent: boolean;
  isDemo: boolean;
  creator: {
    name: string;
  };
}
