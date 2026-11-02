import { redirect } from "next/navigation";
import { AcceptInvitationForm } from "@/components/organisation/AcceptInvitationForm";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Where an invitation link lands (ticket E4). Opening it spends nothing: the
 * token is posted only when the person presses the button, so a mail scanner
 * that fetches the link cannot join anyone. Signed out, the person goes to the
 * login and comes back here with the link intact.
 */
export default async function TerimaUndanganPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const session = await getServerSession();
  if (!session?.user?.id) {
    const back = `/akun/organisasi/terima${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(back)}`);
  }
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Undangan tim organisasi</h1>
      <p className="text-sm">
        Anggota tim dapat melihat Campaign organisasi. Anggota tim tidak dapat mengajukan Payout dan tidak dapat mengelola rekening bank.
        Email akun Anda harus sama dengan alamat yang diundang dan sudah terverifikasi.
      </p>
      <AcceptInvitationForm token={token ?? null} />
    </div>
  );
}
