import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPE_META, notificationTypeMeta } from './notification-types';

// Literals, not read from the module: these are every `type` string the
// system writes into Notification today (grep of notification.create sites).
const SYSTEM_TYPES = [
  'donation_confirmed',
  'campaign_update',
  'disbursement',
  'registration_confirmed',
  'campaign_deadline_reminder',
  'kind_authorisation_expiry_warning',
  'campaign_transfer',
  'campaign_status',
  'assignment_granted',
  'assignment_revoked',
  'volunteer_trip_moderation',
  'bank_account_verification',
  'payment_expired',
  'payment_failed',
  'refund_completed',
];

describe('notification type registry (inbox)', () => {
  it.each(SYSTEM_TYPES)('has an Indonesian label and a tone for %s', (type) => {
    const meta = NOTIFICATION_TYPE_META[type];
    expect(meta).toBeDefined();
    expect(meta.label.length).toBeGreaterThan(0);
    expect(['success', 'info', 'money', 'warning', 'error']).toContain(meta.tone);
  });

  it('shows payment problems as error/warning and a refund as money', () => {
    expect(notificationTypeMeta('payment_failed').tone).toBe('error');
    expect(notificationTypeMeta('payment_expired').tone).toBe('warning');
    expect(notificationTypeMeta('refund_completed').tone).toBe('money');
  });

  it('falls back to a neutral entry for a type it does not know', () => {
    expect(notificationTypeMeta('something_new')).toEqual({ label: 'Notifikasi', tone: 'info' });
  });
});
