import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendReportingFailure, type Mailer } from './index';

afterEach(() => vi.restoreAllMocks());

describe('sendReportingFailure log', () => {
  it('never writes a recipient address that the transport error carries', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mailer: Mailer = {
      name: 'smtp',
      send: async () => {
        throw new Error('550 5.1.1 <siti@example.test>: Recipient address rejected for siti@example.test');
      },
    };
    const ok = await sendReportingFailure(
      { to: 'siti@example.test', subject: 's', text: 't', html: 'h' },
      { mail: 'campaign_update' },
      mailer,
    );
    expect(ok).toBe(false);
    const line = String(spy.mock.calls[0][0]);
    expect(line).not.toContain('siti@example.test');
    expect(line).toContain('550 5.1.1');
    expect(JSON.parse(line).event).toBe('mail_send_failed');
  });
});
