"use client";

import { useRouter } from "next/navigation";
import { DocumentUpload } from "./DocumentUpload";

/**
 * DocumentUpload on a server-rendered page: refreshes the page after each
 * upload, so the document list beside it re-reads itself.
 */
export function RefreshingDocumentUpload(props: Omit<Parameters<typeof DocumentUpload>[0], "onUploaded">) {
  const router = useRouter();
  return <DocumentUpload {...props} onUploaded={() => router.refresh()} />;
}
