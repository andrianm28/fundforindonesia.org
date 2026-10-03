# 33: Campaign-to-campaign transfer for zakat and wakaf suspension

**What to build:** When a zakat or wakaf Campaign is suspended, its funds move to another Campaign of the same Kind rather than returning to Donors, which is the rule the platform currently has no way to honour.

**Blocked by:** 11, 32 (30 dilepas, lihat Comments)

**Status:** awaiting-merge

- [x] Zakat and wakaf are not refundable by management decision, only on technical failure: wrong payment, double payment, or money arriving after closure
- [x] A suspended zakat or wakaf Campaign transfers its funds to another Campaign of the same Kind, and for wakaf the same category
- [x] A cross-Kind transfer is refused outright, not warned about
- [x] The transfer is a balanced journal under the two-person rule, never a balance edit
- [x] Every affected Donor is told where their money went
- [x] Built here because the suspension rule cannot work without it; Dormant Balance handling reuses this mechanism later

## Comments

- 2026-10-02 (triase owner, blocker dilepas): tiket 30 berstatus `wontfix` karena
  lingkupnya sudah dipindah ke spec `campaign-status-transitions/` (transisi
  Suspension dan Lift, effective status `SUSPENDED`) dan
  `subject-guard-and-suspension-money/` (subject guard, Payout/Escrow beku
  saat Suspended, Refund tetap boleh). Keduanya sudah dibaca sebagai konteks;
  tiket ini hanya bergantung pada `lockAndLoad`/`effectiveStatus` dari guard dan
  pada status SUSPENDED, yang sudah ada di `main`. Tiket 11 dan 32 sudah `done`.
- 2026-10-02 `claude/prd-33-kind-transfer`: dibangun sebagai `CampaignTransfer`
  (model, migrasi `20261003020000_add_campaign_transfer`), modul
  `src/lib/money/campaign-transfers.ts`, dua route Admin
  (`/api/admin/campaign-transfers`, `.../[id]/decision`, terdaftar di
  `roles-expand-guard.test.ts`), builder jurnal `campaignTransferLegs`, entri
  `Campaign Transfer` di `CONTEXT.md`. Keputusan implementasi:
  - Acceptance 1 (zakat/wakaf tidak bisa di-refund atas keputusan manajemen)
    sudah ditegakkan `REFUND_ELIGIBILITY_BY_KIND` di `refunds.ts` sejak tiket 31;
    tidak diubah.
  - `judgeCampaignTransfer` (fungsi murni di domain) menegakkan Kind: sumber
    harus ZAKAT/WAKAF, tujuan Kind sama, wakaf Category sama, tujuan Active dan
    bukan Demo, bukan Campaign yang sama. Dinilai saat permintaan dan dinilai
    ulang saat persetujuan di bawah lock, jadi Suspension yang dicabut di antara
    keduanya tetap menghentikan uang. Lintas Kind dijawab 403
    `CAMPAIGN_TRANSFER_CROSS_KIND`, bukan peringatan.
  - Dua Campaign dikunci lewat `lockAndLoad` dalam urutan id menaik (bukan
    urutan peran), jadi dua transfer yang bersilang tidak deadlock; tidak ada
    Payment yang dikunci, sehingga urutan subjek-dulu `escrow.ts`/`payouts.ts`
    tetap berlaku.
  - Jurnal: satu transaksi `campaign-transfer-<id>`, DEBIT CAMPAIGN_BALANCE
    asal, CREDIT CAMPAIGN_BALANCE tujuan, kedua baris bertanda
    `campaignTransferId`; tidak ada penyuntingan saldo. Yang berpindah hanya
    saldo yang bisa dicairkan; Escrow Hold yang belum matang dan dana beku
    Refund tetap di asal. `collectedAmount` tidak diubah di kedua sisi (angka
    itu rekonsiliasi dari Settlement dan Manual Contribution, jadi
    `/api/admin/reconcile` tidak berubah dan penulis `collectedAmount` tidak
    bertambah).
  - Donor diberi tahu: Notification dalam transaksi yang sama untuk Donor
    terdaftar di Campaign asal dan kedua Fundraiser; Donor Tamu dikirimi email
    setelah commit (gagal kirim dicatat, tidak membatalkan transfer; Donor
    Tamu yang sudah dianonimkan dilewati).
  - Dormant Balance memakai ulang `judgeCampaignTransfer`, `campaignTransferLegs`,
    dan modelnya; yang perlu ditambah hanya penilaian status sumber (Expired
    atau Completed) dan pemicunya.
  - Pemeriksaan: migrasi diterapkan ke Postgres sungguhan lewat
    `npm run ci:local -- migrations` (tanpa drift skema).
- 2026-10-02 **Pertanyaan ke owner** (dijawab 2026-10-03, lihat entri terakhir):
  aturan dua orang tanpa Admin ketiga, nominal parsial, persetujuan Campaign
  tujuan, dan belum adanya layar Admin atau antrean di `/api/admin/reconcile`.
  Layar Admin dan antrean reconcile tetap belum ada (hanya API).
- 2026-10-02 (perbaikan review PR #191), centang acceptance dan buktinya:
  - [x] Zakat/wakaf tidak bisa di-refund atas keputusan manajemen: sudah
    ditegakkan `REFUND_ELIGIBILITY_BY_KIND` dan diuji `refund-kind-gate.test.ts`
    sejak tiket 31; tiket ini tidak mengubahnya.
  - [x] Transfer ke Kind sama (wakaf sekategori): `campaign-transfers.test.ts`
    dan tes real-DB `campaign-transfer-real-db.test.ts`.
  - [x] Lintas Kind ditolak mentah-mentah: tes tabel di service (403
    `CAMPAIGN_TRANSFER_CROSS_KIND`) dan di route.
  - [x] Jurnal seimbang dengan aturan dua orang: tes service; dua approval
    paralel dari sumber yang sama lolos tepat satu, dan transfer paralel dengan
    Refund tidak deadlock dan buku tetap seimbang (real-DB, dijalankan lokal
    terhadap Postgres, CI menjalankannya dengan `TEST_DATABASE_URL`).
  - [x] Donor diberi tahu: tes Notification dan email Donor Tamu.
  - Tambahan: Escrow Hold dan dana beku Refund terbukti tidak ikut pindah;
    perubahan Kind/Category setelah request menolak approval (alur edit nyata
    menolak Kind setelah Draft lewat `requireKindAndDeadlineEditable`; Category
    hanya bisa lewat Admin, diuji langsung di DB); body bertipe salah di kedua
    route menjawab 400. Payout paralel tidak diuji: Payout butuh Bank Account
    terverifikasi terenkripsi, dan Refund sudah membuktikan serialisasi lewat
    kunci subjek yang sama.
  - Akar kegagalan CI `test` di a0e8379: `campaign-status-readers.test.ts`
    ("legacy Campaign status column is named by no src file"). Detektornya
    mengatribusikan tipe Prisma berdasarkan awalan nama `Campaign`, sehingga
    kolom `status` milik model baru `CampaignTransfer` terhitung sebagai kolom
    `status` lama Campaign. Diperbaiki dengan parameter `excludeModels` di
    `tests/support/prisma-field-references.ts`, bukan dengan menonaktifkan tes.
- 2026-10-03 `claude/prd-33-kind-transfer` (keputusan owner "setuju semua"; tidak ada lagi yang menunggu owner):
  1. Nominal transfer **penuh**: seluruh saldo yang bisa dicairkan. Request tidak
     lagi menerima `amount`; server menghitungnya di bawah lock kedua Campaign
     dan menyimpannya di `CampaignTransfer.amount`. Sumber tanpa saldo
     bisa-cair ditolak (`INSUFFICIENT_BALANCE`). Saat approve nominal dihitung
     ulang di bawah lock; bila saldo bisa-cair berbeda dari nominal request
     (naik atau turun), **approve ditolak** dengan 409
     `CAMPAIGN_TRANSFER_BALANCE_CHANGED`, tidak ada yang berpindah, dan
     transfer tetap PENDING. Pilihan paling aman: memindahkan nominal lama bisa
     menarik lebih dari saldo atau menyisakan dana, sedangkan memindahkan
     nominal baru berarti menyetujui jumlah yang tidak pernah dilihat Admin
     pemohon. Admin menolak request itu lalu mengajukan yang baru.
  2. Persetujuan Campaign tujuan tidak diperlukan; aturan dua Admin berbeda
     tetap.
  3. Escrow Hold yang matang sesudah transfer dipindahkan lewat transfer
     lanjutan: request baru dengan aturan sama, diizinkan walau sudah ada
     transfer APPROVED dari sumber yang sama (tes unit dan real-DB; tes real-DB
     dilewati tanpa `TEST_DATABASE_URL`, CI menjalankannya).
  4. Migrasi di-rename (git mv) ke `20261003020000_add_campaign_transfer`
     (SQL tidak berubah) agar bertimestamp setelah
     `20261003010000_payment_provider_setting` (#195); rujukan diperbarui.
