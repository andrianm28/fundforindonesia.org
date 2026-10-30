import { randomBytes } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";
import { Assignment, type Kind, type PrismaClient } from "@/generated/prisma/client";
import { hasAssignment } from "./assignment";
import { sniffImageType } from "./uploads";
import { DOCUMENT_UPLOADABLE_STATUSES } from "./document-uploadable-statuses";

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
 * Who may open one (`canReadDocument`): its uploader, an Admin, and
 *   - for a Campaign document: the Campaign's Fundraiser, and a Verifier while
 *     the Campaign has a Verification Request open, or who decided one of its
 *     requests;
 *   - for a Partner Organisation document: any Verifier (registering and
 *     checking organisations is the Verifier's own queue) and the
 *     organisation's linked Fundraiser account.
 * Everyone else gets the same 404 as a document that does not exist.
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
  uploadedById: string;
  campaignId: string | null;
  partnerOrganisationId: string | null;
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

/** The active checklist items of a Kind that need a document: what an upload form offers. */
export async function documentChecklistItems(prisma: PrismaClient, kind: Kind) {
  return prisma.verificationChecklistItem.findMany({
    where: { active: true, requiresDocument: true, OR: [{ kind: null }, { kind }] },
    orderBy: { position: "asc" },
    select: { id: true, label: true, required: true },
  });
}

export type DocumentTarget =
  | { campaignId: string; checklistItemId: string }
  | { partnerOrganisationId: string; label: string };

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
): Promise<{ label: string; campaignId: string | null; partnerOrganisationId: string | null; checklistItemId: string | null }> {
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
    return { label: item.label, campaignId: campaign.id, partnerOrganisationId: null, checklistItemId: item.id };
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
  return { label, campaignId: null, partnerOrganisationId: organisation.id, checklistItemId: null };
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

  const storagePath = newStoragePath();
  const full = absoluteStoragePath(root, storagePath)!;
  await mkdir(dirname(full), { recursive: true, mode: 0o700 });
  try {
    await writeFile(full, params.file.bytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    // A half-written file is ours to remove; an existing one (EEXIST) is not.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(full).catch(() => undefined);
    throw error;
  }

  try {
    return await prisma.document.create({
      data: {
        uploadedById: params.actor.id,
        campaignId: owner.campaignId,
        partnerOrganisationId: owner.partnerOrganisationId,
        checklistItemId: owner.checklistItemId,
        label: owner.label,
        contentType,
        sizeBytes: params.file.bytes.byteLength,
        storagePath,
      },
      select: SUMMARY,
    });
  } catch (error) {
    await unlink(full).catch(() => undefined);
    throw error;
  }
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
  try {
    return { id: document.id, contentType: document.contentType, bytes: await readFile(full) };
  } catch {
    console.error(`Document ${document.id}: stored file is missing or unreadable`);
    return null;
  }
}
