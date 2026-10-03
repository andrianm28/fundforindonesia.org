import { describe, it, expect } from 'vitest';
import { campaignTransferEmail } from './campaign-transfer';

/**
 * The Campaign Transfer email (CONTEXT.md, Campaign Transfer): names the
 * Kind both Campaigns share, so a Hibah Donor is not told about zakat or wakaf.
 */
describe('campaignTransferEmail', () => {
  it.each(['Zakat', 'Wakaf', 'Hibah'])('names the %s Kind and the target Campaign', (kindLabel) => {
    const mail = campaignTransferEmail({
      to: 'donor@example.com',
      sourceTitle: 'Campaign Lama',
      targetTitle: 'Campaign Baru',
      targetUrl: 'https://fundforindonesia.org/campaign/baru',
      kindLabel,
    });

    expect(mail.text).toContain(`dana ${kindLabel}`);
    expect(mail.html).toContain(`dana ${kindLabel}`);
    expect(mail.text).toContain('Campaign "Campaign Baru"');
    expect(mail.text).toContain('https://fundforindonesia.org/campaign/baru');
  });
});
