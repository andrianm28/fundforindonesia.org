import { describe, it, expect } from 'vitest';
import { loginCodeEmail } from './login-code';

describe('loginCodeEmail', () => {
  const base = { to: 'sari@example.com', name: 'Sari <b>', code: '042917', ttlMinutes: 10 };

  it('goes to the account address and carries the code in subject and both bodies', () => {
    const email = loginCodeEmail(base);
    expect(email.to).toBe('sari@example.com');
    expect(email.subject).toContain('042917');
    expect(email.text).toContain('042917');
    expect(email.html).toContain('042917');
  });

  it('escapes the typed name in the HTML body', () => {
    const email = loginCodeEmail(base);
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('Sari &lt;b&gt;');
  });

  it('says how long the code lasts and warns not to share it, in Indonesian', () => {
    const email = loginCodeEmail(base);
    expect(email.text).toMatch(/10 menit/);
    expect(email.text).toMatch(/Jangan berikan kode/);
    expect(email.text).toMatch(/abaikan/i);
  });
});
