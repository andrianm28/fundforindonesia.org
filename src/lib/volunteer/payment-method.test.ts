import { describe, it, expect } from 'vitest';
import { PROVIDER_METHOD_FOR, registrationMethodFor } from './payment-method';

describe('registrationMethodFor', () => {
  it('maps every provider method back to the Registration method that charges through it', () => {
    expect(registrationMethodFor('bank_transfer_va')).toBe('bank_transfer');
    expect(registrationMethodFor('qris_redirect')).toBe('qris');
    for (const [method, providerMethod] of Object.entries(PROVIDER_METHOD_FOR)) {
      expect(PROVIDER_METHOD_FOR[registrationMethodFor(providerMethod)]).toBe(providerMethod);
      expect(method).toBe(registrationMethodFor(providerMethod));
    }
  });

  it('throws for a provider method it does not know instead of falling back to qris', () => {
    expect(() => registrationMethodFor('cash' as never)).toThrow('tidak dikenal');
  });
});
