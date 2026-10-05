import { describe, it, expect } from 'vitest';
import { RESET_REQUESTED_MESSAGE } from './password-reset-copy';

describe('password reset copy', () => {
  it('speaks to the person as "kamu", like the other (auth) pages, and names the 60 minute limit', () => {
    expect(RESET_REQUESTED_MESSAGE).toMatch(/kamu/);
    expect(RESET_REQUESTED_MESSAGE).not.toMatch(/\bAnda\b/);
    expect(RESET_REQUESTED_MESSAGE).toMatch(/60 menit/);
  });
});
