import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { readUserEmail, SELECT_USER_EMAIL } from './contact-fields';
import type { Mailer } from './mail';
import { createPartnershipInquiry } from './partnership-inquiries';
import { INQUIRY_STATUS_LABEL, type PartnershipInquiryStatusValue } from './partnership-inquiry-status';
import { SECTOR_LABEL, slugifyTitle, type SectorValue } from './programs';

/**
 * Tim CSR accounts (ticket E9/01, tahap 2; CONTEXT.md, Tim CSR; owner's
 * decisions of 2026-10-04):
 *
 * (a) The account is a person (an ordinary User) plus a membership in one
 *     company; several people share a company. It is NOT an Assignment: a
 *     Tim CSR holds no role and carries no Campaign, Payout or Verification
 *     Request (ADR 0005).
 * (b) Verification is light and derived: a membership counts only while the
 *     user's email is verified AND its domain equals the company's domain.
 *     Nothing about "verified" is stored, so it cannot outlive either fact.
 *     A free-mail domain can never be a company domain.
 * (c) A verified member files Partnership Inquiries for the company, reads the
 *     company's Inquiries with their status history, and downloads an impact
 *     report of the Programs the company funded.
 * (d) Contact data is kept while the company is active and for two years after
 *     its last activity, then anonymised (anonymiseExpiredCompanies).
 *
 * PRIVACY. Every read here starts from the caller's own verified membership
 * and filters by that membership's company id; there is no function that takes
 * a company id from a caller. A caller who is not a verified member gets
 * CsrNotMemberError, which the routes answer as a literal 404 (owner rule),
 * the same answer for "not a member", "not signed in" and "no such thing".
 *
 * FUNDING LINK. Nothing in the schema ties a company's money to a Program: a
 * ManualContribution names a Program or Campaign but no company. So "the
 * Programs funded by the company" is read as the Programs of the company's own
 * Inquiries that reached DONE ("Selesai"), the only status in which the
 * partnership team has concluded the collaboration. If funding is ever
 * recorded against a company, replace fundedProgramsOf.
 */

// ==================== Refusals ====================

export class InvalidCompanyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCompanyInputError';
  }
}

/** Creating a company needs an email address its owner has proven. */
export class CompanyEmailNotVerifiedError extends Error {
  constructor() {
    super('Verifikasi email Anda dulu sebelum mendaftarkan perusahaan.');
    this.name = 'CompanyEmailNotVerifiedError';
  }
}

/** The caller is not a verified member of any company. Always answered as 404. */
export class CsrNotMemberError extends Error {
  constructor() {
    super('Not Found');
    this.name = 'CsrNotMemberError';
  }
}

export function csrErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof CsrNotMemberError) return { status: 404, error: 'Not Found' };
  if (error instanceof InvalidCompanyInputError) return { status: 400, error: error.message };
  if (error instanceof CompanyEmailNotVerifiedError) return { status: 403, error: error.message };
  return null;
}

// ==================== Email domain rule ====================

/** Providers anyone can open a mailbox on; none of them identifies a company. */
const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'tutanota.com',
  'fastmail.com',
]);

/** Providers that sell a mailbox under many country suffixes. */
const FREE_MAIL_FAMILIES = ['yahoo', 'hotmail', 'outlook', 'live'] as const;

/** The lowercase domain of an address, or null when it is not one. */
export function emailDomainOf(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = trimmed.slice(at + 1);
  return /^[^\s@.]+(\.[^\s@.]+)+$/.test(domain) ? domain : null;
}

export function isFreeMailDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (FREE_MAIL_DOMAINS.has(d)) return true;
  const labels = d.split('.');
  // yahoo.com, yahoo.co.id, outlook.co.id; but not live.acme.co.id, a company
  // that merely starts with a provider's name.
  const countrySuffix = labels.length === 3 && ['co', 'com', 'net', 'org'].includes(labels[1]);
  return FREE_MAIL_FAMILIES.some((family) => labels[0] === family && (labels.length === 2 || countrySuffix));
}

/** The company domain an address stands for, or a refusal. */
export function companyDomainFor(email: string): string {
  const domain = emailDomainOf(email);
  if (domain === null) throw new InvalidCompanyInputError('Email Anda tidak memiliki domain yang valid.');
  if (isFreeMailDomain(domain)) {
    throw new InvalidCompanyInputError('Gunakan email perusahaan Anda; alamat email gratis seperti Gmail atau Yahoo tidak dapat mewakili perusahaan.');
  }
  return domain;
}

// ==================== Membership ====================

const MAX_COMPANY_NAME_LENGTH = 200;

export type MembershipView = {
  companyId: string;
  companyName: string;
  verified: boolean;
};

type MemberContext = {
  companyId: string;
  companyName: string;
  userName: string;
  userEmail: string;
};

/**
 * The caller's verified membership, or null. Verified means the user's email
 * is verified, its domain is the company's, and the company is not anonymised.
 */
async function verifiedMemberOf(prisma: PrismaClient, userId: string): Promise<MemberContext | null> {
  const membership = await prisma.companyMembership.findUnique({
    where: { userId },
    select: {
      company: { select: { id: true, name: true, emailDomain: true, anonymisedAt: true } },
      user: { select: { name: true, emailVerifiedAt: true, ...SELECT_USER_EMAIL } },
    },
  });
  if (!membership || membership.company.anonymisedAt !== null || membership.user.emailVerifiedAt === null) return null;
  const email = readUserEmail(membership.user);
  if (email === null || emailDomainOf(email) !== membership.company.emailDomain) return null;
  return {
    companyId: membership.company.id,
    companyName: membership.company.name,
    userName: membership.user.name,
    userEmail: email,
  };
}

/** Whether the caller is a verified member, for a page deciding between 404 and content. */
export async function isVerifiedMember(prisma: PrismaClient, userId: string): Promise<boolean> {
  return (await verifiedMemberOf(prisma, userId)) !== null;
}

async function requireMember(prisma: PrismaClient, userId: string | null | undefined): Promise<MemberContext> {
  const member = userId ? await verifiedMemberOf(prisma, userId) : null;
  if (!member) throw new CsrNotMemberError();
  return member;
}

function cleanCompanyName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidCompanyInputError('Nama perusahaan wajib diisi.');
  }
  const name = value.trim();
  if (name.length > MAX_COMPANY_NAME_LENGTH) {
    throw new InvalidCompanyInputError(`Nama perusahaan paling panjang ${MAX_COMPANY_NAME_LENGTH} karakter.`);
  }
  return name;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Puts the user in the company of their own email domain, creating it when
 * there is none.
 *
 * The domain is never taken from the caller: it is the domain of the user's
 * own address, so nobody can join (or name) a company whose domain they do not
 * hold. Creating needs a verified email and a name; joining an existing
 * company needs neither, but an unverified member is not yet verified and sees
 * nothing until the address is confirmed. Repeating the call is harmless.
 */
export async function joinCompany(
  prisma: PrismaClient,
  userId: string,
  input: { companyName?: unknown },
): Promise<MembershipView & { created: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true, ...SELECT_USER_EMAIL },
  });
  if (!user) throw new CsrNotMemberError();
  const email = readUserEmail(user);
  if (email === null) throw new InvalidCompanyInputError('Email Anda tidak memiliki domain yang valid.');
  const domain = companyDomainFor(email);
  const verified = user.emailVerifiedAt !== null;

  const existing = await prisma.companyMembership.findUnique({
    where: { userId },
    select: { company: { select: { id: true, name: true, emailDomain: true } } },
  });
  if (existing) {
    return {
      companyId: existing.company.id,
      companyName: existing.company.name,
      verified: verified && existing.company.emailDomain === domain,
      created: false,
    };
  }

  let created = false;
  let company = await prisma.company.findUnique({ where: { emailDomain: domain } });
  if (!company || company.anonymisedAt !== null) {
    if (!verified) throw new CompanyEmailNotVerifiedError();
    const name = cleanCompanyName(input.companyName);
    try {
      // A reactivated company starts clean: Inquiries that were anonymised
      // under its previous life are detached so new members never see them.
      if (company) await prisma.partnershipInquiry.updateMany({ where: { companyId: company.id }, data: { companyId: null } });
      company = company
        ? await prisma.company.update({ where: { id: company.id }, data: { name, anonymisedAt: null } })
        : await prisma.company.create({ data: { name, emailDomain: domain } });
      created = true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      company = await prisma.company.findUniqueOrThrow({ where: { emailDomain: domain } });
    }
  }

  try {
    await prisma.companyMembership.create({ data: { companyId: company.id, userId } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  return { companyId: company.id, companyName: company.name, verified, created };
}

// ==================== Inquiries ====================

/** A member files an Inquiry for the company, as themselves. */
export async function submitCompanyInquiry(
  prisma: PrismaClient,
  userId: string | null | undefined,
  input: { programId: unknown; needs: unknown; contactPhone?: unknown },
  mailer?: Mailer,
) {
  const member = await requireMember(prisma, userId);
  return createPartnershipInquiry(
    prisma,
    {
      programId: input.programId,
      companyName: member.companyName,
      contactName: member.userName,
      contactEmail: member.userEmail,
      contactPhone: input.contactPhone,
      needs: input.needs,
    },
    mailer,
    undefined,
    { companyId: member.companyId },
  );
}

export type CompanyInquiryView = {
  id: string;
  program: { id: string; slug: string; title: string; sector: SectorValue };
  needs: string;
  contactName: string;
  status: PartnershipInquiryStatusValue;
  statusLabel: string;
  createdAt: Date;
  /** Oldest first; begins with the submission itself. Never names who moved it. */
  history: Array<{ status: PartnershipInquiryStatusValue; label: string; at: Date }>;
};

/**
 * The company's own Inquiries, newest first, each with its status history.
 * Contact email and phone are not part of the view, and neither is the
 * partnership team member who moved a status.
 */
export async function listCompanyInquiries(
  prisma: PrismaClient,
  userId: string | null | undefined,
): Promise<{ companyName: string; inquiries: CompanyInquiryView[] }> {
  const member = await requireMember(prisma, userId);
  const rows = await prisma.partnershipInquiry.findMany({
    where: { companyId: member.companyId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      needs: true,
      contactName: true,
      status: true,
      createdAt: true,
      program: { select: { id: true, slug: true, title: true, sector: true } },
      statusChanges: { orderBy: [{ actedAt: 'asc' }, { id: 'asc' }], select: { toStatus: true, actedAt: true } },
    },
  });
  return {
    companyName: member.companyName,
    inquiries: rows.map((row) => ({
      id: row.id,
      program: row.program,
      needs: row.needs,
      contactName: row.contactName,
      status: row.status,
      statusLabel: INQUIRY_STATUS_LABEL[row.status],
      createdAt: row.createdAt,
      history: [
        { status: 'NOT_YET_FOLLOWED_UP' as const, label: INQUIRY_STATUS_LABEL.NOT_YET_FOLLOWED_UP, at: row.createdAt },
        ...row.statusChanges.map((c) => ({ status: c.toStatus, label: INQUIRY_STATUS_LABEL[c.toStatus], at: c.actedAt })),
      ],
    })),
  };
}

// ==================== Impact report ====================

export type ImpactReportProgram = {
  title: string;
  sector: SectorValue;
  location: string;
  beneficiaries: string;
  problem: string;
  activities: string;
  budget: number;
  timeline: string;
  kpis: string[];
  impactReport: string | null;
  reportedAmount: number;
  reportedAsOf: Date | null;
};

export type CompanyImpactReport = {
  companyName: string;
  generatedAt: Date;
  programs: ImpactReportProgram[];
};

/**
 * The Programs the company is taken to have funded: those of its own Inquiries
 * that reached DONE (see FUNDING LINK above). Program columns are selected by
 * name; nothing that can carry a donor (reportedNote, Manual Contributions,
 * Donations) is read.
 */
async function fundedProgramsOf(prisma: PrismaClient, companyId: string): Promise<ImpactReportProgram[]> {
  return prisma.program.findMany({
    where: { partnershipInquiries: { some: { companyId, status: 'DONE' } } },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: {
      title: true,
      sector: true,
      location: true,
      beneficiaries: true,
      problem: true,
      activities: true,
      budget: true,
      timeline: true,
      kpis: true,
      impactReport: true,
      reportedAmount: true,
      reportedAsOf: true,
    },
  });
}

export async function buildCompanyImpactReport(
  prisma: PrismaClient,
  userId: string | null | undefined,
  now: Date = new Date(),
): Promise<CompanyImpactReport> {
  const member = await requireMember(prisma, userId);
  return { companyName: member.companyName, generatedAt: now, programs: await fundedProgramsOf(prisma, member.companyId) };
}

function rupiah(amount: number): string {
  return `Rp${amount.toLocaleString('id-ID')}`;
}

/** The report as a Markdown document: Program facts only. */
export function renderImpactReportMarkdown(report: CompanyImpactReport): string {
  const lines = [
    `# Laporan Dampak Program: ${report.companyName}`,
    '',
    `Dibuat ${report.generatedAt.toISOString().slice(0, 10)}. Memuat Program yang kolaborasinya dengan ${report.companyName} telah selesai; hanya data Program, tanpa data donatur.`,
    '',
  ];
  if (report.programs.length === 0) {
    lines.push('Belum ada Program dengan kolaborasi yang selesai.', '');
  }
  for (const program of report.programs) {
    lines.push(
      `## ${program.title}`,
      '',
      `- Sektor: ${SECTOR_LABEL[program.sector]}`,
      `- Lokasi: ${program.location}`,
      `- Penerima manfaat: ${program.beneficiaries}`,
      `- Anggaran: ${rupiah(program.budget)}`,
      `- Jadwal: ${program.timeline}`,
    );
    if (program.reportedAsOf) {
      lines.push(`- Dana CSR tercatat: ${rupiah(program.reportedAmount)} (per ${program.reportedAsOf.toISOString().slice(0, 10)})`);
    }
    lines.push('', '### Masalah', '', program.problem, '', '### Kegiatan', '', program.activities, '');
    if (program.kpis.length > 0) {
      lines.push('### KPI', '', ...program.kpis.map((k) => `- ${k}`), '');
    }
    lines.push('### Laporan dampak', '', program.impactReport ?? 'Belum ada laporan dampak untuk Program ini.', '');
  }
  return lines.join('\n');
}

export function impactReportFilename(companyName: string): string {
  return `laporan-dampak-${slugifyTitle(companyName)}.md`;
}

// ==================== Retention ====================

/** Contact data is kept this long after a company's last activity. */
export const COMPANY_RETENTION_YEARS = 2;

const ANONYMISED_NAME = '[dianonimkan]';
const ANONYMISED_KEY_ID = 'anonymised';

export type CompanyRetentionResult = { consideredCount: number; anonymisedCount: number };

/**
 * Anonymises every company whose last activity is more than two years old
 * (decision 2026-10-04 (d)). "Active" is read from what is on record, because
 * logins are not tracked: the last activity is the latest of the company's
 * creation, a member joining, and an Inquiry being filed.
 *
 * Per company, in one transaction: its memberships are removed (the people
 * keep their own accounts), and every Inquiry's contact name, email and phone
 * are replaced. The contact columns are NOT NULL, so the email columns take
 * placeholders and `contactAnonymisedAt` marks the rows; the HMAC placeholder
 * is unique per row so nothing links two anonymised rows. The Inquiry, its
 * Program and its status history stay: they hold no person. Idempotent, and
 * Inquiries that belong to no company are never touched.
 */
export async function anonymiseExpiredCompanies(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<CompanyRetentionResult> {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - COMPANY_RETENTION_YEARS);

  const candidates = await prisma.company.findMany({
    where: { anonymisedAt: null, createdAt: { lte: cutoff } },
    select: {
      id: true,
      createdAt: true,
      inquiries: { select: { createdAt: true } },
      memberships: { select: { createdAt: true } },
    },
  });

  let anonymisedCount = 0;
  for (const company of candidates) {
    const lastActivity = Math.max(
      company.createdAt.getTime(),
      ...company.inquiries.map((i) => i.createdAt.getTime()),
      ...company.memberships.map((m) => m.createdAt.getTime()),
    );
    if (lastActivity > cutoff.getTime()) continue;

    await prisma.$transaction(async (tx) => {
      await tx.companyMembership.deleteMany({ where: { companyId: company.id } });
      const inquiries = await tx.partnershipInquiry.findMany({
        where: { companyId: company.id, contactAnonymisedAt: null },
        select: { id: true },
      });
      for (const inquiry of inquiries) {
        await tx.partnershipInquiry.update({
          where: { id: inquiry.id },
          data: {
            contactName: ANONYMISED_NAME,
            contactEmailHmac: `anonymised:${inquiry.id}`,
            contactEmailHmacKeyId: ANONYMISED_KEY_ID,
            contactEmailCiphertext: '',
            contactEmailKeyId: ANONYMISED_KEY_ID,
            contactPhoneCiphertext: null,
            contactPhoneKeyId: null,
            contactAnonymisedAt: now,
          },
        });
      }
      await tx.company.update({ where: { id: company.id }, data: { anonymisedAt: now } });
    });
    anonymisedCount += 1;
  }
  return { consideredCount: candidates.length, anonymisedCount };
}
