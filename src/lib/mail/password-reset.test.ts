import { describe, it, expect } from 'vitest';
import { passwordResetEmail } from './password-reset';

describe('passwordResetEmail', () => {
  const base = {
    to: 'sari@example.com',
    name: 'Sari <b>',
    resetUrl: 'https://fundforindonesia.org/reset-password?token=abc.def&x=1',
  };

  it('goes to the account address and carries the reset link in both bodies', () => {
    const email = passwordResetEmail(base);

    expect(email.to).toBe('sari@example.com');
    expect(email.text).toContain(base.resetUrl);
    expect(email.html).toContain('reset-password?token=abc.def&amp;x=1');
  });

  it('escapes the typed name in the HTML body', () => {
    const email = passwordResetEmail(base);

    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('Sari &lt;b&gt;');
  });

  it('says the link lasts 60 minutes and can be ignored, in Indonesian', () => {
    const email = passwordResetEmail(base);

    expect(email.subject).toMatch(/password/i);
    expect(email.text).toMatch(/60 menit/);
    expect(email.text).toMatch(/abaikan/i);
  });
});
