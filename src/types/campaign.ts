// Campaign entity types matching Prisma models

export type CampaignStatus = "active" | "completed" | "expired";

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
  status: CampaignStatus;
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
    isVerified: boolean;
    verificationType?: "ktp" | "organization" | null;
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
  status?: CampaignStatus;
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
  status?: CampaignStatus;
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
    isVerified: boolean;
    verificationType: string | null;
  };
}
