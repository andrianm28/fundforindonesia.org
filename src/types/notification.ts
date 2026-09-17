// Notification and AutoDonation entity types matching Prisma models

export type NotificationType =
  | "donation_confirmed"
  | "campaign_update"
  | "disbursement";

export type AutoDonationSchedule = "daily" | "weekly";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  userId: string;
  link?: string | null;
  createdAt: Date;
}

export interface AutoDonation {
  id: string;
  amount: number;
  category: string;
  schedule: AutoDonationSchedule;
  time: string; // "HH:mm" format
  isActive: boolean;
  userId: string;
  createdAt: Date;
}

// Relation types

export interface NotificationWithUser extends Notification {
  user: import("./user").User;
}

export interface AutoDonationWithUser extends AutoDonation {
  user: import("./user").User;
}

// Input/create types

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  userId: string;
  link?: string;
}

export interface CreateAutoDonationInput {
  amount: number;
  category: string;
  schedule: AutoDonationSchedule;
  time: string;
}

export interface UpdateAutoDonationInput {
  amount?: number;
  category?: string;
  schedule?: AutoDonationSchedule;
  time?: string;
  isActive?: boolean;
}

// Query/list types

export interface NotificationListResponse {
  notifications: Notification[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  unreadCount: number;
}

export interface MarkNotificationsReadInput {
  notificationIds: string[];
}
