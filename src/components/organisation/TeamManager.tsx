"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type TeamManagerProps = {
  members: Array<{ id: string; name: string; email: string | null; since: string }>;
  invitations: Array<{ id: string; email: string | null; status: "PENDING" | "EXPIRED"; expiresAt: string }>;
};

/**
 * The primary Fundraiser's team controls (ticket E4): invite by email, revoke
 * an invitation, remove a member. Every action is checked again on the server
 * (src/lib/organisation-team.ts); this is only the form.
 */
export function TeamManager({ members, invitations }: TeamManagerProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(url: string, init: RequestInit, ok: (body: Record<string, unknown>) => string | null) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error ?? "Gagal.");
        return;
      }
      setMessage(ok(body));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function invite(event: React.FormEvent) {
    event.preventDefault();
    void call(
      "/api/organisation/team/invitations",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) },
      (body) => {
        setEmail("");
        const delivered = (body.invitation as { delivered?: boolean } | undefined)?.delivered;
        return delivered ? "Undangan dikirim." : "Undangan dibuat, tetapi email belum terkirim. Cabut dan undang lagi nanti.";
      },
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={invite} className="flex max-w-md gap-2">
        <input
          type="email"
          required
          className="w-full rounded border px-3 py-2"
          placeholder="email@contoh.org"
          aria-label="Email yang diundang"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
        />
        <button type="submit" disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60">
          Undang
        </button>
      </form>
      {message && <p role="status" className="text-sm">{message}</p>}

      <section className="space-y-2">
        <h3 className="font-semibold">Anggota</h3>
        {members.length === 0 && <p className="text-sm">Belum ada anggota.</p>}
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id} data-testid="team-member" className="flex items-center justify-between rounded border p-3 text-sm">
              <span>
                {member.name} {member.email && <span className="text-gray-600">({member.email})</span>}
              </span>
              <button
                type="button"
                disabled={busy}
                className="underline"
                onClick={() => call(`/api/organisation/team/members/${member.id}`, { method: "DELETE" }, () => "Anggota dikeluarkan.")}
              >
                Keluarkan
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Undangan</h3>
        {invitations.length === 0 && <p className="text-sm">Tidak ada undangan yang menunggu.</p>}
        <ul className="space-y-2">
          {invitations.map((invitation) => (
            <li key={invitation.id} data-testid="team-invitation" className="flex items-center justify-between rounded border p-3 text-sm">
              <span>
                {invitation.email} · {invitation.status === "PENDING" ? "menunggu" : "kedaluwarsa"}
              </span>
              <button
                type="button"
                disabled={busy}
                className="underline"
                onClick={() => call(`/api/organisation/team/invitations/${invitation.id}`, { method: "DELETE" }, () => "Undangan dicabut.")}
              >
                Cabut
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
