/**
 * Registry of every Notification `type` the system writes, with the label and
 * icon tone the inbox shows for it (PKS pasal 3.10(1)). Add a row here when a
 * new notification type is introduced; the inbox falls back to a neutral entry
 * for anything not listed rather than mislabelling it.
 */
export type NotificationTone = 'success' | 'info' | 'money' | 'warning' | 'error';

export interface NotificationTypeMeta {
  label: string;
  tone: NotificationTone;
}

export const NOTIFICATION_TYPE_META: Record<string, NotificationTypeMeta> = {
  donation_confirmed: { label: 'Donasi', tone: 'success' },
  registration_confirmed: { label: 'Registrasi', tone: 'success' },
  campaign_update: { label: 'Kabar Terbaru', tone: 'info' },
  campaign_status: { label: 'Status Campaign', tone: 'info' },
  campaign_deadline_reminder: { label: 'Pengingat Tenggat', tone: 'warning' },
  kind_authorisation_expiry_warning: { label: 'Izin Segera Berakhir', tone: 'warning' },
  campaign_transfer: { label: 'Pemindahan Campaign', tone: 'info' },
  assignment_granted: { label: 'Penugasan', tone: 'info' },
  assignment_revoked: { label: 'Penugasan Dicabut', tone: 'warning' },
  volunteer_trip_moderation: { label: 'Moderasi Trip', tone: 'info' },
  bank_account_verification: { label: 'Verifikasi Rekening', tone: 'info' },
  disbursement: { label: 'Pencairan Dana', tone: 'money' },
  payout_revision: { label: 'Revisi Pencairan', tone: 'warning' },
  payment_expired: { label: 'Pembayaran Kedaluwarsa', tone: 'warning' },
  payment_failed: { label: 'Pembayaran Gagal', tone: 'error' },
  refund_completed: { label: 'Refund', tone: 'money' },
  recurring_donation_bill: { label: 'Donasi Rutin', tone: 'money' },
};

const FALLBACK: NotificationTypeMeta = { label: 'Notifikasi', tone: 'info' };

export function notificationTypeMeta(type: string): NotificationTypeMeta {
  return NOTIFICATION_TYPE_META[type] ?? FALLBACK;
}
