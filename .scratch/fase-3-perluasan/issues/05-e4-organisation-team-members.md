# 05: E4 organisation-team-members

**Status:** ready-for-agent

**Blocked by:** none; E4 dijawab owner 2026-10-04

**Ukuran:** L, skema, review uang

**Catatan:** Review uang: wajib review independen `sonnet` dengan bukti diposting di PR. Skema: satu PR skema pada satu waktu.

**Prasyarat:** Grilling peran anggota.

**Keputusan (2026-10-04, ronde C):** E4 anggota tim **tidak** boleh meminta Payout; permintaan Payout tetap milik akun Fundraiser utama organisasi.

## Latar

Anggota tim untuk Fundraiser organisasi: membership, peran, undangan, akses Payout. Rekomendasi C23 menolak anggota meminta Payout; bila ditolak, aturan dua orang dan pemisahan tugas harus dihitung ulang.

## Berkas relevan

- `CONTEXT.md` (Partner Organisation: anggota tim menyusul)
- ADR 0005 (peran sebagai Assignment terpisah)
- `prisma/schema.prisma`

## Acceptance

- [x] Hasil grilling peran dicatat di tiket (lihat Comments, 2026-11-02)
- [x] Model membership + undangan; migrasi tanpa kehilangan data
- [x] Anggota tidak bisa meminta Payout (ditolak di domain, bukan hanya disembunyikan di UI); akses Payout tetap hanya akun Fundraiser utama; tes subject-guard dan aturan dua orang

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Lajur E, relay kedua) dan `keputusan-ronde-c.md` (C23). Status `needs-info` karena grilling singkat dulu; acceptance di bawah sementara.

- 2026-10-04 (ronde C): E4 dijawab owner sesuai rekomendasi: anggota tim tidak boleh meminta Payout. Dengan begitu aturan dua orang dan pemisahan tugas tidak perlu dihitung ulang. Yang tidak ditanyakan: rincian peran anggota selain Payout; builder memakai peran minimal tanpa akses uang dan mencatatnya di PR untuk persetujuan owner. Kode uang tetap memerlukan review independen `sonnet`. `needs-info` menjadi `ready-for-agent`.

- 2026-11-02: dikerjakan (cabang `claude/project-thread-5dujal-e4`, migrasi `20261102120000_organisation_team_members`). **Grilling peran** (tanpa owner; builder memakai peran minimal sesuai catatan 2026-10-04, **menunggu persetujuan owner di PR**): satu peran `VIEWER`. Anggota membaca dasbor Campaign organisasi (judul, Kind, status, tenggat) dan tidak lebih: tidak ikut menyusun atau mengubah Campaign, karena "tindakan non-uang" Fundraiser (menyusun Draft, mengajukan Verification Request, menulis Campaign Update, Usage Report) bersinggungan dengan identitas, dokumen legal, dan tanggung jawab Fundraiser utama, dan tidak cukup jelas aman. Dasbor sengaja tanpa nominal, saldo, Payout, dan rekening. Bisa dilonggarkan kemudian dengan menambah nilai enum, tanpa mengubah model. Dibangun: `OrganisationMember` (satu orang satu tim), `OrganisationInvitation` (token acak, hanya hash SHA-256 disimpan, sekali pakai, berlaku 7 hari, dapat dicabut; email undangan tersegel seperti kontak lain, ADR 0012); `src/lib/organisation-team.ts`; `/api/organisation/{team,team/invitations,team/invitations/[id],team/members/[id],team/accept,campaigns}`; halaman `/akun/organisasi` dan `/akun/organisasi/terima`; email undangan best-effort lewat `sendReportingFailure`. Menerima undangan wajib sudah masuk dengan email **terverifikasi** yang sama dengan alamat yang diundang; membuka tautan tidak memakainya (token dikirim saat tombol ditekan). Penolakan uang di domain: `requireNotTeamMember` (`src/lib/organisation-member-guard.ts`) dipanggil `requestPayout` (di dalam transaksi, setelah kunci subjek) dan `createBankAccount`/`submit`/`withdraw`/`deleteBankAccount`; `requestPayout` kini juga menolak peminta yang bukan Fundraiser subjek (`NotAuthorizedError`), jadi aturan itu tidak lagi bergantung pada route. Persetujuan dan penyelesaian Payout tidak disentuh; tes menegaskan aturan dua orang, `SelfApprovalError`, dan `OwnSubjectConflictError` tidak berubah. Verifier tidak bisa mendaftarkan akun anggota tim sebagai akun Fundraiser organisasi (`FundraiserOnOrganisationTeamError`). Halaman dan API tim: literal 404 bagi yang bukan pemilik (dasbor: pemilik atau anggota). Yang perlu dikonfirmasi owner: (1) cakupan `VIEWER` di atas; (2) anggota tim tidak bisa punya rekening bank atau Payout sama sekali, termasuk untuk Campaign perorangan miliknya sendiri, karena larangan melekat pada orangnya; (3) batas 25 anggota dan 20 undangan menunggu per organisasi, serta masa berlaku 7 hari; (4) belum ada jalur anggota keluar sendiri (hanya dikeluarkan pemilik) dan belum ada jejak audit keluar-masuk anggota; (5) halaman `/akun/organisasi` belum ditautkan dari `/akun` (seperti `/akun/tim-csr`). Tes: `src/__tests__/integration/organisation-team-real-db.test.ts` (database nyata, termasuk balapan dua penerimaan), `src/lib/money/payouts.test.ts`, `src/lib/bank-account-verification.test.ts`, `src/lib/subject-guard.test.ts`, `src/lib/partner-organisations.test.ts`, `src/lib/mail/organisation-invitation.test.ts`.
