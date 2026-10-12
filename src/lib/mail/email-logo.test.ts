import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailLogoHtml } from './email-logo';
import { receiptEmail } from './receipt';
import { passwordResetEmail } from './password-reset';
import { emailVerificationEmail } from './email-verification';
import { campaignTransferEmail } from './campaign-transfer';
import { campaignDeadlineReminderEmail, kindAuthorisationExpiryWarningEmail } from './reminders';
import { verificationOutcomeEmail } from './verification-outcome';
import type { MailMessage } from './types';

afterEach(() => vi.unstubAllEnvs());

describe('emailLogoHtml', () => {
  it('points at the PNG wordmark on the canonical public address', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    expect(emailLogoHtml()).toContain('src="https://fundforindonesia.org/brand/logo-wordmark.png"');
  });

  it('follows NEXT_PUBLIC_BASE_URL and carries alt text', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://beta.example.test/');
    const html = emailLogoHtml();
    expect(html).toContain('src="https://beta.example.test/brand/logo-wordmark.png"');
    expect(html).toContain('alt="Fund for Indonesia"');
  });
});

describe('every email to a Donor or Fundraiser opens with the logo', () => {
  const messages: Array<[string, () => MailMessage]> = [
    ['receipt', () => receiptEmail({ to: 'a@b.test', donorName: 'Sari', campaignTitle: 'C', collectingEntityName: 'Yayasan', amount: 50000, paidAt: new Date('2026-10-05T00:00:00Z'), printUrl: 'https://fundforindonesia.org/receipt/x' })],
    ['password reset', () => passwordResetEmail({ to: 'a@b.test', name: 'Sari', resetUrl: 'https://fundforindonesia.org/reset-password?token=t' })],
    ['email verification', () => emailVerificationEmail({ to: 'a@b.test', name: 'Sari', confirmUrl: 'https://fundforindonesia.org/akun/verifikasi-email?token=t' })],
    ['campaign transfer', () => campaignTransferEmail({ to: 'a@b.test', sourceTitle: 'A', targetTitle: 'B', targetUrl: 'https://fundforindonesia.org/campaign/b', kindLabel: 'Zakat' })],
    ['deadline reminder', () => campaignDeadlineReminderEmail({ to: 'a@b.test', fundraiserName: 'Budi', campaignTitle: 'C', deadline: new Date('2026-10-05T00:00:00Z'), campaignUrl: 'https://fundforindonesia.org/campaign/c' })],
    ['authorisation warning', () => kindAuthorisationExpiryWarningEmail({ to: 'a@b.test', fundraiserName: 'Budi', organisationName: 'Org', kindLabel: 'Wakaf', validTo: new Date('2026-10-05T00:00:00Z') })],
    ['verification outcome', () => verificationOutcomeEmail({ to: 'a@b.test', fundraiserName: 'Siti', campaignTitle: 'C', campaignUrl: 'https://fundforindonesia.org/campaign/c', outcome: 'approved' })],
  ];

  it.each(messages)('%s: logo first in the HTML, none in the text', (_name, build) => {
    const mail = build();
    expect(mail.html.startsWith(emailLogoHtml())).toBe(true);
    expect(mail.text).not.toContain('logo-wordmark');
  });
});
