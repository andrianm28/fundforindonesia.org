import { describe, it, expect } from 'vitest';
import { emailVerificationEmail } from './email-verification';

describe('emailVerificationEmail', () => {
  const base = {
    to: 'sari@example.com',
    name: 'Sari <b>',
    confirmUrl: 'https://fundforindonesia.org/akun/verifikasi-email?token=abc',
  };

  it('goes to the account address and carries the confirmation link in both bodies', () => {
    const email = emailVerificationEmail(base);

    expect(email.to).toBe('sari@example.com');
    expect(email.text).toContain(base.confirmUrl);
    expect(email.html).toContain(base.confirmUrl);
  });

  it('escapes the typed name in the HTML body', () => {
    const email = emailVerificationEmail(base);

    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('Sari &lt;b&gt;');
  });
});
