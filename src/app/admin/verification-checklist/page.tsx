"use client";

import { useCallback, useEffect, useState } from "react";
import type { MoveDirection } from "@/lib/verification-checklist";
import { KIND_LABEL, KINDS, type CampaignKind } from "@/lib/campaign-kind";

// The Admin edits the verification checklist here (verification-request 04,
// PRD §7.1). Changes apply to Verification Requests submitted afterwards;
// every existing request keeps the checklist it was submitted with. Items are
// deactivated, never deleted. An item scoped to one Kind is only checked on
// that Kind's submissions; a general one ("Semua") on every Kind's. The admin
// layout gates the page on the ADMIN assignment and the API re-checks it.

interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
  position: number;
  active: boolean;
  kind: CampaignKind | null;
}

function kindLabel(kind: CampaignKind | null): string {
  return kind === null ? "Semua" : KIND_LABEL[kind];
}

const API = "/api/admin/verification-checklist";

export default function AdminChecklistPage() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newRequired, setNewRequired] = useState(true);
  const [newKind, setNewKind] = useState<CampaignKind | "">("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items);
    } catch {
      setError("Gagal memuat checklist verifikasi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  /** Sends one change; on success reloads the list, else shows the refusal. */
  async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" && data.error !== "" ? data.error : "Gagal menyimpan perubahan.");
        return false;
      }
      await load();
      return true;
    } catch {
      setError("Gagal menyimpan perubahan.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await send(API, "POST", { label: newLabel, required: newRequired, kind: newKind === "" ? null : newKind })) {
      setNewLabel("");
      setNewRequired(true);
      setNewKind("");
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Checklist Verifikasi</h1>
      <p className="text-sm text-gray-600 mt-1">
        Dokumen yang diperiksa Verifier untuk setiap Verification Request. Perubahan berlaku untuk
        pengajuan berikutnya; pengajuan yang sudah ada tetap memakai checklist saat diajukan.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Memuat...</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {items.map((item, index) => (
            <ChecklistRow
              // The saved label is part of the key so a row's draft label
              // resets to what the server holds after every reload.
              key={`${item.id}:${item.label}`}
              item={item}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              busy={busy}
              onSave={(changes) => send(`${API}/${item.id}`, "PATCH", changes)}
              onMove={(direction) => send(`${API}/${item.id}/move`, "POST", { direction })}
            />
          ))}
        </ol>
      )}

      <form onSubmit={add} className="mt-8 rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          Item baru
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
          Wajib
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Berlaku untuk
          <select
            aria-label="Cakupan Kind item baru"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as CampaignKind | "")}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Semua</option>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Tambah item
        </button>
      </form>
    </div>
  );
}

function ChecklistRow({
  item,
  isFirst,
  isLast,
  busy,
  onSave,
  onMove,
}: {
  item: ChecklistItem;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onSave: (changes: Partial<Pick<ChecklistItem, "label" | "required" | "active" | "kind">>) => Promise<boolean>;
  onMove: (direction: MoveDirection) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(item.label);

  return (
    <li className={`rounded-lg border border-gray-200 p-4 ${item.active ? "bg-white" : "bg-gray-100"}`}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label={`Label item ${item.position}`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || label === item.label}
          onClick={() => onSave({ label })}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          Simpan
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-gray-700">
          <input
            type="checkbox"
            checked={item.required}
            disabled={busy}
            onChange={(e) => onSave({ required: e.target.checked })}
          />
          Wajib
        </label>
        <label className="flex items-center gap-2 text-gray-700">
          Berlaku untuk
          <select
            aria-label={`Cakupan Kind item ${item.position}`}
            value={item.kind ?? ""}
            disabled={busy}
            onChange={(e) => onSave({ kind: e.target.value === "" ? null : (e.target.value as CampaignKind) })}
            className="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
          >
            <option value="">Semua</option>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">{kindLabel(item.kind)}</span>
        {!item.active && <span className="rounded bg-gray-300 px-2 py-0.5 text-xs text-gray-700">Nonaktif</span>}
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave({ active: !item.active })}
          className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50"
        >
          {item.active ? "Nonaktifkan" : "Aktifkan"}
        </button>
        <button
          type="button"
          disabled={busy || isFirst}
          onClick={() => onMove("up")}
          className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50"
        >
          Naikkan
        </button>
        <button
          type="button"
          disabled={busy || isLast}
          onClick={() => onMove("down")}
          className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-50"
        >
          Turunkan
        </button>
      </div>
    </li>
  );
}
