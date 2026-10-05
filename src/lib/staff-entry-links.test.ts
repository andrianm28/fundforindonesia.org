import { describe, it, expect } from 'vitest';
import { Assignment } from '@/generated/prisma/client';
import { staffEntryLinks } from './staff-entry-links';

describe('staffEntryLinks (ticket 86)', () => {
  it('gives an Admin a link to /admin only', () => {
    expect(staffEntryLinks([Assignment.ADMIN])).toEqual([{ href: '/admin', label: 'Admin' }]);
  });

  it('gives a Verifier a link to /moderasi only', () => {
    expect(staffEntryLinks([Assignment.VERIFIER])).toEqual([{ href: '/moderasi', label: 'Moderasi' }]);
  });

  it('gives a person holding both assignments both links (one navigation, ADR 0005)', () => {
    const hrefs = staffEntryLinks([Assignment.VERIFIER, Assignment.ADMIN]).map((l) => l.href);
    expect(hrefs).toEqual(['/admin', '/moderasi']);
  });

  it('gives nothing to someone holding no assignment, nor to a missing list', () => {
    expect(staffEntryLinks([])).toEqual([]);
    expect(staffEntryLinks(undefined)).toEqual([]);
  });
});
