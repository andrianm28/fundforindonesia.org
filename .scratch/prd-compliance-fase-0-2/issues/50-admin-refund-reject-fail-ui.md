# 50: UI Admin untuk menolak dan menandai gagal Refund

**Status:** done (PR #206, 96d9af3)

**Blocked by:** 49 (done)

Tiket 49 (PR #203) menambah `rejectRefund` dan `failRefund` beserta route Admin
untuk Campaign dan Volunteer Trip, tetapi belum ada tombol di halaman Admin.
Sampai tiket ini dikerjakan, kedua aksi hanya bisa dijalankan lewat API.

- [x] Tombol Tolak pada Refund REQUESTED/AWAITING_DONOR_DETAILS dan tombol
      Tandai gagal pada Refund APPROVED, masing-masing dengan isian alasan
- [x] Tombol disembunyikan bagi Admin yang dilarang aturan aktor (pembuat,
      pemberi approve, Fundraiser), dan pesan 403/409 dari route ditampilkan
- [x] Tes komponen untuk kedua aksi

## Comments

- 2026-10-03: owner menyetujui pengerjaan tiket ini; disampaikan koordinator
  dalam brief builder (status sebelumnya `needs-triage`).
- 2026-10-03, branch `claude/prd-50-refund-reject-fail-ui`: awaiting-merge; PR
  dan commit dicatat koordinator saat PR dibuka. Sebelum mulai, dipastikan
  bahwa di `3f8cb9a` (origin/main) belum ada UI untuk kedua aksi:
  `git grep -nE "refunds/.*/(reject|fail)" 3f8cb9a -- src/app src/components ':!src/app/api'`
  tidak menemukan apa pun.
  Keputusan implementasi:
  - Satu komponen `AdminRefundResolveForm` (`action` = `reject` atau `fail`)
    dipasang di `/admin/refunds/[id]` di samping form approve dan complete:
    Tolak untuk REQUESTED dan AWAITING_DONOR_DETAILS, Tandai gagal untuk
    APPROVED. Alasan wajib tidak kosong; batas panjangnya tetap milik server
    (400) dan tampil sebagai penolakan, angkanya tidak disalin ke klien.
  - Aturan aktor mengikuti `CONTEXT.md` dan tidak simetris: Tolak ditutup bagi
    pengaju Refund, Tandai gagal ditutup bagi pemberi approve (pengaju Refund
    APPROVED boleh menandai gagal), keduanya ditutup bagi Fundraiser subjek.
    Tombol diganti kalimat penjelas, pola yang sama dengan form approve dan
    complete. Pesan 403/409 dari route ditampilkan apa adanya, tanpa
    `router.refresh()`.
  - Halaman mengenali Fundraiser lewat `ownerId` baru pada `RefundSubjectInfo`
    (`creatorId` Campaign, `fundraiserId` Volunteer Trip), diisi
    `loadRefundSubject` dan `loadRefundSubjects`.
  - Akibat langsung di luar tiga acceptance: label status REJECTED dan FAILED
    tidak lagi bertuliskan "(belum dibangun)", dan kalimat pengantar
    `/admin/refunds` tidak lagi menyebut ditolak/gagal belum tersedia.
  Tes: `npx vitest run src/components/admin/AdminRefundResolveForm.test.tsx "src/app/admin/refunds/[id]/page.test.tsx" src/app/admin/refunds/page.test.tsx src/lib/refund-subject-lookup.test.ts src/lib/refund-status-label.test.ts`;
  `node ci/ratchet.mjs`: tsc 19 dan lint 193, sama dengan baseline. Full suite
  tidak dijalankan builder (CPU dipakai bersama builder lain); itu tugas CI.
  Belum dicakup, perlu keputusan owner: (1) halaman detail belum menampilkan
  siapa, kapan, dan alasan penolakan atau kegagalan; `rejectionReason` dan
  `failureReason` tersimpan tetapi tidak terbaca di UI. (2) Form approve dan
  complete belum menyembunyikan tombol bagi Fundraiser (penolakannya tetap
  dari server); hanya Tolak dan Tandai gagal yang melakukannya.
- 2026-10-03, review sendiri oleh builder (skill `code-review`; kedua sumbu
  dijalankan berurutan karena subagent tidak bisa men-dispatch subagent).
  Standards: satu temuan keras diperbaiki, yaitu teks UI dan komentar memakai
  "dana yang dibekukan" dan "frozen money" padahal istilah `CONTEXT.md` adalah
  Frozen Balance (dan "Dibekukan" adalah nama tampilan status Suspended);
  duplikasi di tes dirapikan dengan helper. Spec: ketiga acceptance terpenuhi,
  tidak ada yang kurang. Review independen tetap di-dispatch koordinator.
- 2026-10-03 (koordinator): PR #206, pekerjaan selesai di commit `8a32b71`.
  Review independen (sonnet, Spec dan Standards paralel) tanpa temuan blocking
  selain baris ini; tes jawaban 400 route (alasan terlalu panjang) ditambahkan
  ke `AdminRefundResolveForm.test.tsx`. Status menjadi `done` saat merge.

- 2026-10-03 (merge): PR #206 merge sebagai `96d9af3`, CI hijau, review independen diposting di PR. Lanjutan yang belum dicakup (menampilkan siapa dan alasan penolakan/kegagalan; menyembunyikan tombol approve/complete bagi Fundraiser) belum dijadikan tiket.
