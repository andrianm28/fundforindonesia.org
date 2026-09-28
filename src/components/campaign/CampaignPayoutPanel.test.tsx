import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CampaignPayoutPanel } from './CampaignPayoutPanel';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function ok(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

function refused(status: number, body: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const READ = {
  isDemo: false,
  lifecycleStatus: 'ACTIVE' as const,
  escrowHold: 120_000,
  campaignBalance: 800_000,
  payouts: [],
  bankAccounts: [{ id: 'bank-1', bankCode: 'BCA', accountName: 'Creator One' }],
  hasUnverifiedBankAccount: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe('CampaignPayoutPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows the Fundraiser what is held and what they can actually withdraw, as two separate figures', async () => {
    mockFetch.mockImplementation((url: string) =>
      url.includes('/payouts') && !url.includes('POST') ? ok(READ) : refused(500, {}),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    // Two different numbers, labelled as the two different things they are.
    // A Fundraiser who cannot tell "held, on schedule" from "lost" will
    // reasonably conclude the money is gone (ledger.ts, on escrowBalance).
    expect(await screen.findByText('Rp120.000')).toBeInTheDocument();
    expect(screen.getByText('Rp800.000')).toBeInTheDocument();
    expect(screen.getByText(/Belum bisa dicairkan/)).toBeInTheDocument();
    expect(screen.getByText(/Bisa dicairkan/)).toBeInTheDocument();
  });

  it('lets the Fundraiser request part of their balance while the Campaign is still Active', async () => {
    // Records the arguments too, so the assertion below is about what the
    // panel actually sent rather than only that it sent something.
    const post = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return ok({ id: 'payout-9', status: 'DRAFT' });
    });
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST' ? post(url, init) : ok(READ),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    const amount = await screen.findByLabelText(/Jumlah pencairan/);
    // A partial amount, not the whole balance: FFI-07 allows a Payout of part
    // of the Campaign Balance while the Campaign is Active, and the panel
    // must not require the Campaign to be finished first. A destination is
    // always part of a request -- money only goes to a verified account.
    fireEvent.change(screen.getByLabelText('Rekening tujuan'), { target: { value: 'bank-1' } });
    fireEvent.change(amount, { target: { value: '300000' } });
    fireEvent.change(screen.getByLabelText(/Keterangan/), { target: { value: 'Bahan bangunan' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajukan pencairan/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = JSON.parse((post.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ bankAccountId: 'bank-1', amount: 300_000, description: 'Bahan bangunan' });
  });

  it('shows every Payout on the Campaign in the state it is actually in, so the Fundraiser is not left guessing', async () => {
    mockFetch.mockImplementation(() =>
      ok({
        ...READ,
        payouts: [
          {
            id: 'payout-3',
            amount: 50_000,
            description: 'Transport material',
            // A request nobody has acted on yet: the state a Fundraiser spends
            // the most time in, and the one most likely to be rendered as an
            // unexplained "pending" if the panel is careless.
            status: 'DRAFT',
            createdAt: '2026-09-25T00:00:00.000Z',
            approvedAt: null,
            completedAt: null,
          },
          {
            id: 'payout-2',
            amount: 200_000,
            description: 'Bahan bangunan',
            status: 'APPROVED',
            createdAt: '2026-09-20T00:00:00.000Z',
            approvedAt: '2026-09-21T00:00:00.000Z',
            completedAt: null,
          },
          {
            id: 'payout-1',
            amount: 100_000,
            description: 'Upah pekerja',
            status: 'COMPLETED',
            createdAt: '2026-09-01T00:00:00.000Z',
            approvedAt: '2026-09-02T00:00:00.000Z',
            completedAt: '2026-09-03T00:00:00.000Z',
          },
        ],
      }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    // FFI-07 requires the status to be visible throughout, and these are two
    // genuinely different facts: money committed but not sent, and money gone.
    expect(await screen.findByText('Menunggu persetujuan Admin')).toBeInTheDocument();
    expect(screen.getByText('Disetujui, menunggu dana dikirim')).toBeInTheDocument();
    expect(screen.getByText('Selesai')).toBeInTheDocument();
    expect(screen.getByText(/Bahan bangunan/)).toBeInTheDocument();
  });

  it('shows the server own refusal when a request is turned down, rather than a generic failure', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? refused(409, {
            error: 'Payout tidak dapat diajukan atau disetujui karena status Campaign tidak mengizinkannya.',
            code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS',
          })
        : ok(READ),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    fireEvent.change(await screen.findByLabelText('Rekening tujuan'), { target: { value: 'bank-1' } });
    fireEvent.change(screen.getByLabelText(/Jumlah pencairan/), { target: { value: '300000' } });
    fireEvent.change(screen.getByLabelText(/Keterangan/), { target: { value: 'Bahan bangunan' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajukan pencairan/ }));

    // The reason a Payout can be refused is frequently one this panel cannot
    // see -- a Suspension that landed since the page loaded, a balance
    // another Admin already spent -- so the server's own words are shown.
    expect(await screen.findByRole('alert')).toHaveTextContent('status Campaign tidak mengizinkannya');
  });

  it('refuses to submit an amount larger than the Campaign Balance, in the browser as well as on the server', async () => {
    const post = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return ok({});
    });
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST' ? post(url, init) : ok(READ),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    fireEvent.change(await screen.findByLabelText('Rekening tujuan'), { target: { value: 'bank-1' } });
    fireEvent.change(screen.getByLabelText(/Jumlah pencairan/), { target: { value: '9000000' } });
    fireEvent.change(screen.getByLabelText(/Keterangan/), { target: { value: 'Terlalu banyak' } });

    // The balance on screen is 800.000. Offering to send 9.000.000 -- the
    // lifetime-raised figure, which is what a naive panel would show -- is
    // the mistake this guards.
    expect(screen.getByRole('alert')).toHaveTextContent('melebihi Campaign Balance');
    expect(screen.getByRole('button', { name: /Ajukan pencairan/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('never shows a Fundraiser a raw enum for a Payout status, whatever the row says', async () => {
    mockFetch.mockImplementation(() =>
      ok({
        ...READ,
        payouts: [
          {
            id: 'payout-4',
            amount: 10_000,
            description: 'Statuses this repo does not write yet',
            // Nothing in src/ writes SUBMITTED, PROCESSING, REJECTED or FAILED
            // today (payouts.ts). A row can still carry one -- a status
            // added later, a row written outside the app -- and a fallback of
            // `?? status` would then put the English enum in front of a
            // Fundraiser reading their own money, in a panel whose other
            // labels are all Indonesian.
            status: 'SUBMITTED',
            createdAt: '2026-09-26T00:00:00.000Z',
            approvedAt: null,
            completedAt: null,
          },
        ],
      }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    expect(await screen.findByText('Diajukan, menunggu ditinjau')).toBeInTheDocument();
    expect(screen.queryByText('SUBMITTED')).toBeNull();
  });

  it('offers no way to ask for money from a Campaign that cannot pay out, however the Fundraiser arrived', async () => {
    const post = vi.fn();
    // Enough balance and a verified account, so the ONLY thing standing
    // between this Fundraiser and a submittable form is the Campaign's status.
    // A URL typed by hand reaches this page with the same read as the link.
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? post() : ok({ ...READ, lifecycleStatus: 'SUSPENDED' }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    // FFI-07: Suspended and Cancelled refuse a Payout, and a Suspension
    // falling between the request and the approval refuses it too. The
    // server refuses under the subject lock regardless; what this pins is
    // that the screen does not collect a request it knows is impossible, and
    // says which status is the reason.
    expect(
      await screen.findByText('Campaign ini berstatus Suspended, jadi pencairan tidak bisa diajukan.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajukan pencairan/ })).toBeNull();
    expect(screen.queryByLabelText(/Jumlah pencairan/)).toBeNull();
    expect(screen.queryByLabelText('Rekening tujuan')).toBeNull();
    // And the balance is still shown: it is the Fundraiser's money and they
    // are owed the truth about it, whatever they may do with it today.
    expect(screen.getByText('Rp800.000')).toBeInTheDocument();
  });

  it('offers the form for exactly Active, Expired and Completed, and withholds it for every other status', async () => {
    // The two lists below ARE a third copy of PAYOUT_REQUESTABLE_STATUSES, and
    // they stay one on purpose: this file is where someone changing that list
    // has to look, because it is the one place the panel's own verdict is
    // written out per status. A test that asked the module instead -- as the
    // panel and requirePayoutAllowed already do -- could not tell a panel that
    // drifted from one that did not.
    for (const status of ['SUSPENDED', 'CANCELLED', 'DRAFT', 'SUBMITTED', 'REJECTED'] as const) {
      mockFetch.mockImplementation(() => ok({ ...READ, lifecycleStatus: status }));
      const { unmount } = render(<CampaignPayoutPanel slug="sumur-desa" />);
      await screen.findByText(/pencairan tidak bisa diajukan/);
      expect(screen.queryByRole('button', { name: /Ajukan pencairan/ })).toBeNull();
      unmount();
    }

    for (const status of ['ACTIVE', 'EXPIRED', 'COMPLETED'] as const) {
      mockFetch.mockImplementation(() => ok({ ...READ, lifecycleStatus: status }));
      const { unmount } = render(<CampaignPayoutPanel slug="sumur-desa" />);
      // Offered, not merely enabled: the form is what the Fundraiser fills in,
      // and the button inside it is disabled until it is full.
      expect(await screen.findByLabelText(/Jumlah pencairan/)).toBeInTheDocument();
      expect(screen.getByLabelText('Rekening tujuan')).toBeInTheDocument();
      unmount();
    }
  });

  it('offers no way to withdraw a Program Balance, because a Program is not a Campaign', async () => {
    mockFetch.mockImplementation(() => ok(READ));

    const { container } = render(<CampaignPayoutPanel slug="sumur-desa" />);
    await screen.findByText('Rp800.000');

    // FFI-09 / CONTEXT.md, Program Balance: CSR money on a Program is never
    // withdrawable by anyone, and Payout has no Program column at all. The
    // panel is scoped to one Campaign's slug, and nothing it renders may
    // suggest a Program's money could be cashed.
    expect(container.textContent).not.toMatch(/program/i);
    expect(screen.queryByText(/Program Balance/)).toBeNull();
    // Nor any second, differently-scoped balance that could be mistaken for
    // one: exactly the two ledger figures and nothing else.
    expect(screen.getAllByText(/Bisa dicairkan/)).toHaveLength(1);
  });

  it('shows a Demo Campaign as having no real money, not as a zero balance', async () => {
    mockFetch.mockImplementation(() => ok({ ...READ, isDemo: true, campaignBalance: 0, escrowHold: 0 }));

    render(<CampaignPayoutPanel slug="demo-campaign" />);

    expect(await screen.findByText(/Campaign contoh/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajukan pencairan/ })).toBeNull();
  });

  // Ticket 17: an empty picker used to be a dead end for everyone, whatever
  // the reason. Both branches below must still leave a Fundraiser somewhere
  // to go -- a link to /akun/rekening -- and must say different things,
  // because "you have never done this" and "you did this and it did not
  // work" are not the same fact.
  it('tells a Fundraiser who never added a Bank Account to go add one, and links them there', async () => {
    mockFetch.mockImplementation(() =>
      ok({ ...READ, bankAccounts: [], hasUnverifiedBankAccount: false }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    expect(
      await screen.findByText(/belum ada rekening terverifikasi atas nama Anda/),
    ).toBeInTheDocument();
    // Not the other sentence: this Fundraiser never submitted anything, so a
    // sentence about a submission that failed would tell them something that
    // did not happen.
    expect(screen.queryByText(/sudah pernah mengajukan/)).toBeNull();
    const link = screen.getByRole('link', { name: /Tambah rekening bank/ });
    expect(link).toHaveAttribute('href', '/akun/rekening');
  });

  it('offers to submit a Usage Report on a COMPLETED Payout that has none yet, and posts it (ticket 22)', async () => {
    const post = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return ok({ id: 'ur-1' });
    });
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? post(url, init)
        : ok({
            ...READ,
            payouts: [
              {
                id: 'payout-1',
                amount: 100_000,
                description: 'Upah pekerja',
                status: 'COMPLETED',
                createdAt: '2026-09-01T00:00:00.000Z',
                approvedAt: '2026-09-02T00:00:00.000Z',
                completedAt: '2026-09-03T00:00:00.000Z',
                usageReportStatus: 'missing',
              },
            ],
          }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    fireEvent.click(await screen.findByRole('button', { name: /Kirim Usage Report/ }));
    fireEvent.change(screen.getByLabelText(/Narasi/), { target: { value: 'Dana dipakai untuk upah pekerja.' } });
    fireEvent.change(screen.getByLabelText(/Nama pos/), { target: { value: 'Upah' } });
    fireEvent.change(screen.getByLabelText(/Nominal pos/), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/Jumlah penerima manfaat/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/URL foto bukti/), { target: { value: 'https://example.com/bukti.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: /^Kirim$/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, init] = post.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/payouts/payout-1/usage-report');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      narrative: 'Dana dipakai untuk upah pekerja.',
      lineItems: [{ label: 'Upah', amount: 100_000 }],
      beneficiaryCount: 10,
      photos: ['https://example.com/bukti.jpg'],
    });
  });

  function completedPayoutRead() {
    return {
      ...READ,
      payouts: [
        {
          id: 'payout-1',
          amount: 300_000,
          description: 'Upah pekerja',
          status: 'COMPLETED',
          createdAt: '2026-09-01T00:00:00.000Z',
          approvedAt: '2026-09-02T00:00:00.000Z',
          completedAt: '2026-09-03T00:00:00.000Z',
          usageReportStatus: 'missing',
        },
      ],
    };
  }

  it('adds another line item row, and keeps submit disabled while the running total does not match the Payout amount', async () => {
    mockFetch.mockImplementation(() => ok(completedPayoutRead()));

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    fireEvent.click(await screen.findByRole('button', { name: /Kirim Usage Report/ }));
    fireEvent.change(screen.getByLabelText(/Narasi/), { target: { value: 'Dana dipakai untuk upah dan bahan.' } });
    fireEvent.change(screen.getByLabelText(/Nama pos 1/), { target: { value: 'Upah' } });
    fireEvent.change(screen.getByLabelText(/Nominal pos \(Rp\) 1/), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/Jumlah penerima manfaat/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/URL foto bukti/), { target: { value: 'https://example.com/bukti.jpg' } });

    // Only one row (Rp100.000) against a Rp300.000 Payout -- the running
    // total does not match, so submit stays disabled.
    expect(screen.getByRole('button', { name: /^Kirim$/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Tambah pos/ }));
    expect(screen.getByLabelText(/Nama pos 2/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Nama pos 2/), { target: { value: 'Bahan' } });
    fireEvent.change(screen.getByLabelText(/Nominal pos \(Rp\) 2/), { target: { value: '200000' } });

    expect(screen.getByRole('button', { name: /^Kirim$/ })).not.toBeDisabled();
  });

  it('posts every line item row in the body', async () => {
    const post = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return ok({ id: 'ur-1' });
    });
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST' ? post(url, init) : ok(completedPayoutRead()),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    fireEvent.click(await screen.findByRole('button', { name: /Kirim Usage Report/ }));
    fireEvent.change(screen.getByLabelText(/Narasi/), { target: { value: 'Dana dipakai untuk upah dan bahan.' } });
    fireEvent.change(screen.getByLabelText(/Nama pos 1/), { target: { value: 'Upah' } });
    fireEvent.change(screen.getByLabelText(/Nominal pos \(Rp\) 1/), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /Tambah pos/ }));
    fireEvent.change(screen.getByLabelText(/Nama pos 2/), { target: { value: 'Bahan' } });
    fireEvent.change(screen.getByLabelText(/Nominal pos \(Rp\) 2/), { target: { value: '200000' } });
    fireEvent.change(screen.getByLabelText(/Jumlah penerima manfaat/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/URL foto bukti/), { target: { value: 'https://example.com/bukti.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: /^Kirim$/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, init] = post.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.lineItems).toEqual([
      { label: 'Upah', amount: 100_000 },
      { label: 'Bahan', amount: 200_000 },
    ]);
  });

  it('says a Usage Report was already sent for a COMPLETED Payout, without offering the form again', async () => {
    mockFetch.mockImplementation(() =>
      ok({
        ...READ,
        payouts: [
          {
            id: 'payout-1',
            amount: 100_000,
            description: 'Upah pekerja',
            status: 'COMPLETED',
            createdAt: '2026-09-01T00:00:00.000Z',
            approvedAt: '2026-09-02T00:00:00.000Z',
            completedAt: '2026-09-03T00:00:00.000Z',
            usageReportStatus: 'submitted',
          },
        ],
      }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    expect(await screen.findByText(/Usage Report sudah dikirim/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kirim Usage Report/ })).toBeNull();
  });

  it('tells the Fundraiser their Usage Report was marked dipertanyakan, without offering to send another', async () => {
    mockFetch.mockImplementation(() =>
      ok({
        ...READ,
        payouts: [
          {
            id: 'payout-1',
            amount: 100_000,
            description: 'Upah pekerja',
            status: 'COMPLETED',
            createdAt: '2026-09-01T00:00:00.000Z',
            approvedAt: '2026-09-02T00:00:00.000Z',
            completedAt: '2026-09-03T00:00:00.000Z',
            usageReportStatus: 'disputed',
          },
        ],
      }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    expect(await screen.findByText(/dipertanyakan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kirim Usage Report/ })).toBeNull();
  });

  it('shows WHEN a still-DRAFT Payout was checked short of the provider balance, never the provider or the figure (ticket 30)', async () => {
    mockFetch.mockImplementation(() =>
      ok({
        ...READ,
        payouts: [
          {
            id: 'payout-1',
            amount: 100_000,
            description: 'Upah pekerja',
            status: 'DRAFT',
            createdAt: '2026-09-01T00:00:00.000Z',
            approvedAt: null,
            completedAt: null,
            usageReportStatus: null,
            shortCheckedAt: '2026-09-05T00:00:00.000Z',
          },
        ],
      }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    expect(await screen.findByText(/Menunggu saldo penyedia, dicek/)).toBeInTheDocument();
    expect(screen.queryByText(/sumopod/i)).toBeNull();
  });

  it('says nothing extra for a DRAFT Payout that has never been checked', async () => {
    mockFetch.mockImplementation(() =>
      ok({
        ...READ,
        payouts: [
          {
            id: 'payout-1',
            amount: 100_000,
            description: 'Upah pekerja',
            status: 'DRAFT',
            createdAt: '2026-09-01T00:00:00.000Z',
            approvedAt: null,
            completedAt: null,
            usageReportStatus: null,
            shortCheckedAt: null,
          },
        ],
      }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    expect(await screen.findByText('Upah pekerja - diajukan 1 September 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Menunggu saldo penyedia/)).toBeNull();
  });

  it('tells a Fundraiser with a submitted-but-unverified account to check its status, and links them there', async () => {
    mockFetch.mockImplementation(() =>
      ok({ ...READ, bankAccounts: [], hasUnverifiedBankAccount: true }),
    );

    render(<CampaignPayoutPanel slug="sumur-desa" />);

    expect(await screen.findByText(/sudah pernah mengajukan/)).toBeInTheDocument();
    // Not the other sentence: telling this Fundraiser "belum ada rekening
    // terverifikasi atas nama Anda" and nothing else would read as though
    // they had never tried, when a Verifier already looked at what they sent.
    expect(screen.queryByText(/belum ada rekening terverifikasi atas nama Anda/)).toBeNull();
    const link = screen.getByRole('link', { name: /Lihat status rekening/ });
    expect(link).toHaveAttribute('href', '/akun/rekening');
  });
});
