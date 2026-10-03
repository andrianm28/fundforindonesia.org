"use client";

import { useCallback, useEffect, useState } from "react";

import {
  INQUIRY_STATUS_LABEL,
  nextInquiryStatus,
  type PartnershipInquiryStatusValue,
} from "@/lib/partnership-inquiry-status";
import { SECTOR_LABEL, type SectorValue } from "@/lib/programs";

/**
 * The partnership team's Inquiry queue (ticket 06; CONTEXT.md, Partnership
 * Inquiry). Every company that has asked to discuss a Program, with that
 * Program, the contact they named, how far the follow-up has got, and who
 * moved it last -- so the answer to "who followed this up, and when" is on the
 * screen and not in a log somebody has to go looking for.
 *
 * Each row offers exactly the one step forward its status allows, and a
 * finished Inquiry offers none: the movement rule is the API's, and the queue
 * only shows the button that the API will accept. After a move the queue is
 * reloaded rather than patched in place, so what the team sees is what the
 * database holds -- including when somebody else got there first and this move
 * was refused.
 *
 * The admin layout gates the page on the ADMIN assignment and the API re-checks
 * it (ADR 0005). The status vocabulary and the Sector labels are imported from
 * the lib rather than written here, so the panel cannot drift from the codes
 * the database stores.
 */
interface InquiryRow {
  id: string;
  companyName: string;
  contactName: string;
  status: PartnershipInquiryStatusValue;
  createdAt: string;
  program: { slug: string; title: string; sector: SectorValue };
  lastStatusChange: {
    fromStatus: PartnershipInquiryStatusValue;
    toStatus: PartnershipInquiryStatusValue;
    actedByName: string;
    actedAt: string;
  } | null;
}

const API = "/api/admin/partnership-inquiries";

/** The one action a status offers, in the words the team uses for it. */
const ACTION_LABEL = {
  IN_PROGRESS: "Mulai Tindak Lanjut",
  DONE: "Tandai Selesai",
} as const;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });
}

export default function AdminPartnershipInquiriesPage() {
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setInquiries(data.inquiries);
    } catch {
      setError("Gagal memuat daftar Partnership Inquiry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  /** Sends one step forward; on success reloads the queue, else shows the refusal. */
  async function followUp(id: string, status: PartnershipInquiryStatusValue) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.error === "string" && data.error !== ""
            ? data.error
            : "Gagal menyimpan perubahan.",
        );
        return;
      }
      await load();
    } catch {
      setError("Gagal menyimpan perubahan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Partnership Inquiry</h1>
        <p className="text-sm text-gray-600 mt-1">
          Pengajuan diskusi dari perusahaan atas satu Program, beserta status tindak lanjut tim kemitraan.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Memuat daftar Partnership Inquiry...</p>
      ) : inquiries.length === 0 ? (
        <p className="text-sm text-gray-500">Belum ada perusahaan yang mengajukan.</p>
      ) : (
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Program</th>
                <th className="px-4 py-3 font-medium">Perusahaan</th>
                <th className="px-4 py-3 font-medium">Narahubung</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Tindak Lanjut Terakhir</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inquiries.map((inquiry) => {
                const next = nextInquiryStatus(inquiry.status);
                return (
                  <tr key={inquiry.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inquiry.program.title}</div>
                      <div className="text-xs text-gray-500">{SECTOR_LABEL[inquiry.program.sector]}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{inquiry.companyName}</td>
                    <td className="px-4 py-3 text-gray-700">{inquiry.contactName}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        {INQUIRY_STATUS_LABEL[inquiry.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {inquiry.lastStatusChange ? (
                        <>
                          <div>
                            {inquiry.lastStatusChange.actedByName} -&gt;{" "}
                            {INQUIRY_STATUS_LABEL[inquiry.lastStatusChange.toStatus]}
                          </div>
                          <div>{formatDate(inquiry.lastStatusChange.actedAt)}</div>
                        </>
                      ) : (
                        "Belum ditindaklanjuti"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {next === null ? (
                        <span className="text-xs text-gray-500">{INQUIRY_STATUS_LABEL.DONE}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => followUp(inquiry.id, next)}
                          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                        >
                          {ACTION_LABEL[next]}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
