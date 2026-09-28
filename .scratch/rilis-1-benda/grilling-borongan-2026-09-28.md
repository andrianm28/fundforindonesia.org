# Grilling borongan — 2026-09-28

Satu putaran grilling borongan sesuai `docs/agents/issue-tracker.md`: Dri boleh
menjawab beberapa tiket dalam satu pesan, tiap jawaban tercatat sebagai jawaban
tiket masing-masing. Dari 11 tiket open (02, 03, 04, 05, 07, 11, 12, 13, 14, 15,
17), dicek ulang terhadap kode karena tiket di sini pernah basi.

Kerangka hari ini: **Rilis 1 = gerbang PRD §11 Fase 0, 1, 2, dan 3.** Soft
launch boleh setelah gerbang Fase 2 (uang keluar tanpa `psql`). Item non-gerbang
Fase 3 diputuskan satu per satu belakangan. Urutan di bawah: yang membuka
jalur uang-keluar lebih dulu.

**Temuan sebelum mulai:** tiket **16 sudah merge** (`c19f2eb`, PR #121) —
bukan "in-review" seperti tercatat. `/akun/rekening`, `/moderasi/rekening`, dan
`readBankAccountNumber` kini punya pemanggil produksi. Ini mengubah konteks
11, 12, 17 di bawah.

---

## ❓ **11 - Apa yang mencabut verifikasi Bank Account, dan siapa yang boleh?** ([11](issues/11-clearing-a-bank-account-verification.md))

Tiket 16 sengaja tidak menjawab ini — sisi baca sudah menolak akun tanpa
`verifiedAt` (`payouts.ts:149,250`), sisi tulis (mencabutnya) belum ada. Sekarang
nyata: begitu rekening sungguhan terverifikasi lewat 16, satu-satunya cara
mencabut rekening palsu adalah `psql`. (a) Verifier yang sama, (b) Verifier
lain, (c) Admin, (d) tidak ada jalur langsung. Juga: satu aksi atau dua
(menghentikan Payout mendatang vs menyentuh Payout yang sudah cair), reversibel
atau tidak, dan pemicunya apa.

➡️ (b) Verifier lain — simetris dengan aturan 16 "Verifier tak menilai
rekeningnya sendiri"; dua aksi terpisah (cabut verifikasi ≠ Suspension); yang
sudah cair tidak disentuh; reversibel dengan alasan tercatat, pola yang sama
dengan Flag/Suspension yang sudah ada.

## ❓ **12 - Di mana nomor Bank Account didekripsi, apa instruksi payout-nya?** ([12](issues/12-decrypting-a-bank-account-at-payout.md))

Sebagian sudah terjawab oleh tiket 16 sendiri: pertanyaan 4 (Verifier butuh
nomor?) sudah **ya** — panel Verifier di `moderasi/rekening/DecidePanel.tsx`
mendekripsi nomor penuh, daftar antrean bertopeng. Sudah kode nyata. Sisa
terbuka: (1) apa yang benar-benar menginstruksikan transfer — kalau Sumopod
tetap tanpa API pencairan (ADR 0006), nomor **tidak pernah** perlu dibaca di
jalur payout sama sekali, dan komentar schema "decrypted at point of payout"
salah; (2) siapa boleh membaca nomor secara umum, tiap baca tak terlacak (ADR
0012); (3) masking di jalur payout (belum ada, karena pemilih rekening payout
belum merge).

➡️ Jawab (1) dulu: kalau provider aktif masih tanpa API pencairan, nyatakan
eksplisit nomor tak pernah dibaca di payout, perbaiki komentar schema, tutup
(2)-(3) sebagai "tidak berlaku sampai ada provider dengan API pencairan" —
keputusan satu kalimat, murah.

## ❓ **13 - Apa yang dianggap bukti bahwa uang benar-benar berpindah?** ([13](issues/13-what-counts-as-proof-that-the-money-moved.md))

Blocked by 03 (masih open) tapi inti pertanyaan lepas dari itu. Diverifikasi:
`proofImage` di `.../payouts/[id]/complete/route.ts:11` adalah
`z.string().trim().min(1)`; `payouts.ts:426` cuma cek ulang string kosong. Jadi
`{"proofImage":"x"}` menutup Payout — aturan dua-orang FFI-07 terpenuhi dua
tangan kosong. Bandingkan `ManualContribution.cleanProofReference`
(`manual-contributions.ts:212-223`): trim, wajib, max-length. (1) bukti itu
artefak (upload — mewarisi jebakan `/api/upload`, tunggu 03) atau catatan teks
terstruktur (referensi/timestamp/jumlah, bisa langsung dibangun)? (2) berapa
banyak yang wajib ditulis? (3) samakan aturannya dengan `ManualContribution`.

➡️ Catatan teks terstruktur wajib sekarang (referensi transaksi + kalimat
bebas, aturan `cleanProofReference`-style), artefak upload menyusul setelah 03.
Tidak diblokir 03 untuk bagian ini — murni perubahan Zod + fungsi validasi,
aman dikerjakan sekarang, menutup gerbang Fase 2.

## ❓ **02 - Di mana saldo riil provider dicatat, apakah selisih itu gerbang?** ([02](issues/02-provider-balance-record.md))

Diverifikasi: `approvePayout` (`payouts.ts:263`) belum punya parameter untuk
angka saldo provider, `Payout` tak punya kolom untuknya. FFI-07 menuntut Admin
mencatatnya sebelum approve. (1) kolom mana — perlu kolom baru plain (bukan
data kontak, di luar ADR 0012); (2) selisih itu gerbang (tolak approve bila
provider < ledger) atau observasi (catat, tetap boleh approve)? (3) apa yang
diberitahukan operator saat selisih, bukan penolakan diam.

➡️ Gerbang: tolak approve bila saldo provider tercatat < Campaign Balance yang
diminta, dengan opsi eksplisit Admin mencatat "sudah dicek, kurang" sebagai
keputusan tertunda — FFI-07 menyebutnya pengganti API saldo yang tak ada;
menjadikannya observasi menghapus satu-satunya kontrol yang PRD sediakan.

## ❓ **17 - Pemilih rekening sudah ada di PR; daftar kosongnya tidak dimiliki siapa pun** ([17](issues/17-the-picker-exists-what-the-empty-list-does-not-do.md))

Blocked by 16 — **dan 16 sudah merge**, jadi tiket ini sekarang bisa dikerjakan.
Pemilih rekening Payout (`CampaignPayoutPanel`, PR #114) sendiri **belum**
merge — `grep -ril bankaccount --include="*.tsx" src/` masih 0 di luar
`akun/rekening` dan `moderasi/rekening`. Tiga hal tak dimiliki siapa pun: (1)
empty state tanpa tautan ke `/akun/rekening` (yang sekarang **sudah ada**); (2)
rekening REJECTED tak pernah muncul di pemilih (`verifiedAt: {not: null}`),
konsekuensi keputusan 5 tiket 16 yang mencapai layar, bukan reopening; (3)
payout Volunteer Trip butuh `bankAccountId` sama tapi 0 file `.tsx` untuknya.

➡️ (1) pasang tautan ke `/akun/rekening` di empty state sekarang, biaya rendah;
(2) query pemilih tetap `verifiedAt: {not:null}`, tapi tambah kalimat pembeda
di empty state ("belum pernah menambahkan" vs "ada yang ditolak, cek status di
halaman rekening"); (3) jadwalkan tiket implementasi terpisah untuk payout
Volunteer Trip, clone panel Campaign, setelah #114 merge.

## ❓ **07 - Siapa boleh memberi assignment ADMIN/VERIFIER, apakah dua-orang?** ([07](issues/07-granting-assignments.md))

Owner sudah memutuskan 2026-09-27: grant ADMIN butuh dua Admin, grant VERIFIER
cukup satu, tidak ada yang mencabut assignment sendiri, penolakan harus
menjelaskan. **Kode tidak mengikuti ini**, diverifikasi di
`admin/users/[id]/assignments/route.ts`: `POST` hanya digerbangi satu ADMIN —
tidak ada mekanisme dua-orang untuk grant ADMIN sama sekali; `DELETE` hanya
menolak self-revoke untuk ADMIN, self-revoke VERIFIER **tidak** ditolak padahal
keputusan bilang assignment mana pun. Guard "last ADMIN" (row lock) sudah benar.
Masih terbuka: nomor "dua Admin" (boleh atasan-bawahan?), pending-grant atau
audit-hasil-akhir saja, organisasi dengan satu Admin, kolom alasan di
`AssignmentAuditEntry`.

➡️ (a) pending-grant sederhana meniru pola `BankAccountVerificationRequest`
yang baru dibangun tiket 16 — pola sudah ada, tak perlu desain baru; (b)
perbaiki self-revoke agar menolak **kedua** assignment, perbaikan satu baris;
organisasi satu-Admin: grant kedua boleh diajukan sendiri, menunggu Admin
kedua menyetujui, dicatat sebagai kondisi bootstrap bukan jalan pintas permanen;
tambah kolom alasan opsional sekarang, murah, konsisten `CampaignStatusChange`.

## ❓ **04 - Apakah angka PRD default di kode, atau konfigurasi?** ([04](issues/04-numbers-code-or-config.md))

Diverifikasi akurat: `DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD=0.6`
(`duplicate-hints.ts:30`) dan `ESCROW_HOLD_DAYS=7` (`escrow.ts:21`) masih
konstanta kode. Ambang Platform Fee sudah baris append-only
(`platform-fee-config.ts`) tapi **belum pernah diisi**, resolusi jatuh ke 0
tanpa baris cocok. Waiver Rp50.000 dikonfirmasi **tak ada di mana pun** di
`src/` atau seed. (1) mana yang Admin ubah, mana tetap kode — menentukan apakah
3 halaman Admin yang hilang (`platform-fee`, `duplicate-similarity`,
`abuse-thresholds`) semua perlu dibangun; (2) uang beku di angka lama; (3)
waiver Rp50.000 jadi default kode / baris Admin / dihapus; (4) Donor lihat apa
sebelum bayar — Campaign page tampilkan persentase, Checkout tidak sama sekali.

➡️ Escrow Hold & threshold similarity tetap konstanta kode (jarang berubah,
tak sepadan 2 halaman Admin sebelum Fase 2); Platform Fee tetap konfigurasi
(mekanisme sudah ada, PRD minta override per Category/Campaign) — halaman
Admin `platform-fee` diprioritaskan, dua lainnya ditunda ke Fase 3; freeze-at-
creation yang berjalan sekarang dipertahankan; waiver jadi baris Admin (pakai
mekanisme `PlatformFeeThreshold` yang ada); Checkout wajib tampilkan fee % dan
lama Escrow Hold sebelum bayar — gerbang FFI-01 yang belum terpenuhi, murah
ditutup begitu (1) diputuskan.

## ❓ **14 - Sapuan melaporkan pengingat yang tak pernah terkirim?** ([14](issues/14-the-jobs-trigger-and-the-reminder-it-loses.md))

Premis awal sudah dikoreksi di tiketnya sendiri — Fundraiser tetap diberi tahu
lewat Notification in-app yang commit satu transaksi dengan klaim
(`reminders.ts:105-114`), diverifikasi masih berlaku. Sisa pertanyaan sempit:
`sendReportingFailure` mengembalikan boolean sukses-kirim,
`reminders.ts:128` membuangnya, `:141` tetap `sentCount++` tanpa syarat — jadi
`sentCount` melaporkan "dicoba" bukan "terkirim". Sekunder: satu bearer secret
tanpa rate limit untuk sweep 500 baris (tapi idempoten, diverifikasi).

➡️ Ganti nama field jadi `attemptedCount` (atau tambah `deliveredCount` dari
boolean yang dibuang) — perubahan kecil, tak sentuh logika uang. Secret:
terima risikonya, tak perlu rate limit sekarang — bukan gerbang Fase 2, murni
kebersihan pelaporan.

## ❓ **15 - Bisakah sapuan escrow kelaparan di belakang baris yang tak pernah dilepas?** ([15](issues/15-the-escrow-sweep-can-starve.md))

Diverifikasi akurat: `releaseMaturedEscrow` ambil 200 tertua
(`ESCROW_RELEASE_SWEEP_LIMIT=200`), dua guard (SUSPENDED, Refund in-flight)
melewatkan baris tanpa mengubah `escrowReleaseAt` — baris itu tetap tertua dan
mengisi ulang jendela berikutnya. 200 baris macet permanen = sapuan berhenti
total untuk semua yang lain, tetap lapor sukses. Watchdog melapor per-subjek,
tak pernah "sapuan berhenti mencapai yang lain". Butuh skala ekstrem (200
Campaign suspended bersamaan) untuk nyata.

➡️ Lewati baris yang gagal karena guard permanen dengan urutan sekunder yang
mendorongnya ke belakang jendela berikutnya (jangan ubah `escrowReleaseAt` —
itu salah akuntansi); naikkan limit atau ubah kueri agar baris macet tak
memblokir yang lain; ubah teks peringatan agar membedakan backlog normal vs
baris macet permanen. Bukan gerbang Fase 2 murni — boleh menyusul setelah
02/11/12/13, tapi jangan didiamkan.

## ❓ **05 - Apa yang dilihat orang yang memegang dua assignment sekaligus?** ([05](issues/05-two-assignments-one-person.md))

ADR 0005 menghapus rank: ADMIN, VERIFIER, DONOR dipegang lepas-lepas
(FUNDRAISER bukan `Assignment` nyata — hanya `StatusChangeCapacity`, lihat
catatan tiket 16). Tiap halaman `src/app/admin` dan `src/app/moderasi`
menggerbangi sendiri-sendiri — Admin-Verifier dapat kedua set tanpa batasan
silang. (1) apakah itu benar; (2) haruskah sebagian layar eksklusif; (3) apa
yang tampil di navigasi (dua pohon terpisah hari ini).

➡️ Terima (1) — aturan dua-orang FFI-07 sudah menjaga uang lewat larangan
per-transaksi "tidak atas subjek sendiri" (sudah ada di `payouts.ts`, dipakai
lagi tiket 16). Tolak (2) — layar eksklusif menambah kompleksitas untuk
masalah yang aturan per-transaksi sudah menutup. (3) gabungkan jadi satu
navigasi, bagian tampil sesuai assignment yang dipegang — perubahan UI kecil.
Bukan gerbang Fase 2, aman ditunda setelah 02/11/12/13.

## ❓ **03 - Di mana dokumen yang diajukan tersimpan, siapa yang boleh melihat?** ([03](issues/03-documents.md))

Blocked by 01 — **01 sudah `resolved`**, jadi bisa diputuskan sekarang.
Diverifikasi: `/api/upload/route.ts` hanya menerima
`image/jpeg|png|webp`, menulis ke `public/uploads`, tanpa access control sama
sekali. §7.1 (11 dokumen wajib) tak punya satu dokumen di baliknya — Verifier
cuma centang label. (1) apa itu dokumen & di mana hidup — object storage
signed URL, database, atau disk host; (2) siapa boleh melihat — tidak seragam
antara Verifier/Fundraiser pemilik/Admin; (3) berapa lama hidup, apa terjadi
saat verifikasinya jadi tak relevan; (4) arti checklist tanpa dokumen — baris
nonaktif sampai ada dokumen, atau dicentang Verifier dengan dokumen opsional,
atau §7.1 dispesifikasi ulang jadi deklarasi.

➡️ Object storage dengan signed URL berumur pendek (bukan `public/uploads` —
gerbang keamanan, layak diprioritaskan walau bukan Fase 2 murni); Verifier +
Fundraiser pemilik + Admin saja yang melihat, tautan kedaluwarsa; dokumen dari
pengajuan ditolak tetap disimpan tapi tak publik; baris checklist nonaktif
sampai dokumen ada (opsi lain membuat verifikasi jadi formalitas — persis
kritik tiket 02). Besar, layak jadi tiket implementasi terpisah begitu
keputusan turun; tak memblokir gerbang Fase 2 (uang keluar) tapi memblokir
soft launch yang jujur.
