import type { DocumentSummary } from "@/lib/documents";

/** "PDF, 1,2 MB": what the reader needs before opening a document. */
function describe(document: Pick<DocumentSummary, "contentType" | "sizeBytes">): string {
  const type = document.contentType === "application/pdf" ? "PDF" : document.contentType.replace("image/", "").toUpperCase();
  const size =
    document.sizeBytes >= 1024 * 1024
      ? `${(document.sizeBytes / (1024 * 1024)).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`
      : `${Math.max(1, Math.round(document.sizeBytes / 1024)).toLocaleString("id-ID")} KB`;
  return `${type}, ${size}`;
}

/**
 * A list of private documents (ticket 64), each opening in a new tab through
 * the ACL route `/api/documents/[id]`; there is no other URL for one. No
 * preview is embedded: the document is fetched only when someone allowed to
 * see it asks for it. `compact` drops the label, for a list already under
 * its checklist item.
 */
export function DocumentList({
  documents,
  empty,
  compact = false,
}: {
  /** `uploadedAt` is a Date from the server, or its ISO string from a JSON read. */
  documents: (Pick<DocumentSummary, "id" | "label" | "contentType" | "sizeBytes"> & { uploadedAt: Date | string })[];
  empty?: string;
  compact?: boolean;
}) {
  if (documents.length === 0) {
    return empty ? <p className="text-sm text-text-secondary">{empty}</p> : null;
  }
  return (
    <ul className="space-y-1" data-testid="document-list">
      {documents.map((document, index) => (
        <li key={document.id} className="text-sm">
          <a
            href={`/api/documents/${document.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0073E6] hover:underline"
          >
            {compact ? `Lihat dokumen ${index + 1}` : document.label}
          </a>
          <span className="ml-2 text-xs text-text-secondary">
            {describe(document)} · diunggah{" "}
            {new Date(document.uploadedAt).toLocaleDateString("id-ID", {
              timeZone: "Asia/Jakarta",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}
