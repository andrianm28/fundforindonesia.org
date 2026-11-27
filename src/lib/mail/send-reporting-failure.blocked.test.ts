import { describe, it, expect, vi, afterEach } from 'vitest';

const recordFailedNotification = vi.fn(async () => {});
vi.mock('./failed-queue', () => ({ recordFailedNotification }));

const { sendReportingFailure } = await import('./index');
const { BlockedRecipientError } = await import('./blocked-recipients');

afterEach(() => {
  vi.restoreAllMocks();
  recordFailedNotification.mockClear();
});

describe('sendReportingFailure to a blocked domain', () => {
  it('logs mail_recipient_blocked and never queues the message for a retry', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await sendReportingFailure(
      { to: 'x@blocked.example', subject: 's', text: 't', html: 'h' },
      { mail: 'campaign_update' },
      { name: 'smtp', send: async () => { throw new BlockedRecipientError(); } },
    );
    expect(ok).toBe(false);
    expect(recordFailedNotification).not.toHaveBeenCalled();
    const line = String(spy.mock.calls[0][0]);
    expect(JSON.parse(line).event).toBe('mail_recipient_blocked');
    expect(line).not.toContain('blocked.example');
  });
});
