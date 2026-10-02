import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The public certificate page (ticket 37): no sign-in, shows only the frozen
 * copy, renders it as text, and answers every unknown code the same way.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const lookup = vi.hoisted(() => ({ getCertificateByCode: vi.fn() }));
vi.mock('@/lib/volunteer/certificate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/volunteer/certificate')>()),
  ...lookup,
}));
const auth = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => auth);
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import CertificatePage, * as pageModule from './page';

const CODE = 'abcdefghijklmnopqrstuv';
const params = (code = CODE) => ({ params: Promise.resolve({ code }) });
const cert = (over: Record<string, unknown> = {}) => ({
  code: CODE,
  volunteerName: 'Siti Aminah',
  tripTitle: 'Mengajar di Sumba',
  destination: 'Sumba',
  batchStartDate: new Date('2026-09-15T00:00:00Z'),
  batchEndDate: new Date('2026-09-20T00:00:00Z'),
  organizerName: 'Yayasan Penyelenggara',
  issuedAt: new Date('2026-09-26T10:00:00Z'),
  ...over,
});

afterEach(() => {
  cleanup();
  lookup.getCertificateByCode.mockReset();
  auth.getServerSession.mockReset();
});

describe('/sertifikat/[code]', () => {
  it('is force-dynamic', () => {
    expect(pageModule.dynamic).toBe('force-dynamic');
  });

  it('shows the frozen name, Trip, destination, Batch dates, organizer, code, issue date and issuer', async () => {
    lookup.getCertificateByCode.mockResolvedValue(cert());
    render(await CertificatePage(params()));
    expect(screen.getByText('Siti Aminah')).toBeTruthy();
    expect(screen.getByText("Mengajar di Sumba")).toBeTruthy();
    expect(screen.getByText("Sumba")).toBeTruthy();
    expect(screen.getByText(/15 Sep 2026 - 20 Sep 2026/)).toBeTruthy();
    expect(screen.getByText(/Yayasan Penyelenggara/)).toBeTruthy();
    expect(screen.getByText(CODE)).toBeTruthy();
    expect(screen.getByText(/26 Sep 2026/)).toBeTruthy();
    expect(screen.getByText(/Fund for Indonesia \(PT Jaya Korpora Prima\)/)).toBeTruthy();
  });

  it('never reads the session: it is public', async () => {
    lookup.getCertificateByCode.mockResolvedValue(cert());
    await CertificatePage(params());
    expect(auth.getServerSession).not.toHaveBeenCalled();
  });

  it('renders user-controlled text as text, not markup', async () => {
    lookup.getCertificateByCode.mockResolvedValue(cert({ volunteerName: '<img src=x onerror=alert(1)>' }));
    const { container } = render(await CertificatePage(params()));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('answers 404 for an unknown code, the same as for a malformed one', async () => {
    lookup.getCertificateByCode.mockResolvedValue(null);
    await expect(CertificatePage(params())).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(CertificatePage(params('nope'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is marked noindex so a certificate is not crawled into a search engine', async () => {
    expect(await pageModule.generateMetadata()).toMatchObject({ robots: { index: false } });
  });
});
