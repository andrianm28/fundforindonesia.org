"use client";

import { useCallback, useEffect, useState } from "react";
import { KIND_LABEL, KINDS, type CampaignKind } from "@/lib/campaign-kind";

/**
 * The Verifier's register of Partner Organisations, their Fundraising
 * Permits and their Kind Authorisations (prd-compliance 10, 11): register an
 * organisation with the account that acts for it, set whether it accepts
 * individual Campaigns, record a permit or grant a Kind Authorisation, and
 * renew either by moving its end date. Every change is audited on the
 * server; nothing here is ever deleted.
 */

/** Zakat, wakaf and hibah are the only Kinds a Kind Authorisation may name; donation needs none. */
const AUTHORISABLE_KINDS = KINDS.filter((kind) => kind !== "DONATION");

type Permit = {
  id: string;
  number: string;
  issuer: string;
  kinds: CampaignKind[];
  validFrom: string;
  validTo: string;
};

type KindAuthorisation = {
  id: string;
  kind: CampaignKind;
  documentReference: string;
  validFrom: string;
  validTo: string;
};

type Organisation = {
  id: string;
  name: string;
  acceptsIndividualCampaigns: boolean;
  fundraiser: { name: string; email: string };
  permits: Permit[];
  kindAuthorisations?: KindAuthorisation[];
};

const API = "/api/moderasi/partner-organisations";

/** A date input's day as the instant it starts (validFrom) or ends (validTo) in WIB. */
function dayStart(day: string): string {
  return new Date(`${day}T00:00:00.000+07:00`).toISOString();
}
function dayEnd(day: string): string {
  return new Date(`${day}T23:59:59.999+07:00`).toISOString();
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data.error || "Terjadi kesalahan.";
}

const inputClass = "w-full rounded-lg border border-border p-2 text-sm";

export function PartnerOrganisationRegister() {
  const [organisations, setOrganisations] = useState<Organisation[] | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(API);
    if (!response.ok) {
      setMessage({ type: "error", text: "Gagal memuat Partner Organisation." });
      setOrganisations([]);
      return;
    }
    setOrganisations((await response.json()).organisations);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (request: Promise<string | null>, success: string) => {
    const refused = await request;
    setMessage(refused ? { type: "error", text: refused } : { type: "success", text: success });
    if (!refused) await load();
    return !refused;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-text">Partner Organisation</h1>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`p-3 rounded-lg text-sm ${
            message.type === "success" ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#FFEBEE] text-[#C62828]"
          }`}
        >
          {message.text}
        </div>
      )}

      <RegisterForm onSubmit={(body) => act(send(API, "POST", body), "Partner Organisation terdaftar.")} />

      {organisations === null && <p className="text-sm text-text-secondary">Memuat...</p>}
      {organisations?.length === 0 && (
        <p className="text-sm text-text-secondary">Belum ada Partner Organisation terdaftar.</p>
      )}
      {organisations?.map((organisation) => (
        <section key={organisation.id} className="bg-white rounded-xl border border-border p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text">{organisation.name}</h2>
              <p className="text-xs text-text-secondary">
                Akun Fundraiser: {organisation.fundraiser.name} ({organisation.fundraiser.email})
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-[#424242]">
              <input
                type="checkbox"
                checked={organisation.acceptsIndividualCampaigns}
                onChange={(event) =>
                  act(
                    send(`${API}/${organisation.id}`, "PATCH", {
                      acceptsIndividualCampaigns: event.target.checked,
                    }),
                    "Partner Organisation diperbarui."
                  )
                }
              />
              Menaungi Campaign Fundraiser perorangan
            </label>
          </div>

          <div>
            <h3 className="text-sm font-medium text-text mb-2">Fundraising Permit</h3>
            {organisation.permits.length === 0 ? (
              <p className="text-sm text-[#C62828]">
                Belum ada Fundraising Permit tercatat: Campaign yang dihimpunnya tidak dapat dibuka.
              </p>
            ) : (
              <ul className="space-y-2">
                {organisation.permits.map((permit) => (
                  <PermitRow
                    key={permit.id}
                    permit={permit}
                    onRenew={(validTo) =>
                      act(
                        send(`${API}/${organisation.id}/permits/${permit.id}`, "PATCH", { validTo: dayEnd(validTo) }),
                        "Masa berlaku izin diperbarui."
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <PermitForm
            onSubmit={(body) =>
              act(send(`${API}/${organisation.id}/permits`, "POST", body), "Fundraising Permit tercatat.")
            }
          />

          <div>
            <h3 className="text-sm font-medium text-text mb-2">Kind Authorisation</h3>
            <p className="text-xs text-text-secondary mb-2">
              Izin tambahan agar organisasi ini boleh menjalankan Campaign ber-Kind Zakat, Wakaf, atau Hibah.
            </p>
            {(organisation.kindAuthorisations ?? []).length === 0 ? (
              <p className="text-sm text-text-secondary">Belum ada Kind Authorisation.</p>
            ) : (
              <ul className="space-y-2">
                {(organisation.kindAuthorisations ?? []).map((authorisation) => (
                  <KindAuthorisationRow
                    key={authorisation.id}
                    authorisation={authorisation}
                    onRenew={(validTo) =>
                      act(
                        send(`${API}/${organisation.id}/kind-authorisations/${authorisation.id}`, "PATCH", {
                          validTo: dayEnd(validTo),
                        }),
                        "Masa berlaku Kind Authorisation diperbarui."
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <KindAuthorisationForm
            onSubmit={(body) =>
              act(send(`${API}/${organisation.id}/kind-authorisations`, "POST", body), "Kind Authorisation diberikan.")
            }
          />
        </section>
      ))}
    </div>
  );
}

function RegisterForm({ onSubmit }: { onSubmit: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [fundraiserEmail, setFundraiserEmail] = useState("");
  const [acceptsIndividualCampaigns, setAccepts] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="bg-white rounded-xl border border-border p-6 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const done = await onSubmit({ name, fundraiserEmail, acceptsIndividualCampaigns });
        setBusy(false);
        if (done) {
          setName("");
          setFundraiserEmail("");
          setAccepts(false);
        }
      }}
    >
      <h2 className="text-sm font-semibold text-text">Daftarkan Partner Organisation</h2>
      <p className="text-xs text-text-secondary">
        Daftarkan hanya setelah memeriksa dokumen legal organisasi. Satu akun Fundraiser bertindak atas namanya.
      </p>
      <label className="block text-sm text-text">
        Nama organisasi
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block text-sm text-text">
        Email akun Fundraiser yang mewakilinya
        <input
          className={inputClass}
          type="email"
          value={fundraiserEmail}
          onChange={(e) => setFundraiserEmail(e.target.value)}
          required
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-[#424242]">
        <input type="checkbox" checked={acceptsIndividualCampaigns} onChange={(e) => setAccepts(e.target.checked)} />
        Menaungi Campaign Fundraiser perorangan
      </label>
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 bg-[#0073E6] text-white text-sm font-medium rounded-lg disabled:opacity-50"
      >
        Daftarkan
      </button>
    </form>
  );
}

function PermitRow({ permit, onRenew }: { permit: Permit; onRenew: (validTo: string) => Promise<boolean> }) {
  const [validTo, setValidTo] = useState("");
  const now = Date.now();
  const valid = new Date(permit.validFrom).getTime() <= now && now <= new Date(permit.validTo).getTime();

  return (
    <li className="rounded-lg border border-border p-3 text-sm text-[#424242]">
      <p className="font-medium text-text">
        {permit.number} · {permit.issuer}
      </p>
      <p>
        Kind: {permit.kinds.map((kind) => KIND_LABEL[kind]).join(", ")} · Berlaku {formatDay(permit.validFrom)} s.d.{" "}
        {formatDay(permit.validTo)}{" "}
        <span className={valid ? "text-[#2E7D32]" : "text-[#C62828]"}>({valid ? "berlaku" : "tidak berlaku"})</span>
      </p>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (validTo && (await onRenew(validTo))) setValidTo("");
        }}
      >
        <label className="text-xs text-text-secondary">
          Perpanjang sampai
          <input className={inputClass} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </label>
        <button type="submit" className="px-3 py-2 border border-border rounded-lg text-xs">
          Perbarui
        </button>
      </form>
    </li>
  );
}

function PermitForm({ onSubmit }: { onSubmit: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [number, setNumber] = useState("");
  const [issuer, setIssuer] = useState("");
  const [kinds, setKinds] = useState<CampaignKind[]>([]);
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  const toggle = (kind: CampaignKind) =>
    setKinds((current) => (current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]));

  return (
    <form
      className="rounded-lg bg-bg-secondary p-3 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const done = await onSubmit({
          number,
          issuer,
          kinds,
          validFrom: validFrom ? dayStart(validFrom) : "",
          validTo: validTo ? dayEnd(validTo) : "",
        });
        if (done) {
          setNumber("");
          setIssuer("");
          setKinds([]);
          setValidFrom("");
          setValidTo("");
        }
      }}
    >
      <h3 className="text-sm font-medium text-text">Catat Fundraising Permit</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-xs text-text-secondary">
          Nomor izin
          <input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} required />
        </label>
        <label className="text-xs text-text-secondary">
          Penerbit
          <input className={inputClass} value={issuer} onChange={(e) => setIssuer(e.target.value)} required />
        </label>
        <label className="text-xs text-text-secondary">
          Berlaku dari
          <input className={inputClass} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
        </label>
        <label className="text-xs text-text-secondary">
          Berlaku sampai
          <input className={inputClass} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} required />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3 text-sm text-[#424242]">
        <legend className="text-xs text-text-secondary">Kind yang dicakup</legend>
        {KINDS.map((kind) => (
          <label key={kind} className="flex items-center gap-1">
            <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggle(kind)} />
            {KIND_LABEL[kind]}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="px-4 py-2 bg-[#0073E6] text-white text-sm font-medium rounded-lg">
        Catat izin
      </button>
    </form>
  );
}

function KindAuthorisationRow({
  authorisation,
  onRenew,
}: {
  authorisation: KindAuthorisation;
  onRenew: (validTo: string) => Promise<boolean>;
}) {
  const [validTo, setValidTo] = useState("");
  const now = Date.now();
  const valid = new Date(authorisation.validFrom).getTime() <= now && now <= new Date(authorisation.validTo).getTime();

  return (
    <li className="rounded-lg border border-border p-3 text-sm text-[#424242]">
      <p className="font-medium text-text">
        {KIND_LABEL[authorisation.kind]} · {authorisation.documentReference}
      </p>
      <p>
        Berlaku {formatDay(authorisation.validFrom)} s.d. {formatDay(authorisation.validTo)}{" "}
        <span className={valid ? "text-[#2E7D32]" : "text-[#C62828]"}>({valid ? "berlaku" : "tidak berlaku"})</span>
      </p>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (validTo && (await onRenew(validTo))) setValidTo("");
        }}
      >
        <label className="text-xs text-text-secondary">
          Perpanjang sampai
          <input className={inputClass} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </label>
        <button type="submit" className="px-3 py-2 border border-border rounded-lg text-xs">
          Perbarui
        </button>
      </form>
    </li>
  );
}

function KindAuthorisationForm({ onSubmit }: { onSubmit: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [kind, setKind] = useState<CampaignKind>(AUTHORISABLE_KINDS[0]);
  const [documentReference, setDocumentReference] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  return (
    <form
      className="rounded-lg bg-bg-secondary p-3 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const done = await onSubmit({
          kind,
          documentReference,
          validFrom: validFrom ? dayStart(validFrom) : "",
          validTo: validTo ? dayEnd(validTo) : "",
        });
        if (done) {
          setDocumentReference("");
          setValidFrom("");
          setValidTo("");
        }
      }}
    >
      <h3 className="text-sm font-medium text-text">Berikan Kind Authorisation</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-xs text-text-secondary">
          Kind
          <select
            className={inputClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as CampaignKind)}
          >
            {AUTHORISABLE_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-text-secondary">
          Rujukan dokumen
          <input
            className={inputClass}
            value={documentReference}
            onChange={(e) => setDocumentReference(e.target.value)}
            required
          />
        </label>
        <label className="text-xs text-text-secondary">
          Berlaku dari
          <input className={inputClass} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
        </label>
        <label className="text-xs text-text-secondary">
          Berlaku sampai
          <input className={inputClass} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} required />
        </label>
      </div>
      <button type="submit" className="px-4 py-2 bg-[#0073E6] text-white text-sm font-medium rounded-lg">
        Berikan Kind Authorisation
      </button>
    </form>
  );
}
