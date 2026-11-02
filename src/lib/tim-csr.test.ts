import { describe, it, expect } from 'vitest';
import { emailDomainOf, isFreeMailDomain, companyDomainFor, InvalidCompanyInputError } from './tim-csr';

/**
 * The light verification rule of the Tim CSR account (ticket E9/01, tahap 2,
 * decision 2026-10-04 (b)): a company is identified by the email domain its
 * people prove they own, and a mailbox anyone can open is not a company.
 */
describe('emailDomainOf', () => {
  it('takes the part after the last @, lowercased and trimmed', () => {
    expect(emailDomainOf('  Budi@Acme-Corp.CO.ID ')).toBe('acme-corp.co.id');
  });

  it('is null for something that is not an address', () => {
    expect(emailDomainOf('tanpa-at')).toBeNull();
    expect(emailDomainOf('a@')).toBeNull();
    expect(emailDomainOf('a@b')).toBeNull();
  });
});

describe('isFreeMailDomain', () => {
  it.each([
    'gmail.com',
    'googlemail.com',
    'yahoo.com',
    'yahoo.co.id',
    'ymail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'icloud.com',
    'proton.me',
    'protonmail.com',
    'mail.com',
    'gmx.com',
    'zoho.com',
    'yandex.com',
    'aol.com',
    'web.de',
    'qq.com',
    'naver.com',
    'gmx.de',
    'mailinator.com',
    'guerrillamail.com',
    'sharklasers.com',
    '10minutemail.com',
    'temp-mail.org',
    'yopmail.com',
  ])('refuses %s', (domain) => {
    expect(isFreeMailDomain(domain)).toBe(true);
  });

  it('refuses a free-mail provider in any case', () => {
    expect(isFreeMailDomain('GMAIL.COM')).toBe(true);
  });

  it('accepts a company domain, including one that merely contains a provider name', () => {
    expect(isFreeMailDomain('acme.co.id')).toBe(false);
    expect(isFreeMailDomain('gmail.acme.com')).toBe(false);
    expect(isFreeMailDomain('notgmail.com')).toBe(false);
    expect(isFreeMailDomain('live.acme.co.id')).toBe(false);
  });
});

describe('companyDomainFor', () => {
  it('returns the domain of a company address', () => {
    expect(companyDomainFor('budi@acme.co.id')).toBe('acme.co.id');
  });

  it('refuses a free-mail address as a company address', () => {
    expect(() => companyDomainFor('budi@gmail.com')).toThrow(InvalidCompanyInputError);
  });

  it('refuses a value that has no domain', () => {
    expect(() => companyDomainFor('budi')).toThrow(InvalidCompanyInputError);
  });
});
