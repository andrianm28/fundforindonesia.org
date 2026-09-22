// Donation and Prayer entity types matching Prisma models

export type PaymentStatus = "pending" | "confirmed" | "failed";

export type PaymentMethodType = "bank_transfer" | "qris" | "ewallet" | "credit_card";

export interface Donation {
  id: string;
  amount: number;
  isAnonymous: boolean;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  message?: string | null;
  campaignId: string;
  donorId?: string | null;
  createdAt: Date;
}

export interface Prayer {
  id: string;
  text: string;
  amiinCount: number;
  donationId: string;
  campaignId: string;
  userId?: string | null;
  createdAt: Date;
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: PaymentMethodType;
  icon: string;
  fee: number;
  instructions?: string;
}

// Relation types

export interface DonationWithRelations extends Donation {
  campaign: import("./campaign").Campaign;
  donor?: import("./user").User | null;
  prayer?: Prayer | null;
}

export interface DonationWithCampaign extends Donation {
  campaign: {
    id: string;
    slug: string;
    title: string;
    coverImage: string;
  };
}

export interface DonationWithDonor extends Donation {
  donor?: {
    id: string;
    name: string;
    avatar?: string | null;
  } | null;
}

export interface PrayerWithRelations extends Prayer {
  donation: Donation;
  campaign: import("./campaign").Campaign;
  user?: import("./user").User | null;
}

export interface PrayerWithUser extends Prayer {
  user?: {
    id: string;
    name: string;
    avatar?: string | null;
  } | null;
}

export interface PrayerWithCampaign extends Prayer {
  campaign: {
    id: string;
    slug: string;
    title: string;
  };
}

// Input/create types

export interface CreateDonationInput {
  amount: number;
  isAnonymous?: boolean;
  paymentMethod: string;
  message?: string;
  campaignId: string;
}

export interface ConfirmDonationInput {
  donationId: string;
}

// Query/list types

export interface DonationListResponse {
  donations: DonationWithDonor[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PrayerListResponse {
  prayers: PrayerWithUser[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Donation flow types

export interface DonationFlowState {
  campaignId: string;
  amount: number | null;
  paymentMethod: PaymentMethod | null;
  message: string;
  isAnonymous: boolean;
  step: "amount" | "payment" | "confirmation" | "success";
}
