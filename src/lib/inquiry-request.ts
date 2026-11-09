import type { NextRequest } from "next/server";
import { MAX_DOCUMENT_SIZE } from "./documents";

/**
 * The body of a Partnership Inquiry submission, from either door that takes
 * one (the public form and a Tim CSR member's form), in either encoding:
 *
 * - JSON, as before: `{ programId, companyName, ... }`, no proposal.
 * - multipart/form-data (pks-pemenuhan/17): the same text fields plus an
 *   optional `proposal` file, which becomes a private Document (PDF only; the
 *   store checks the bytes, not this).
 *
 * Reading stops at the size cap, whatever Content-Length says: a body is never
 * buffered past the one proposal plus its framing. A body that is not the shape
 * it claims comes back as a refusal with the status the route should answer.
 */

/** The file plus room for the multipart framing and the other fields. */
export const MAX_INQUIRY_BODY_SIZE = MAX_DOCUMENT_SIZE + 64 * 1024;

/**
 * A JSON submission is text fields only (the longest, the need, is capped far
 * below this by the module), so it never needs more than a few kilobytes. The
 * public route is unauthenticated: without a cap, one request could make the
 * server buffer a body of any size before the field checks run.
 */
export const MAX_INQUIRY_JSON_SIZE = 64 * 1024;

export type InquiryRequestBody = {
  fields: Record<string, unknown>;
  proposal: { bytes: Uint8Array; declaredType: string; size: number } | null;
};

export type InquiryRequestRefusal = { error: string; status: 400 | 413 };

/** The request body, or 'too-large' as soon as it passes `cap` bytes. */
export async function readCappedBody(request: NextRequest, cap: number): Promise<Uint8Array<ArrayBuffer> | "too-large"> {
  if (Number(request.headers.get("content-length") ?? "0") > cap) return "too-large";
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return "too-large";
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readInquiryRequestBody(req: NextRequest): Promise<InquiryRequestBody | InquiryRequestRefusal> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    const raw = await readCappedBody(req, MAX_INQUIRY_JSON_SIZE);
    if (raw === "too-large") return { error: "Isi permintaan terlalu besar.", status: 413 };
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      parsed = undefined;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Body permintaan harus berupa objek JSON.", status: 400 };
    }
    return { fields: parsed as Record<string, unknown>, proposal: null };
  }

  const body = await readCappedBody(req, MAX_INQUIRY_BODY_SIZE);
  if (body === "too-large") return { error: "Ukuran berkas terlalu besar. Maksimal 10MB.", status: 413 };
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    return { error: "Formulir tidak valid.", status: 400 };
  }

  const fields: Record<string, unknown> = {};
  let proposal: InquiryRequestBody["proposal"] = null;
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    } else if (key === "proposal" && value.size > 0) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      proposal = { bytes, declaredType: value.type, size: bytes.byteLength };
    }
  }
  return { fields, proposal };
}
