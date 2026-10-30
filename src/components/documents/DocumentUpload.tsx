"use client";

import { useRef, useState } from "react";

/** What the file picker offers: the types the server accepts after checking the bytes. */
export const DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

/**
 * Uploads one private document (ticket 64) to POST /api/documents, with the
 * fields that say what it is for: `campaignId` + `checklistItemId` for a
 * Campaign's paper, or `partnerOrganisationId` + a typed title for an
 * organisation's. The server checks the type, the bytes and who may add it;
 * this only picks the file and reports the answer.
 */
export function DocumentUpload({
  fields,
  askLabel = false,
  buttonLabel = "Unggah",
  name = "dokumen",
  onUploaded,
}: {
  fields: Record<string, string>;
  /** Ask for a title (an organisation's document), sent as `label`. */
  askLabel?: boolean;
  buttonLabel?: string;
  /** What the document is, for the file picker's accessible name. */
  name?: string;
  onUploaded?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) {
      setMessage({ type: "error", text: "Pilih berkas terlebih dahulu." });
      return;
    }
    if (askLabel && label.trim() === "") {
      setMessage({ type: "error", text: "Nama dokumen wajib diisi." });
      return;
    }
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    if (askLabel) body.append("label", label.trim());
    body.append("file", file);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/documents", { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Gagal mengunggah dokumen.");
      }
      if (input.current) input.current.value = "";
      setLabel("");
      setMessage({ type: "success", text: "Dokumen terunggah." });
      onUploaded?.();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Gagal mengunggah dokumen." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {askLabel && (
        <input
          type="text"
          aria-label="Nama dokumen"
          placeholder="Nama dokumen, mis. Akta pendirian"
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
          className="block w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept={DOCUMENT_ACCEPT}
          aria-label={`Berkas ${name}`}
          disabled={busy}
          className="text-xs"
        />
        <button
          type="button"
          onClick={upload}
          disabled={busy}
          className="rounded-lg border border-[#0073E6] px-3 py-1 text-xs font-medium text-[#0073E6] disabled:opacity-50"
        >
          {busy ? "Mengunggah..." : buttonLabel}
        </button>
      </div>
      <p className="text-[11px] text-text-secondary">PDF, JPEG, PNG, atau WebP, maksimal 10MB.</p>
      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          className={`text-xs ${message.type === "error" ? "text-[#C62828]" : "text-[#2E7D32]"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
