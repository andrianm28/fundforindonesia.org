import { describe, it, expect } from 'vitest';
import {
  FundraiserAlreadyLinkedError,
  FundraisingPermitNotFoundError,
  grantKindAuthorisation,
  InvalidPartnerOrganisationError,
  KindAuthorisationNotFoundError,
  OwnPartnerOrganisationError,
  PartnerOrganisationNotFoundError,
  recordFundraisingPermit,
  registerPartnerOrganisation,
  sponsorOptionsFor,
  updateFundraisingPermit,
  updateKindAuthorisation,
  updatePartnerOrganisation,
} from './partner-organisations';
import { domainErrorToHttp } from './domain-errors';
import { sealUserEmail } from './contact-fields';
import {
  fundraisingPermitRow,
  kindAuthorisationRow,
  makeCampaignDb,
  partnerOrganisationRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * A Verifier registers a Partner Organisation after checking its legal
 * documents, linked to the one Fundraiser account that acts for it, and
 * records its Fundraising Permits (prd-compliance 10; CONTEXT.md, Partner
 * Organisation, Fundraising Permit). Every registration and change is
 * audited with who and when, before and after.
 */
const NOW = new Date('2026-09-26T10:00:00Z');
// Sealed addresses (ADR 0012): the Verifier's typed address is matched against
// the lookup HMAC, and a double holding plaintext would test nothing.
const USERS = [
  { id: 'yiem-account', name: 'YIEM', ...sealUserEmail('yiem@example.org') },
  { id: 'verifier-1', name: 'Verifier', ...sealUserEmail('verifier@example.org') },
];

function db(seed: Parameters<typeof makeCampaignDb>[0] = {}) {
  return makeCampaignDb({ partnerOrganisations: [], fundraisingPermits: [], users: USERS, ...seed });
}

describe('registerPartnerOrganisation', () => {
  it('registers the organisation linked to the account with that email, and audits it', async () => {
    const store = db();

    const organisation = await registerPartnerOrganisation(store.prisma as never, {
      actorId: 'verifier-1',
      name: '  Yayasan Indonesia Emas Merdeka ',
      fundraiserEmail: ' yiem@example.org ',
      acceptsIndividualCampaigns: true,
      now: NOW,
    });

    expect(store.partnerOrganisations).toEqual([
      {
        id: organisation.id,
        name: 'Yayasan Indonesia Emas Merdeka',
        fundraiserId: 'yiem-account',
        acceptsIndividualCampaigns: true,
        registeredById: 'verifier-1',
        registeredAt: NOW,
      },
    ]);
    expect(store.partnerOrganisationAudits).toEqual([
      expect.objectContaining({
        partnerOrganisationId: organisation.id,
        permitId: null,
        action: 'REGISTERED',
        before: null,
        after: { name: 'Yayasan Indonesia Emas Merdeka', fundraiserId: 'yiem-account', acceptsIndividualCampaigns: true },
        actedById: 'verifier-1',
        actedAt: NOW,
      }),
    ]);
  });

  it.each([
    ['a blank name', { name: ' ' }],
    ['an email no account has', { fundraiserEmail: 'nobody@example.org' }],
    ['a non-boolean acceptsIndividualCampaigns', { acceptsIndividualCampaigns: 'ya' }],
  ])('refuses %s with 400, writing nothing', async (_what, override) => {
    const store = db();

    const error = await registerPartnerOrganisation(store.prisma as never, {
      actorId: 'verifier-1',
      name: 'YIEM',
      fundraiserEmail: 'yiem@example.org',
      acceptsIndividualCampaigns: false,
      now: NOW,
      ...override,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidPartnerOrganisationError);
    expect(domainErrorToHttp(error)?.status).toBe(400);
    expect(store.partnerOrganisations).toEqual([]);
    expect(store.partnerOrganisationAudits).toEqual([]);
  });

  it('refuses an account that already acts for another organisation with 409', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow({ fundraiserId: 'yiem-account' })] });

    const error = await registerPartnerOrganisation(store.prisma as never, {
      actorId: 'verifier-1',
      name: 'Yayasan Kedua',
      fundraiserEmail: 'yiem@example.org',
      acceptsIndividualCampaigns: false,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FundraiserAlreadyLinkedError);
    expect(domainErrorToHttp(error)?.status).toBe(409);
    expect(store.partnerOrganisations).toHaveLength(1);
  });

  it('refuses a Verifier linking their own account with 403', async () => {
    const store = db();

    const error = await registerPartnerOrganisation(store.prisma as never, {
      actorId: 'verifier-1',
      name: 'Yayasan Sendiri',
      fundraiserEmail: 'verifier@example.org',
      acceptsIndividualCampaigns: false,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OwnPartnerOrganisationError);
    expect(domainErrorToHttp(error)?.status).toBe(403);
    expect(store.partnerOrganisations).toEqual([]);
  });
});

describe('updatePartnerOrganisation', () => {
  it('changes whether it accepts individual Campaigns, auditing before and after', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow({ acceptsIndividualCampaigns: true })] });

    await updatePartnerOrganisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      changes: { acceptsIndividualCampaigns: false },
      now: NOW,
    });

    expect(store.partnerOrganisations[0].acceptsIndividualCampaigns).toBe(false);
    expect(store.partnerOrganisationAudits).toEqual([
      expect.objectContaining({
        action: 'UPDATED',
        before: { name: 'Yayasan Contoh Peduli', fundraiserId: 'partner-fundraiser-1', acceptsIndividualCampaigns: true },
        after: { name: 'Yayasan Contoh Peduli', fundraiserId: 'partner-fundraiser-1', acceptsIndividualCampaigns: false },
        actedById: 'verifier-2',
        actedAt: NOW,
      }),
    ]);
  });

  it('writes no audit entry for a change that leaves it as it was', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow()] });

    await updatePartnerOrganisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      changes: { name: 'Yayasan Contoh Peduli' },
      now: NOW,
    });

    expect(store.partnerOrganisationAudits).toEqual([]);
  });

  it('answers 404 for an unknown organisation', async () => {
    const error = await updatePartnerOrganisation(db().prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'missing',
      changes: { name: 'X' },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PartnerOrganisationNotFoundError);
    expect(domainErrorToHttp(error)?.status).toBe(404);
  });

  it('refuses the organisation\'s own linked account acting as Verifier on it', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow({ fundraiserId: 'verifier-2' })] });

    const error = await updatePartnerOrganisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      changes: { acceptsIndividualCampaigns: false },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OwnPartnerOrganisationError);
  });
});

describe('recordFundraisingPermit', () => {
  const PERMIT = {
    number: ' 123/PUB/2026 ',
    issuer: 'Kementerian Sosial',
    kinds: ['DONATION', 'ZAKAT'],
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2026-12-31T16:59:59.999Z',
  };

  it('records a dated permit for the Kinds it covers, and audits it', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow()] });

    const permit = await recordFundraisingPermit(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      ...PERMIT,
      now: NOW,
    });

    expect(store.fundraisingPermits).toEqual([
      {
        id: permit.id,
        partnerOrganisationId: 'partner-1',
        number: '123/PUB/2026',
        issuer: 'Kementerian Sosial',
        kinds: ['DONATION', 'ZAKAT'],
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2026-12-31T16:59:59.999Z'),
        recordedById: 'verifier-2',
        recordedAt: NOW,
      },
    ]);
    expect(store.partnerOrganisationAudits).toEqual([
      expect.objectContaining({
        partnerOrganisationId: 'partner-1',
        permitId: permit.id,
        action: 'PERMIT_RECORDED',
        before: null,
        after: {
          number: '123/PUB/2026',
          issuer: 'Kementerian Sosial',
          kinds: ['DONATION', 'ZAKAT'],
          validFrom: '2026-01-01T00:00:00.000Z',
          validTo: '2026-12-31T16:59:59.999Z',
        },
        actedById: 'verifier-2',
        actedAt: NOW,
      }),
    ]);
  });

  it.each([
    ['a blank number', { number: '' }],
    ['a blank issuer', { issuer: '  ' }],
    ['no Kind', { kinds: [] }],
    ['an unknown Kind', { kinds: ['SEDEKAH'] }],
    ['an invalid date', { validFrom: 'besok' }],
    ['an end before its start', { validFrom: '2027-01-01T00:00:00.000Z' }],
  ])('refuses %s with 400, writing nothing', async (_what, override) => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow()] });

    const error = await recordFundraisingPermit(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      ...PERMIT,
      ...override,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidPartnerOrganisationError);
    expect(store.fundraisingPermits).toEqual([]);
    expect(store.partnerOrganisationAudits).toEqual([]);
  });
});

describe('updateFundraisingPermit', () => {
  it('extends a permit on renewal, auditing before and after', async () => {
    const store = db({
      partnerOrganisations: [partnerOrganisationRow()],
      fundraisingPermits: [fundraisingPermitRow({ validTo: new Date('2026-12-31T00:00:00.000Z') })],
    });

    await updateFundraisingPermit(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      permitId: 'permit-1',
      changes: { validTo: '2027-12-31T00:00:00.000Z' },
      now: NOW,
    });

    expect(store.fundraisingPermits[0].validTo).toEqual(new Date('2027-12-31T00:00:00.000Z'));
    expect(store.partnerOrganisationAudits).toEqual([
      expect.objectContaining({
        permitId: 'permit-1',
        action: 'PERMIT_UPDATED',
        before: expect.objectContaining({ validTo: '2026-12-31T00:00:00.000Z' }),
        after: expect.objectContaining({ validTo: '2027-12-31T00:00:00.000Z' }),
        actedById: 'verifier-2',
      }),
    ]);
  });

  it('answers 404 for a permit of another organisation', async () => {
    const store = db({
      partnerOrganisations: [partnerOrganisationRow(), partnerOrganisationRow({ id: 'partner-2', fundraiserId: 'x' })],
      fundraisingPermits: [fundraisingPermitRow()],
    });

    const error = await updateFundraisingPermit(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-2',
      permitId: 'permit-1',
      changes: { issuer: 'Dinas Sosial' },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FundraisingPermitNotFoundError);
    expect(domainErrorToHttp(error)?.status).toBe(404);
  });

  it('refuses a change that would end the permit before it starts', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow()], fundraisingPermits: [fundraisingPermitRow()] });

    const error = await updateFundraisingPermit(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      permitId: 'permit-1',
      changes: { validTo: '2019-01-01T00:00:00.000Z' },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidPartnerOrganisationError);
  });
});

describe('grantKindAuthorisation', () => {
  const AUTHORISATION_PARAMS = {
    kind: 'ZAKAT',
    documentReference: ' SK Pengukuhan Amil Zakat 001/2026 ',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2026-12-31T16:59:59.999Z',
  };

  it('grants a dated Kind Authorisation for one non-donation Kind, and audits it', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow()] });

    const authorisation = await grantKindAuthorisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      ...AUTHORISATION_PARAMS,
      now: NOW,
    });

    expect(store.kindAuthorisations).toEqual([
      {
        id: authorisation.id,
        partnerOrganisationId: 'partner-1',
        kind: 'ZAKAT',
        documentReference: 'SK Pengukuhan Amil Zakat 001/2026',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2026-12-31T16:59:59.999Z'),
        grantedById: 'verifier-2',
        grantedAt: NOW,
      },
    ]);
    expect(store.partnerOrganisationAudits).toEqual([
      expect.objectContaining({
        partnerOrganisationId: 'partner-1',
        kindAuthorisationId: authorisation.id,
        permitId: null,
        action: 'KIND_AUTHORISATION_GRANTED',
        before: null,
        after: {
          kind: 'ZAKAT',
          documentReference: 'SK Pengukuhan Amil Zakat 001/2026',
          validFrom: '2026-01-01T00:00:00.000Z',
          validTo: '2026-12-31T16:59:59.999Z',
        },
        actedById: 'verifier-2',
        actedAt: NOW,
      }),
    ]);
  });

  it.each([
    ['a blank document reference', { documentReference: ' ' }],
    ['an unknown Kind', { kind: 'SEDEKAH' }],
    ['donation, which needs no Kind Authorisation', { kind: 'DONATION' }],
    ['an invalid date', { validFrom: 'besok' }],
    ['an end before its start', { validFrom: '2027-01-01T00:00:00.000Z' }],
  ])('refuses %s with 400, writing nothing', async (_what, override) => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow()] });

    const error = await grantKindAuthorisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      ...AUTHORISATION_PARAMS,
      ...override,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidPartnerOrganisationError);
    expect(store.kindAuthorisations).toEqual([]);
    expect(store.partnerOrganisationAudits).toEqual([]);
  });

  it('refuses the organisation\'s own linked account acting as Verifier on it', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow({ fundraiserId: 'verifier-2' })] });

    const error = await grantKindAuthorisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      ...AUTHORISATION_PARAMS,
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OwnPartnerOrganisationError);
  });
});

describe('updateKindAuthorisation', () => {
  it('extends a Kind Authorisation on renewal, auditing before and after', async () => {
    const store = db({
      partnerOrganisations: [partnerOrganisationRow()],
      kindAuthorisations: [kindAuthorisationRow({ validTo: new Date('2026-12-31T00:00:00.000Z') })],
    });

    await updateKindAuthorisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      kindAuthorisationId: 'kind-authorisation-1',
      changes: { validTo: '2027-12-31T00:00:00.000Z' },
      now: NOW,
    });

    expect(store.kindAuthorisations[0].validTo).toEqual(new Date('2027-12-31T00:00:00.000Z'));
    expect(store.partnerOrganisationAudits).toEqual([
      expect.objectContaining({
        kindAuthorisationId: 'kind-authorisation-1',
        action: 'KIND_AUTHORISATION_UPDATED',
        before: expect.objectContaining({ validTo: '2026-12-31T00:00:00.000Z' }),
        after: expect.objectContaining({ validTo: '2027-12-31T00:00:00.000Z' }),
        actedById: 'verifier-2',
      }),
    ]);
  });

  it('answers 404 for a Kind Authorisation of another organisation', async () => {
    const store = db({
      partnerOrganisations: [partnerOrganisationRow(), partnerOrganisationRow({ id: 'partner-2', fundraiserId: 'x' })],
      kindAuthorisations: [kindAuthorisationRow()],
    });

    const error = await updateKindAuthorisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-2',
      kindAuthorisationId: 'kind-authorisation-1',
      changes: { documentReference: 'SK Baru' },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KindAuthorisationNotFoundError);
    expect(domainErrorToHttp(error)?.status).toBe(404);
  });

  it('refuses a change that would end it before it starts', async () => {
    const store = db({
      partnerOrganisations: [partnerOrganisationRow()],
      kindAuthorisations: [kindAuthorisationRow()],
    });

    const error = await updateKindAuthorisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      kindAuthorisationId: 'kind-authorisation-1',
      changes: { validTo: '2019-01-01T00:00:00.000Z' },
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidPartnerOrganisationError);
  });

  it('writes no audit entry for a change that leaves it as it was', async () => {
    const store = db({
      partnerOrganisations: [partnerOrganisationRow()],
      kindAuthorisations: [kindAuthorisationRow()],
    });

    await updateKindAuthorisation(store.prisma as never, {
      actorId: 'verifier-2',
      organisationId: 'partner-1',
      kindAuthorisationId: 'kind-authorisation-1',
      changes: { kind: 'ZAKAT' },
      now: NOW,
    });

    expect(store.partnerOrganisationAudits).toEqual([]);
  });
});

describe('sponsorOptionsFor', () => {
  it('gives an organisation\'s linked account its own organisation and nothing to choose', async () => {
    const store = db({ partnerOrganisations: [partnerOrganisationRow({ fundraiserId: 'yiem-account' })] });

    expect(await sponsorOptionsFor(store.prisma as never, 'yiem-account')).toEqual({
      own: { id: 'partner-1', name: 'Yayasan Contoh Peduli' },
      sponsors: [],
    });
  });

  it('offers an individual Fundraiser only the organisations accepting individual Campaigns, by name', async () => {
    const store = db({
      partnerOrganisations: [
        partnerOrganisationRow({ id: 'p-b', name: 'Yayasan B', fundraiserId: 'b' }),
        partnerOrganisationRow({ id: 'p-closed', name: 'Yayasan Tertutup', fundraiserId: 'c', acceptsIndividualCampaigns: false }),
        partnerOrganisationRow({ id: 'p-a', name: 'Yayasan A', fundraiserId: 'a' }),
      ],
    });

    expect(await sponsorOptionsFor(store.prisma as never, 'someone')).toEqual({
      own: null,
      sponsors: [
        { id: 'p-a', name: 'Yayasan A' },
        { id: 'p-b', name: 'Yayasan B' },
      ],
    });
  });
});
