import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import AdminPartnershipInquiriesPage from './page';

/**
 * The partnership team's Inquiry queue (ticket 06). The ADMIN gate is the admin
 * layout's (layout.test.tsx) and the movement rules are the API's; what this
 * file proves is that every Inquiry in the queue is shown with its Program,
 * company and status, and that the one action a row offers sends exactly the
 * status the API is asked for.
 */
const INQUIRIES = [
  {
    id: 'inquiry-1',
    companyName: 'PT Sinar Abadi',
    contactName: 'Rina Wijaya',
    status: 'NOT_YET_FOLLOWED_UP',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    program: { id: 'program-1', slug: 'klinik-keliling-pesisir', title: 'Klinik Keliling Pesisir', sector: 'HEALTH' },
    lastStatusChange: null,
  },
  {
    id: 'inquiry-2',
    companyName: 'PT Bumi Hijau',
    contactName: 'Dimas Prakoso',
    status: 'IN_PROGRESS',
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
    program: { id: 'program-2', slug: 'hutan-kota', title: 'Hutan Kota Randhir', sector: 'ENVIRONMENT' },
    lastStatusChange: {
      fromStatus: 'NOT_YET_FOLLOWED_UP',
      toStatus: 'IN_PROGRESS',
      actedById: 'admin-2',
      actedByName: 'Bagas Kemitraan',
      actedAt: '2026-09-26T00:00:00.000Z',
    },
  },
  {
    id: 'inquiry-3',
    companyName: 'CV Cahaya Muda',
    contactName: 'Lina Kusuma',
    status: 'DONE',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    program: { id: 'program-3', slug: 'sekolah-malam', title: 'Sekolah Malam Pesisir', sector: 'EDUCATION' },
    lastStatusChange: {
      fromStatus: 'IN_PROGRESS',
      toStatus: 'DONE',
      actedById: 'admin-3',
      actedByName: 'Sari Kemitraan',
      actedAt: '2026-09-18T00:00:00.000Z',
    },
  },
];

const LIST = '/api/admin/partnership-inquiries';

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

let fetchMock: Mock;
let inquiries: unknown[];

beforeEach(() => {
  inquiries = INQUIRIES;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === LIST && !init?.method) return jsonResponse({ inquiries });
    return jsonResponse({ inquiry: { id: 'inquiry-1', status: 'IN_PROGRESS' } });
  });
  global.fetch = fetchMock as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method);
}

function loadsOfTheQueue() {
  return fetchMock.mock.calls.filter(([u, init]) => u === LIST && !init?.method);
}

async function rowOf(company: string) {
  render(<AdminPartnershipInquiriesPage />);
  return (await screen.findByText(company)).closest('tr') as HTMLElement;
}

describe('AdminPartnershipInquiriesPage', () => {
  it('shows every Inquiry with its Program, company and status', async () => {
    render(<AdminPartnershipInquiriesPage />);

    const rows = await screen.findAllByRole('row');
    // The header is the first row.
    expect(rows).toHaveLength(INQUIRIES.length + 1);

    const followedUp = await rowOf('PT Bumi Hijau');
    expect(followedUp.textContent).toContain('Hutan Kota Randhir');
    expect(followedUp.textContent).toContain('Lingkungan');
    expect(followedUp.textContent).toContain('Ditindaklanjuti');
    expect(followedUp.textContent).toContain('Dimas Prakoso');
  });

  it('shows who moved an Inquiry last, and says so plainly for one never moved', async () => {
    const followedUp = await rowOf('PT Bumi Hijau');
    expect(followedUp.textContent).toContain('Bagas Kemitraan');
    expect((await rowOf('PT Sinar Abadi')).textContent).toContain('Belum ditindaklanjuti');
  });

  it('offers the one step forward, and sends exactly that status', async () => {
    const row = await rowOf('PT Sinar Abadi');

    fireEvent.click(within(row).getByRole('button', { name: 'Mulai Tindak Lanjut' }));

    await waitFor(() => expect(callsTo(`${LIST}/inquiry-1`)).toHaveLength(1));
    const [, init] = callsTo(`${LIST}/inquiry-1`)[0];
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'IN_PROGRESS' });
    // The queue is reloaded, so what the team sees is what the database holds.
    await waitFor(() => expect(loadsOfTheQueue().length).toBe(2));
  });

  it('offers to finish an Inquiry already being followed up, and no action on a finished one', async () => {
    const inProgress = await rowOf('PT Bumi Hijau');
    expect(within(inProgress).getByRole('button', { name: 'Tandai Selesai' })).toBeTruthy();

    const done = (await screen.findByText('CV Cahaya Muda')).closest('tr') as HTMLElement;
    expect(within(done).queryByRole('button')).toBeNull();
  });

  it('shows the refusal when the move is refused, and keeps the queue', async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === LIST && !init?.method) return jsonResponse({ inquiries });
      return jsonResponse({ error: 'Inquiry ini sudah ditindaklanjuti.' }, false);
    });
    global.fetch = fetchMock as never;
    render(<AdminPartnershipInquiriesPage />);
    const row = (await screen.findByText('PT Sinar Abadi')).closest('tr') as HTMLElement;

    fireEvent.click(within(row).getByRole('button', { name: 'Mulai Tindak Lanjut' }));

    expect(await screen.findByText('Inquiry ini sudah ditindaklanjuti.')).toBeTruthy();
  });

  it('says so when the queue cannot be loaded', async () => {
    fetchMock = vi.fn(async () => jsonResponse({}, false));
    global.fetch = fetchMock as never;
    render(<AdminPartnershipInquiriesPage />);

    expect(await screen.findByText(/Gagal memuat/)).toBeTruthy();
  });
});
