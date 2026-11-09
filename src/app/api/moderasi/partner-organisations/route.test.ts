import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { makeCampaignDb } from '../../../../../tests/support/in-memory-campaign-db';

/**
 * The Verifier's Partner Organisation register, through the real handler and
 * module with the session and database stood in. The rules are the module's
 * (src/lib/partner-organisations.test.ts); this proves the VERIFIER gate and
 * that refusals answer with their code.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { GET, POST } from './route';
import { PATCH } from './[id]/route';
import { sealResponsiblePersonPhone, sealUserEmail } from '@/lib/contact-fields';
import { partnerOrganisationRow } from '../../../../../tests/support/in-memory-campaign-db';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const URL = 'http://localhost:3000/api/moderasi/partner-organisations';
const BODY = {
  name: 'Yayasan Indonesia Emas Merdeka',
  fundraiserEmail: 'yiem@example.org',
  acceptsIndividualCampaigns: true,
  address: 'Jl. Merdeka No. 17, Garut, Jawa Barat',
  responsiblePersonName: 'Siti Rahma',
  responsiblePersonTitle: 'Ketua Pengurus',
  responsiblePersonPhone: '081234567890',
};

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/moderasi/partner-organisations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      partnerOrganisations: [],
      // Sealed, as a row holds an address (ADR 0012): the Verifier's typed
      // address is matched against the lookup HMAC.
      users: [{ id: 'yiem-account', name: 'YIEM', ...sealUserEmail('yiem@example.org') }],
    });
    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
  });

  it('registers the organisation as the acting Verifier, answering 201', async () => {
    const res = await post(BODY);

    expect(res.status).toBe(201);
    expect((await res.json()).organisation).toMatchObject({ name: BODY.name, fundraiserId: 'yiem-account' });
    expect(state.db.partnerOrganisationAudits).toEqual([
      expect.objectContaining({ action: 'REGISTERED', actedById: 'verifier-1' }),
    ]);
  });

  it('saves the address and the person responsible, and answers the Verifier without the sealed phone columns (PKS 3.2)', async () => {
    const res = await post(BODY);

    expect(res.status).toBe(201);
    const { organisation } = await res.json();
    expect(organisation).toMatchObject({
      address: BODY.address,
      responsiblePersonName: 'Siti Rahma',
      responsiblePersonTitle: 'Ketua Pengurus',
    });
    expect(JSON.stringify(organisation)).not.toMatch(/Ciphertext|KeyId/);
    expect(organisation.responsiblePersonPhone).toBe('081234567890');
    expect(state.db.partnerOrganisations[0]).toMatchObject({ address: BODY.address, responsiblePersonName: 'Siti Rahma' });
    expect(JSON.stringify(state.db.partnerOrganisations[0])).not.toContain('081234567890');
  });

  it('refuses a registration without the person responsible with 400', async () => {
    const res = await post({ ...BODY, responsiblePersonName: undefined });

    expect(res.status).toBe(400);
    expect(state.db.partnerOrganisations).toEqual([]);
  });

  it('answers a refusal with its status and code', async () => {
    const res = await post({ ...BODY, fundraiserEmail: 'nobody@example.org' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Tidak ada akun dengan email itu.', code: 'PARTNER_ORGANISATION_INVALID' });
  });

  it.each([
    ['an Admin who is not a Verifier', { user: { id: 'admin-1', assignments: ['ADMIN'] } }, 404],
    ['nobody signed in', null, 401],
  ])('refuses %s, writing nothing', async (_who, session, status) => {
    mockSession.mockResolvedValue(session);

    const res = await post(BODY);

    expect(res.status).toBe(status);
    expect(state.db.partnerOrganisations).toEqual([]);
  });
});

describe('what the register answers the Verifier with (ADR 0012)', () => {
  const sealed = () => ({
    address: 'Jl. Merdeka No. 17',
    responsiblePersonName: 'Siti Rahma',
    responsiblePersonTitle: 'Ketua Pengurus',
    ...sealResponsiblePersonPhone('081234567890'),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      partnerOrganisations: [partnerOrganisationRow(sealed())],
      users: [{ id: 'partner-fundraiser-1', name: 'YIEM', ...sealUserEmail('yiem@example.org') }],
    });
    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
  });

  it('lists every organisation with the phone decrypted and no ciphertext or key id', async () => {
    // The stand-in does not resolve `include`; hand back the row as the real
    // query would, with its linked account.
    const stored = state.db.partnerOrganisations[0];
    vi.spyOn(state.db.prisma.partnerOrganisation, 'findMany').mockResolvedValue([
      {
        ...stored,
        fundraiser: { name: 'YIEM', ...sealUserEmail('yiem@example.org') },
        permits: [],
        kindAuthorisations: [],
        documents: [],
      },
    ] as never);

    const res = await GET(new NextRequest(URL));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organisations[0]).toMatchObject({ responsiblePersonPhone: '081234567890' });
    expect(JSON.stringify(body)).not.toMatch(/Ciphertext|KeyId/);
  });

  it('answers a PATCH with the phone decrypted and no ciphertext or key id', async () => {
    const res = await PATCH(
      new NextRequest(`${URL}/partner-1`, { method: 'PATCH', body: JSON.stringify({ responsiblePersonPhone: '081999999999' }) }),
      { params: Promise.resolve({ id: 'partner-1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organisation).toMatchObject({ responsiblePersonPhone: '081999999999' });
    expect(JSON.stringify(body)).not.toMatch(/Ciphertext|KeyId/);
  });
});
