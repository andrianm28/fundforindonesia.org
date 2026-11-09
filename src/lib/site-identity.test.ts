import { describe, it, expect } from 'vitest';
import { LEGAL_DOCS_UPDATED, LEGAL_DOCS_VERSION, formatLegalDocsDate } from './site-identity';

describe('versi dokumen hukum', () => {
  it('LEGAL_DOCS_UPDATED selalu turunan dari LEGAL_DOCS_VERSION', () => {
    expect(LEGAL_DOCS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LEGAL_DOCS_UPDATED).toBe(formatLegalDocsDate(LEGAL_DOCS_VERSION));
  });

  it('memformat tanggal Indonesia', () => {
    expect(formatLegalDocsDate('2026-10-16')).toBe('16 Oktober 2026');
    expect(formatLegalDocsDate('2027-01-05')).toBe('5 Januari 2027');
  });
});
