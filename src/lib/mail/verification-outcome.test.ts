import { describe, it, expect } from 'vitest';
import { verificationOutcomeEmail } from './verification-outcome';

const BASE = {
  to: 'siti@example.test',
  fundraiserName: 'Siti',
  campaignTitle: 'Bantu Korban Banjir',
  campaignUrl: 'https://fundforindonesia.org/campaign/bantu-korban-banjir',
};

describe('verificationOutcomeEmail on approval', () => {
  const email = verificationOutcomeEmail({ ...BASE, outcome: 'approved' });

  it('is addressed to the Fundraiser', () => {
    expect(email.to).toBe('siti@example.test');
  });

  it('says in the subject that the Campaign was diloloskan', () => {
    expect(email.subject).toBe('Campaign "Bantu Korban Banjir" diloloskan');
  });

  it('tells the Fundraiser the Verifier passed it and it now takes donations, with its link', () => {
    for (const body of [email.text, email.html]) {
      expect(body).toContain('Siti');
      expect(body).toContain('diloloskan Verifier');
      expect(body).toContain('menerima donasi');
      expect(body).toContain('https://fundforindonesia.org/campaign/bantu-korban-banjir');
    }
  });

  it('carries no rejection reason', () => {
    expect(email.text).not.toContain('Alasan');
  });
});

describe('verificationOutcomeEmail on rejection', () => {
  const email = verificationOutcomeEmail({
    ...BASE,
    outcome: 'rejected',
    reason: 'Foto KTP penanggung jawab tidak terbaca.',
  });

  it('says in the subject that the Campaign was ditolak', () => {
    expect(email.subject).toBe('Campaign "Bantu Korban Banjir" ditolak');
  });

  it('carries the Verifier\'s reason and invites a resubmission', () => {
    for (const body of [email.text, email.html]) {
      expect(body).toContain('ditolak oleh Verifier');
      expect(body).toContain('Alasan: Foto KTP penanggung jawab tidak terbaca.');
      expect(body).toContain('ajukan kembali');
    }
  });
});

describe('verificationOutcomeEmail HTML', () => {
  it('escapes what a Fundraiser or Verifier typed, so it cannot inject markup', () => {
    const email = verificationOutcomeEmail({
      ...BASE,
      campaignTitle: '<script>alert(1)</script>',
      outcome: 'rejected',
      reason: 'Tautan <a href="x">ini</a> & itu',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('Tautan &lt;a href=&quot;x&quot;&gt;ini&lt;/a&gt; &amp; itu');
  });
});
