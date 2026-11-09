"use client";

import { useCallback, useEffect, useState } from "react";

import {
  BUDGET_RANGE_LABEL,
  INQUIRY_STATUS_LABEL,
  PARTNERSHIP_INQUIRY_STATUSES,
  inquiryTransitionNeedsReason,
  type PartnershipBudgetRangeValue,
  type PartnershipInquiryStatusValue,
} from "@/lib/partnership-inquiry-status";
import { SECTOR_LABEL, type SectorValue } from "@/lib/programs";

/**
 * The partnership team's CSR pipeline (tickets 06 and pks-pemenuhan/17;
 * CONTEXT.md, Partnership Inquiry). One column per stage -- Baru through Tidak
 * dilanjutkan -- and each company that asked to discuss a Program is a card in
 * the column of its stage, with the Program, the contact they named, the
 * budget range and period they chose, whether a proposal is attached, and the
 * PIC who owns it.
 *
 * A card opens its detail beside the pipeline: the contact, address and NPWP
 * (read back by the API for an Admin only), the company's own words, the
 * proposal PDF, and the history -- who changed what, when, and the note they
 * left. There the team changes the stage, names the PIC and writes a note.
 * Moving is free in either direction, except that leaving Selesai or Tidak
 * dilanjutkan needs a reason: the page says so and holds the Save button until
 * there is one, and the API enforces it regardless.
 *
 * After a change both the pipeline and the detail are reloaded rather than
 * patched in place, so what the team sees is what the database holds --
 * including when somebody else got there first and this change was refused.
 *
 * The admin layout gates the page on the ADMIN assignment and the API re-checks
 * it (ADR 0005). The vocabulary comes from the lib, so the page cannot drift
 * from the codes the database stores.
 */
interface Person {
  id: string;
  name: string;
}

interface InquiryRow {
  id: string;
  companyName: string;
  contactName: string;
  status: PartnershipInquiryStatusValue;
  budgetRange: PartnershipBudgetRangeValue | null;
  periodStart: string | null;
  periodEnd: string | null;
  hasProposal: boolean;
  pic: Person | null;
  createdAt: string;
  program: { slug: string; title: string; sector: SectorValue };
  lastStatusChange: { actedByName: string; actedAt: string; toStatus: PartnershipInquiryStatusValue } | null;
}

interface InquiryDetail {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  companyAddress: string | null;
  companyNpwp: string | null;
  needs: string;
  status: PartnershipInquiryStatusValue;
  budgetRange: PartnershipBudgetRangeValue | null;
  periodStart: string | null;
  periodEnd: string | null;
  program: { title: string; sector: SectorValue };
  pic: Person | null;
  proposals: { id: string; label: string; contentType: string; sizeBytes: number }[];
  history: {
    id: string;
    fromStatus: PartnershipInquiryStatusValue;
    toStatus: PartnershipInquiryStatusValue;
    actedByName: string;
    actedAt: string;
    note: string | null;
    picChanged: boolean;
    picFromName: string | null;
    picToName: string | null;
  }[];
}

const API = "/api/admin/partnership-inquiries";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });
}

function periodText(start: string | null, end: string | null): string | null {
  return start && end ? `${start} s/d ${end}` : null;
}

export default function AdminPartnershipInquiriesPage() {
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [pics, setPics] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [status, setStatus] = useState<PartnershipInquiryStatusValue>("NEW");
  const [picId, setPicId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setInquiries(data.inquiries);
      setPics(data.pics ?? []);
    } catch {
      setError("Gagal memuat daftar Partnership Inquiry.");
    } finally {
      setLoading(false);
    }
  }, []);

  /** Loads one Inquiry's detail and resets the form to what is stored. */
  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API}/${id}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { inquiry: InquiryDetail };
      setDetail(data.inquiry);
      setStatus(data.inquiry.status);
      setPicId(data.inquiry.pic?.id ?? "");
      setNote("");
    } catch {
      setError("Gagal memuat rincian Partnership Inquiry.");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  function open(id: string) {
    setOpenId(id);
    setDetail(null);
    setError(null);
    void loadDetail(id);
  }

  const statusChanged = detail !== null && status !== detail.status;
  const picChanged = detail !== null && picId !== (detail.pic?.id ?? "");
  const reasonNeeded = detail !== null && statusChanged && inquiryTransitionNeedsReason(detail.status, status);
  const reasonMissing = reasonNeeded && note.trim() === "";
  const canSave = detail !== null && (statusChanged || picChanged) && !reasonMissing && !busy;

  /** Sends only what changed; on success reloads, else shows the refusal. */
  async function save() {
    if (!detail || !canSave) return;
    const body: Record<string, unknown> = {};
    if (statusChanged) body.status = status;
    if (picChanged) body.picId = picId === "" ? null : picId;
    if (note.trim() !== "") body.note = note.trim();

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.error === "string" && data.error !== "" ? data.error : "Gagal menyimpan perubahan.",
        );
        return;
      }
      await Promise.all([load(), loadDetail(detail.id)]);
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
          Pipeline kolaborasi CSR: pengajuan diskusi dari perusahaan atas satu Program, dari Baru sampai Selesai atau
          Tidak dilanjutkan.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Memuat daftar Partnership Inquiry...</p>
      ) : (
        <div className="flex flex-col gap-6 xl:flex-row">
          <div className="flex gap-4 overflow-x-auto pb-2 xl:flex-1">
            {PARTNERSHIP_INQUIRY_STATUSES.map((column) => {
              const cards = inquiries.filter((inquiry) => inquiry.status === column);
              return (
                <section
                  key={column}
                  role="region"
                  aria-label={`Tahap ${INQUIRY_STATUS_LABEL[column]}`}
                  className="w-64 shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-3"
                >
                  <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-gray-800">
                    <span>{INQUIRY_STATUS_LABEL[column]}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{cards.length}</span>
                  </h2>
                  <div className="space-y-3">
                    {cards.map((inquiry) => {
                      const period = periodText(inquiry.periodStart, inquiry.periodEnd);
                      return (
                        <article
                          key={inquiry.id}
                          className={`rounded-lg border bg-white p-3 text-xs text-gray-600 ${
                            openId === inquiry.id ? "border-gray-900" : "border-gray-200"
                          }`}
                        >
                          <div className="text-sm font-medium text-gray-900">{inquiry.companyName}</div>
                          <div>{inquiry.program.title}</div>
                          <div className="text-gray-500">{SECTOR_LABEL[inquiry.program.sector]}</div>
                          <div className="mt-2">{inquiry.contactName}</div>
                          {inquiry.budgetRange && <div>{BUDGET_RANGE_LABEL[inquiry.budgetRange]}</div>}
                          {period && <div>{period}</div>}
                          {inquiry.hasProposal && <div>Proposal terlampir</div>}
                          <div className="mt-2 font-medium text-gray-800">
                            {inquiry.pic ? `PIC: ${inquiry.pic.name}` : "Belum ada PIC"}
                          </div>
                          {inquiry.lastStatusChange && (
                            <div className="mt-1 text-gray-500">
                              {inquiry.lastStatusChange.actedByName}, {formatDate(inquiry.lastStatusChange.actedAt)}
                            </div>
                          )}
                          <button
                            type="button"
                            aria-label={`Kelola ${inquiry.companyName}`}
                            onClick={() => open(inquiry.id)}
                            className="mt-3 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                          >
                            Kelola
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          {openId !== null && (
            <aside
              role="complementary"
              aria-label="Rincian Partnership Inquiry"
              className="w-full shrink-0 space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm xl:w-96"
            >
              {detail === null ? (
                <p className="text-gray-500">Memuat rincian...</p>
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{detail.companyName}</h2>
                    <p className="text-gray-600">{detail.program.title}</p>
                  </div>

                  <dl className="space-y-1 text-gray-700">
                    <div>
                      <dt className="inline font-medium">Narahubung: </dt>
                      <dd className="inline">{detail.contactName}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Email: </dt>
                      <dd className="inline">{detail.contactEmail ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Telepon: </dt>
                      <dd className="inline">{detail.contactPhone ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Alamat perusahaan: </dt>
                      <dd className="inline">{detail.companyAddress ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">NPWP: </dt>
                      <dd className="inline">{detail.companyNpwp ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Kisaran anggaran: </dt>
                      <dd className="inline">{detail.budgetRange ? BUDGET_RANGE_LABEL[detail.budgetRange] : "-"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Periode: </dt>
                      <dd className="inline">{periodText(detail.periodStart, detail.periodEnd) ?? "-"}</dd>
                    </div>
                  </dl>

                  <div>
                    <h3 className="font-medium text-gray-900">Yang ingin dibicarakan</h3>
                    <p className="whitespace-pre-line text-gray-700">{detail.needs}</p>
                  </div>

                  <div>
                    <h3 className="font-medium text-gray-900">Proposal</h3>
                    {detail.proposals.length === 0 ? (
                      <p className="text-gray-500">Tidak ada proposal terlampir.</p>
                    ) : (
                      <ul className="list-disc pl-5">
                        {detail.proposals.map((proposal) => (
                          <li key={proposal.id}>
                            <a
                              href={`/api/documents/${proposal.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-700 underline"
                            >
                              {proposal.label} (PDF)
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-3 border-t border-gray-200 pt-4">
                    <div>
                      <label htmlFor="inquiry-status" className="mb-1 block font-medium text-gray-900">
                        Tahap
                      </label>
                      <select
                        id="inquiry-status"
                        value={status}
                        onChange={(event) => setStatus(event.target.value as PartnershipInquiryStatusValue)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2"
                      >
                        {PARTNERSHIP_INQUIRY_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {INQUIRY_STATUS_LABEL[value]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="inquiry-pic" className="mb-1 block font-medium text-gray-900">
                        PIC
                      </label>
                      <select
                        id="inquiry-pic"
                        value={picId}
                        onChange={(event) => setPicId(event.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2"
                      >
                        <option value="">Belum ada PIC</option>
                        {pics.map((pic) => (
                          <option key={pic.id} value={pic.id}>
                            {pic.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="inquiry-note" className="mb-1 block font-medium text-gray-900">
                        Catatan tindak lanjut
                      </label>
                      <textarea
                        id="inquiry-note"
                        value={note}
                        maxLength={1000}
                        rows={3}
                        onChange={(event) => setNote(event.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2"
                      />
                      {reasonNeeded && (
                        <p className="mt-1 text-xs text-amber-700">
                          Alasan wajib diisi untuk memindahkan Inquiry dari {INQUIRY_STATUS_LABEL[detail.status]}.
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!canSave}
                      onClick={save}
                      className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      Simpan perubahan
                    </button>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="mb-2 font-medium text-gray-900">Riwayat</h3>
                    {detail.history.length === 0 ? (
                      <p className="text-gray-500">Belum ada perubahan.</p>
                    ) : (
                      <ol className="space-y-3">
                        {detail.history.map((entry) => (
                          <li key={entry.id} className="text-xs text-gray-600">
                            <div className="font-medium text-gray-800">
                              {entry.fromStatus === entry.toStatus
                                ? INQUIRY_STATUS_LABEL[entry.toStatus]
                                : `${INQUIRY_STATUS_LABEL[entry.fromStatus]} -> ${INQUIRY_STATUS_LABEL[entry.toStatus]}`}
                            </div>
                            {entry.picChanged && (
                              <div>
                                PIC: {entry.picFromName ?? "belum ada"} -&gt; {entry.picToName ?? "belum ada"}
                              </div>
                            )}
                            {entry.note && <div className="whitespace-pre-line">{entry.note}</div>}
                            <div className="text-gray-500">
                              {entry.actedByName}, {formatDate(entry.actedAt)}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
