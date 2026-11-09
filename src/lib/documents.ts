import { randomBytes } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";
import { Assignment, type Kind, type PrismaClient } from "@/generated/prisma/client";
import { hasAssignment } from "./assignment";
import { sniffImageType } from "./uploads";
import { DOCUMENT_UPLOADABLE_STATUSES } from "./document-uploadable-statuses";
import { requireFieldKeys } from "./contact-fields";
import { organisationOf } from "./collecting-entity-guard";
import { DocumentIntegrityError, isSealedDocument, openDocumentBytes, sealDocumentBytes } from "./document-encryption";

export { DOCUMENT_UPLOADABLE_STATUSES };

/**
 * The private document store (ticket 64, decision 03; owner C4/C5 2026-10-04).
 *
 * A document is a Fundraiser's paper behind one §7.1 checklist item of their
 * Campaign, or a Partner Organisation's legal document recorded by a
 * Verifier. The bytes live on a host volume (PRIVATE_DOCUMENT_DIR), never
 * under public/ and never served by nginx or Next's static handler; the only
 * way to read one is the ACL route that streams it (`/api/documents/[id]`).
 * No signed URL, no object storage SDK: a link is only as good as the session
 * that opens it.
 *
 * A third kind (PKS Pasal 4.5): a supporting paper for a Payout request, readable
 * by its uploader (the Payout's Fundraiser) and an Admin only.
 *
 * A fourth (PKS Pasal 3.6, pks-pemenuhan/17): the proposal PDF of a Partnership
 * Inquiry, readable by an Admin and by the Tim CSR member who uploaded it. A
 * company on the public form has no account, so such a document may have no
 * uploader at all; then only an Admin can open it.
 *
 * Who may open one (`canReadDocument`): its uploader, an Admin, and
 *   - for a Campaign document: the Campaign's Fundraiser, and a Verifier while
 *     the Campaign has a Verification Request open, or who decided one of its
 *     requests;
 *   - for a Partner Organisation document: any Verifier (registering and
 *     checking organisations is the Verifier's own queue) and the
 *     organisation's linked Fundraiser account.
 * Everyone else gets the same 404 as a document that does not exist.
 *
 * The bytes are sealed at rest (ticket 14, `document-encryption.ts`): AES-256-GCM
 * under the field-encryption key, opened again only here, behind the ACL. A
 * file with no header predates that and is served as is; a sealed file that
 * fails verification throws, so the route answers 500 and never serves garbage.
 *
 * Documents are never deleted: a rejected submission's papers are still
 * someone's identity documents and are kept, just never public (decision 03).
 */

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_DOCUMENT_LABEL_LENGTH = 120;

/** The types a document may be, checked against its leading bytes. */
export const DOCUMENT_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

const EXTENSION: Record<DocumentContentType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The file extension a download of this type is named with. */
export function documentExtension(contentType: string): string {
  return EXTENSION[contentType as DocumentContentType] ?? "bin";
}

/** What the leading bytes actually are: a PDF or one of the image types, or null. */
export function sniffDocumentType(bytes: Uint8Array): DocumentContentType | null {
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  if (bytes.length >= pdf.length && pdf.every((b, i) => bytes[i] === b)) return "application/pdf";
  return sniffImageType(bytes);
}

/**
 * Where documents are written. PRIVATE_DOCUMENT_DIR in production, where the
 * host volume is mounted; outside production a gitignored folder under the
 * working directory, never under public/. Null in production without the
 * variable: writing into the container's own filesystem would lose every
 * document on the next deploy, so the routes answer 503 instead.
 */
export function documentRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.PRIVATE_DOCUMENT_DIR?.trim();
  if (configured) return resolve(configured);
  if (env.NODE_ENV === "production") return null;
  return join(process.cwd(), "storage", "private-documents");
}

/** A stored document's relative path: a two-hex shard, then 64 random hex. */
const STORAGE_PATH = /^[0-9a-f]{2}\/[0-9a-f]{64}$/;

/** A fresh, unguessable relative path. The name carries no extension and nothing of the upload. */
export function newStoragePath(): string {
  const name = randomBytes(32).toString("hex");
  return `${name.slice(0, 2)}/${name}`;
}

/**
 * The absolute path of a stored document, or null when `storagePath` is not
 * one this module wrote. Refuses anything that could climb out of the root,
 * even though the database CHECK already does.
 */
export function absoluteStoragePath(root: string, storagePath: string): string | null {
  if (!STORAGE_PATH.test(storagePath)) return null;
  const full = resolve(root, storagePath);
  return full.startsWith(resolve(root) + sep) ? full : null;
}

export class DocumentRefusedError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 | 415 | 503
  ) {
    super(message);
    this.name = "DocumentRefusedError";
  }
}

export type DocumentViewer = { id: string; assignments: Assignment[] | undefined };

/** The document fields the ACL needs, with the owner's own facts. */
type DocumentForAcl = {
  uploadedById: string | null;
  campaignId: string | null;
  partnerOrganisationId: string | null;
  payoutId?: string | null;
  partnershipInquiryId?: string | null;
};

/**
 * Whether `viewer` may open the document (see the module comment). Read
 * fresh on every request: a Verifier whose request was decided by someone
 * else, or an assignment revoked since, loses the document at once.
 */
export async function canReadDocument(
  prisma: PrismaClient,
  document: DocumentForAcl,
  viewer: DocumentViewer
): Promise<boolean> {
  if (document.uploadedById === viewer.id) return true;
  if (hasAssignment(viewer.assignments, Assignment.ADMIN)) return true;

  // A Partnership Inquiry's proposal (PKS Pasal 3.6): the uploader and an
  // Admin, both settled above, and nobody else. Not a Verifier.
  if (document.partnershipInquiryId) return false;

  // A Payout's supporting paper (PKS Pasal 4.5) is bank and money material:
  // its uploader, the Payout's Fundraiser and an Admin, and nobody else. Not a
  // Verifier: they have no part in a Payout.
  if (document.payoutId) {
    const payout = await prisma.payout.findUnique({
      where: { id: document.payoutId },
      select: { requestedById: true },
    });
    return payout?.requestedById === viewer.id;
  }

  const verifier = hasAssignment(viewer.assignments, Assignment.VERIFIER);

  if (document.campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: document.campaignId },
      select: { creatorId: true },
    });
    if (!campaign) return false;
    if (campaign.creatorId === viewer.id) return true;
    if (!verifier) return false;
    const handling = await prisma.verificationRequest.findFirst({
      where: {
        campaignId: document.campaignId,
        OR: [{ outcome: "PENDING" }, { decidedById: viewer.id }],
      },
      select: { id: true },
    });
    return handling !== null;
  }

  if (document.partnerOrganisationId) {
    if (verifier) return true;
    const organisation = await prisma.partnerOrganisation.findUnique({
      where: { id: document.partnerOrganisationId },
      select: { fundraiserId: true },
    });
    return organisation?.fundraiserId === viewer.id;
  }

  return false;
}

/** A document as lists show it: never its storage path. */
export type DocumentSummary = {
  id: string;
  label: string;
  checklistItemId: string | null;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
};

const SUMMARY = {
  id: true,
  label: true,
  checklistItemId: true,
  contentType: true,
  sizeBytes: true,
  uploadedAt: true,
} as const;

export async function campaignDocuments(prisma: PrismaClient, campaignId: string): Promise<DocumentSummary[]> {
  return prisma.document.findMany({ where: { campaignId }, select: SUMMARY, orderBy: { uploadedAt: "asc" } });
}

/** The supporting papers of a Payout, oldest first (the ACL is the route's, not this list's). */
export async function payoutDocuments(prisma: PrismaClient, payoutId: string): Promise<DocumentSummary[]> {
  return prisma.document.findMany({ where: { payoutId }, select: SUMMARY, orderBy: { uploadedAt: "asc" } });
}

export async function partnerOrganisationDocuments(
  prisma: PrismaClient,
  partnerOrganisationId: string
): Promise<DocumentSummary[]> {
  return prisma.document.findMany({
    where: { partnerOrganisationId },
    select: SUMMARY,
    orderBy: { uploadedAt: "asc" },
  });
}

/**
 * The active checklist items of a Kind that need a document: what an upload
 * form offers. Papers are uploaded ahead of a SUBMISSION, so only items asked
 * on one, and only those for this Fundraiser's applicant type (pks-pemenuhan/08).
 */
export async function documentChecklistItems(prisma: PrismaClient, kind: Kind, creatorId: string) {
  const applicant = (await organisationOf(prisma, creatorId)) ? "ORGANISATION" : "INDIVIDUAL";
  return prisma.verificationChecklistItem.findMany({
    where: {
      active: true,
      requiresDocument: true,
      AND: [
        { OR: [{ kind: null }, { kind }] },
        { OR: [{ applicant: null }, { applicant }] },
        { requestKinds: { has: "SUBMISSION" } },
      ],
    },
    orderBy: { position: "asc" },
    select: { id: true, label: true, required: true },
  });
}

export type DocumentTarget =
  | { campaignId: string; checklistItemId: string }
  | { partnerOrganisationId: string; label: string }
  | { payoutId: string; label: string };

type FileInput = { bytes: Uint8Array; declaredType: string; size: number };

/** Checks the file itself: size, declared type, and that the bytes are that type. */
export function validateDocumentFile(file: FileInput): DocumentContentType {
  if (file.size === 0) throw new DocumentRefusedError("Berkas kosong.", 400);
  if (file.size > MAX_DOCUMENT_SIZE) {
    throw new DocumentRefusedError("Ukuran berkas terlalu besar. Maksimal 10MB.", 413);
  }
  if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.declaredType)) {
    throw new DocumentRefusedError("Tipe berkas tidak didukung. Gunakan PDF, JPEG, PNG, atau WebP.", 415);
  }
  const actual = sniffDocumentType(file.bytes);
  if (actual !== file.declaredType) {
    throw new DocumentRefusedError("Isi berkas tidak sesuai dengan tipenya. Gunakan PDF, JPEG, PNG, atau WebP.", 415);
  }
  return actual;
}

/**
 * A Payout takes a paper only from the Fundraiser who requested it, and only
 * while it can still be judged or revised. Anyone else gets the "missing"
 * answer, so the id's existence leaks nothing. Shared by the early check and
 * the re-check under the row lock.
 */
function assertPayoutTakesPapers(
  payout: { requestedById: string; status: string } | null | undefined,
  actorId: string
): void {
  if (!payout || payout.requestedById !== actorId) {
    throw new DocumentRefusedError("Pencairan tidak ditemukan.", 404);
  }
  if (payout.status !== "DRAFT" && payout.status !== "REVISION_REQUESTED") {
    throw new DocumentRefusedError("Pencairan ini sudah diproses dan tidak menerima dokumen baru.", 409);
  }
}

/**
 * Works out what the upload is for and whether `actor` may add it, returning
 * the label to store. A Campaign document: only its Fundraiser, in a status
 * that still takes papers, for an active document item of the Campaign's Kind.
 * A Campaign the actor does not own answers as missing. An organisation
 * document: a Verifier or an Admin, with a title.
 */
async function authorise(
  prisma: PrismaClient,
  actor: DocumentViewer,
  target: DocumentTarget
): Promise<{
  label: string;
  campaignId: string | null;
  partnerOrganisationId: string | null;
  payoutId: string | null;
  checklistItemId: string | null;
}> {
  if ("payoutId" in target) {
    // Only the Fundraiser who requested the Payout, and only while it can
    // still be judged or revised: after approval or rejection the papers are
    // what the decision rested on. Anyone else, an Admin included (an Admin
    // reads these papers, never adds them), gets the same "missing" answer.
    const payout = await prisma.payout.findUnique({
      where: { id: target.payoutId },
      select: { id: true, requestedById: true, status: true },
    });
    assertPayoutTakesPapers(payout, actor.id);
    const label = typeof target.label === "string" ? target.label.trim() : "";
    if (label === "") throw new DocumentRefusedError("Nama dokumen wajib diisi.", 400);
    if (label.length > MAX_DOCUMENT_LABEL_LENGTH) {
      throw new DocumentRefusedError(`Nama dokumen paling panjang ${MAX_DOCUMENT_LABEL_LENGTH} karakter.`, 400);
    }
    return { label, campaignId: null, partnerOrganisationId: null, payoutId: target.payoutId, checklistItemId: null };
  }

  if ("campaignId" in target) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: target.campaignId },
      select: { id: true, creatorId: true, kind: true, lifecycleStatus: true },
    });
    if (!campaign || campaign.creatorId !== actor.id) {
      throw new DocumentRefusedError("Campaign tidak ditemukan.", 404);
    }
    if (!DOCUMENT_UPLOADABLE_STATUSES.includes(campaign.lifecycleStatus)) {
      throw new DocumentRefusedError("Campaign ini sudah ditutup dan tidak menerima dokumen baru.", 409);
    }
    const item = await prisma.verificationChecklistItem.findUnique({
      where: { id: target.checklistItemId },
      select: { id: true, label: true, active: true, requiresDocument: true, kind: true },
    });
    if (!item || !item.active || !item.requiresDocument || (item.kind !== null && item.kind !== campaign.kind)) {
      throw new DocumentRefusedError("Jenis dokumen tidak berlaku untuk Campaign ini.", 400);
    }
    return { label: item.label, campaignId: campaign.id, partnerOrganisationId: null, payoutId: null, checklistItemId: item.id };
  }

  if (
    !hasAssignment(actor.assignments, Assignment.VERIFIER) &&
    !hasAssignment(actor.assignments, Assignment.ADMIN)
  ) {
    throw new DocumentRefusedError("Lembaga Mitra tidak ditemukan.", 404);
  }
  const label = typeof target.label === "string" ? target.label.trim() : "";
  if (label === "") throw new DocumentRefusedError("Nama dokumen wajib diisi.", 400);
  if (label.length > MAX_DOCUMENT_LABEL_LENGTH) {
    throw new DocumentRefusedError(`Nama dokumen paling panjang ${MAX_DOCUMENT_LABEL_LENGTH} karakter.`, 400);
  }
  const organisation = await prisma.partnerOrganisation.findUnique({
    where: { id: target.partnerOrganisationId },
    select: { id: true },
  });
  if (!organisation) throw new DocumentRefusedError("Lembaga Mitra tidak ditemukan.", 404);
  return { label, campaignId: null, partnerOrganisationId: organisation.id, payoutId: null, checklistItemId: null };
}

/**
 * Stores one document: validates the file, checks the actor may add it,
 * writes the bytes under a fresh random name, then records the row. The file
 * is written first so a row never points at nothing; if the insert fails the
 * file is removed again.
 */
export async function uploadDocument(
  prisma: PrismaClient,
  params: { actor: DocumentViewer; file: FileInput; target: DocumentTarget; root?: string | null }
): Promise<DocumentSummary> {
  const root = params.root === undefined ? documentRoot() : params.root;
  if (!root) throw new DocumentRefusedError("Penyimpanan dokumen belum dikonfigurasi.", 503);

  const contentType = validateDocumentFile(params.file);
  const owner = await authorise(prisma, params.actor, params.target);

  // Never fall back to plaintext: without a key the document is not stored.
  let keys: ReturnType<typeof requireFieldKeys>;
  try {
    keys = requireFieldKeys();
  } catch (error) {
    console.error("Document upload refused: field encryption is not configured", error);
    throw new DocumentRefusedError("Penyimpanan dokumen belum dikonfigurasi.", 503);
  }

  return persistDocument(prisma, {
    root,
    keys,
    bytes: params.file.bytes,
    contentType,
    uploadedById: params.actor.id,
    owner,
  });
}

type Owner = {
  label: string;
  campaignId: string | null;
  partnerOrganisationId: string | null;
  payoutId: string | null;
  partnershipInquiryId?: string | null;
  checklistItemId: string | null;
};

/** Seals the bytes under a fresh random name, then records the row; the file goes if the row fails. */
async function persistDocument(
  prisma: PrismaClient,
  params: {
    root: string;
    keys: ReturnType<typeof requireFieldKeys>;
    bytes: Uint8Array;
    contentType: DocumentContentType;
    uploadedById: string | null;
    owner: Owner;
  },
): Promise<DocumentSummary> {
  const { root, keys, owner } = params;
  const storagePath = newStoragePath();
  const full = absoluteStoragePath(root, storagePath)!;
  const sealed = sealDocumentBytes(keys, storagePath, params.bytes);
  await mkdir(dirname(full), { recursive: true, mode: 0o700 });
  try {
    await writeFile(full, sealed, { mode: 0o600, flag: "wx" });
  } catch (error) {
    // A half-written file is ours to remove; an existing one (EEXIST) is not.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(full).catch(() => undefined);
    throw error;
  }

  const data = {
    uploadedById: params.uploadedById,
    campaignId: owner.campaignId,
    partnerOrganisationId: owner.partnerOrganisationId,
    payoutId: owner.payoutId,
    partnershipInquiryId: owner.partnershipInquiryId ?? null,
    checklistItemId: owner.checklistItemId,
    label: owner.label,
    contentType: params.contentType,
    sizeBytes: params.bytes.byteLength,
    storagePath,
  };
  try {
    if (owner.payoutId) {
      // The Payout can be approved or rejected between the check above and
      // this insert. Re-read it under its row lock, in the insert's own
      // transaction: a decision either committed first (refused here) or waits
      // for this commit, so no paper lands on a decided Payout.
      const payoutId = owner.payoutId;
      const uploaderId = params.uploadedById ?? "";
      return await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ requestedById: string; status: string }>>`SELECT "requestedById", status::text AS status FROM "Payout" WHERE id = ${payoutId} FOR UPDATE`;
        assertPayoutTakesPapers(rows[0], uploaderId);
        return tx.document.create({ data, select: SUMMARY });
      });
    }
    return await prisma.document.create({ data, select: SUMMARY });
  } catch (error) {
    await unlink(full).catch(() => undefined);
    throw error;
  }
}

/** The label a proposal is stored under. */
export const INQUIRY_PROPOSAL_LABEL = "Proposal kolaborasi";

/**
 * Whether a proposal could be stored, answered before anything is written: the
 * store is configured and the file is a PDF by its bytes. The Inquiry's create
 * path calls it ahead of its own write so that a bad attachment leaves no
 * Inquiry behind.
 */
export function assertInquiryProposalAcceptable(file: FileInput, root: string | null | undefined = undefined): void {
  const where = root === undefined ? documentRoot() : root;
  if (!where) throw new DocumentRefusedError("Penyimpanan dokumen belum dikonfigurasi.", 503);
  if (validateDocumentFile(file) !== "application/pdf") {
    throw new DocumentRefusedError("Proposal harus berupa berkas PDF.", 415);
  }
}

/**
 * Stores the proposal PDF of a Partnership Inquiry (PKS Pasal 3.6). `uploadedById`
 * is the Tim CSR member's own id, or null for the public form, which has no
 * account. PDF only: a proposal is a document, not a picture, and the bytes
 * must be a PDF whatever the browser claimed. The caller (the Inquiry's own
 * create path) has already authorised the write; this checks the file, the
 * Inquiry and the store, and answers a DocumentRefusedError for each.
 */
export async function uploadInquiryProposal(
  prisma: PrismaClient,
  params: { inquiryId: string; uploadedById: string | null; file: FileInput; root?: string | null },
): Promise<DocumentSummary> {
  const root = params.root === undefined ? documentRoot() : params.root;
  if (!root) throw new DocumentRefusedError("Penyimpanan dokumen belum dikonfigurasi.", 503);

  const contentType = validateDocumentFile(params.file);
  if (contentType !== "application/pdf") {
    throw new DocumentRefusedError("Proposal harus berupa berkas PDF.", 415);
  }
  const inquiry = await prisma.partnershipInquiry.findUnique({
    where: { id: params.inquiryId },
    select: { id: true },
  });
  if (!inquiry) throw new DocumentRefusedError("Partnership Inquiry tidak ditemukan.", 404);

  let keys: ReturnType<typeof requireFieldKeys>;
  try {
    keys = requireFieldKeys();
  } catch (error) {
    console.error("Proposal upload refused: field encryption is not configured", error);
    throw new DocumentRefusedError("Penyimpanan dokumen belum dikonfigurasi.", 503);
  }

  return persistDocument(prisma, {
    root,
    keys,
    bytes: params.file.bytes,
    contentType,
    uploadedById: params.uploadedById,
    owner: {
      label: INQUIRY_PROPOSAL_LABEL,
      campaignId: null,
      partnerOrganisationId: null,
      payoutId: null,
      partnershipInquiryId: inquiry.id,
      checklistItemId: null,
    },
  });
}

/**
 * The document and its bytes when `viewer` may open it, or null for every
 * other case (missing, not allowed, file gone), so the route answers one 404
 * that confirms nothing.
 */
export async function readDocument(
  prisma: PrismaClient,
  params: { documentId: string; viewer: DocumentViewer; root?: string | null }
): Promise<{ contentType: string; bytes: Buffer; id: string } | null> {
  const document = await prisma.document.findUnique({
    where: { id: params.documentId },
    select: {
      id: true,
      uploadedById: true,
      campaignId: true,
      partnerOrganisationId: true,
      payoutId: true,
      partnershipInquiryId: true,
      contentType: true,
      storagePath: true,
    },
  });
  if (!document) return null;
  if (!(await canReadDocument(prisma, document, params.viewer))) return null;

  const root = params.root === undefined ? documentRoot() : params.root;
  if (!root) return null;
  const full = absoluteStoragePath(root, document.storagePath);
  if (!full) return null;
  let stored: Buffer;
  try {
    stored = await readFile(full);
  } catch {
    console.error(`Document ${document.id}: stored file is missing or unreadable`);
    return null;
  }
  // The header decides: only a sealed file needs the keyring, so legacy
  // plaintext is still served with no key configured.
  if (isSealedDocument(stored)) {
    // Throws DocumentIntegrityError for a sealed file that does not verify (or
    // a missing key): the caller answers 500, never the bytes.
    return {
      id: document.id,
      contentType: document.contentType,
      bytes: openDocumentBytes(requireFieldKeys(), document.storagePath, stored),
    };
  }
  // A legacy file gets the sniff an upload gets: it is served only if it is
  // the type on record.
  if (sniffDocumentType(stored) !== document.contentType) {
    console.error(`Document ${document.id}: legacy plaintext file is not the type on record`);
    throw new DocumentIntegrityError(`Stored document ${document.storagePath} failed verification: content type mismatch`);
  }
  return { id: document.id, contentType: document.contentType, bytes: stored };
}
