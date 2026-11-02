import { describe, it, expect } from 'vitest';
import { organisationInvitationEmail } from './organisation-invitation';

describe('organisationInvitationEmail', () => {
  const base = {
    to: 'andi@example.org',
    organisationName: 'Yayasan <Harapan>',
    acceptUrl: 'https://fundforindonesia.org/akun/organisasi/terima?token=abc',
    expiresOn: '9 November 2026',
  };

  it('goes to the invited address and carries the link in both bodies', () => {
    const email = organisationInvitationEmail(base);
    expect(email.to).toBe('andi@example.org');
    expect(email.text).toContain(base.acceptUrl);
    expect(email.html).toContain(base.acceptUrl);
  });

  it('escapes the organisation name in the HTML body', () => {
    const email = organisationInvitationEmail(base);
    expect(email.html).not.toContain('<Harapan>');
    expect(email.html).toContain('Yayasan &lt;Harapan&gt;');
  });

  it('says what a member can and cannot do, and when the link expires', () => {
    const email = organisationInvitationEmail(base);
    expect(email.text).toContain('9 November 2026');
    expect(email.text).toMatch(/tidak dapat mengajukan Payout/);
  });
});
