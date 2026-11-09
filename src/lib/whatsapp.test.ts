import { describe, it, expect } from 'vitest';
import { normaliseWhatsapp } from './whatsapp';

describe('normaliseWhatsapp', () => {
  it.each([
    ['0812-3456-7890', '6281234567890'],
    ['+62 812 3456 7890', '6281234567890'],
    ['6281234567890', '6281234567890'],
    ['(0812) 3456 789', '628123456789'],
  ])('menormalkan %s', (input, expected) => {
    expect(normaliseWhatsapp(input)).toEqual({ ok: true, value: expected });
  });

  it('kosong berarti tanpa nomor', () => {
    expect(normaliseWhatsapp('')).toEqual({ ok: true, value: null });
    expect(normaliseWhatsapp('   ')).toEqual({ ok: true, value: null });
    expect(normaliseWhatsapp(null)).toEqual({ ok: true, value: null });
  });

  it.each(['12345', '021-5551234', '+1 415 555 0100', 'abc', '0812345', '08123456789012345', '0812 3456 78x0'])(
    'menolak %s',
    (input) => {
      expect(normaliseWhatsapp(input).ok).toBe(false);
    },
  );
});
