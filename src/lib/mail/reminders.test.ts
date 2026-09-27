import { describe, it, expect } from 'vitest';
import { campaignDeadlineReminderEmail, kindAuthorisationExpiryWarningEmail } from './reminders';

describe('campaignDeadlineReminderEmail', () => {
  const base = {
    to: 'fundraiser@example.test',
    fundraiserName: 'Budi',
    campaignTitle: 'Bantu Sekolah',
    deadline: new Date('2026-10-05T00:00:00.000Z'),
    campaignUrl: 'https://fundforindonesia.org/campaign/bantu-sekolah',
  };

  it('greets the Fundraiser by name and carries the Campaign title, deadline and link', () => {
    const email = campaignDeadlineReminderEmail(base);

    expect(email.to).toBe('fundraiser@example.test');
    expect(email.subject).toContain('Bantu Sekolah');
    expect(email.text).toContain('Budi');
    expect(email.text).toContain('Bantu Sekolah');
    expect(email.text).toContain('05 Okt 2026');
    expect(email.text).toContain(base.campaignUrl);
    expect(email.html).toContain(base.campaignUrl);
  });

  it('escapes HTML in the Campaign title', () => {
    const email = campaignDeadlineReminderEmail({ ...base, campaignTitle: '<b>Sekolah</b>' });

    expect(email.html).not.toContain('<b>Sekolah</b>');
    expect(email.html).toContain('&lt;b&gt;Sekolah&lt;/b&gt;');
  });
});

describe('kindAuthorisationExpiryWarningEmail', () => {
  const base = {
    to: 'org@example.test',
    fundraiserName: 'Siti',
    organisationName: 'Yayasan Contoh',
    kindLabel: 'Zakat',
    validTo: new Date('2026-10-27T00:00:00.000Z'),
  };

  it('names the Partner Organisation, the Kind and the expiry date', () => {
    const email = kindAuthorisationExpiryWarningEmail(base);

    expect(email.to).toBe('org@example.test');
    expect(email.subject).toContain('Yayasan Contoh');
    expect(email.subject).toContain('Zakat');
    expect(email.text).toContain('Siti');
    expect(email.text).toContain('Yayasan Contoh');
    expect(email.text).toContain('Zakat');
    expect(email.text).toContain('27 Okt 2026');
  });
});
