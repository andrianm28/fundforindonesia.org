// Notification entity types matching Prisma models

export type NotificationType =
  | "donation_confirmed"
  | "campaign_update"
  | "disbursement"
  | "registration_confirmed"
  | "campaign_deadline_reminder"
  | "kind_authorisation_expiry_warning"
  | "campaign_transfer"
  | "campaign_status"
  | "assignment_granted"
  | "assignment_revoked"
  | "volunteer_trip_moderation"
  | "bank_account_verification"
  | "payment_expired"
  | "payment_failed"
  | "refund_completed"
  | "recurring_donation_bill";

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

// Relation types

export interface NotificationWithUser extends Notification {
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
