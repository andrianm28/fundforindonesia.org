# 35: Collection account, provider withdrawal and per-provider reconciliation

**What to build:** The difference between money sitting at the provider and money in the bank becomes visible every day instead of being assumed away.

**Blocked by:** 27

**Status:** done (PR #108, a1889fe) -- landed as `pr93-carried`, not PR #93/`9e3e6d6`; correction per `prd-audit/issues/06`, Q2.

- [x] A collection account exists in the ledger, distinct from the Merchant Account and able to belong to a different legal entity
- [x] An Admin records a withdrawal from the provider to the collection account as a balanced journal
- [x] Reconciliation runs per provider and reports the provider balance against the ledger
- [x] Ledger entries carry Kind, provider and collecting entity, so reconciliation runs per provider and reporting runs per licence
- [x] Supports the invariant ADR 0011 depends on

## Comments

### Apa yang direkonsiliasi, dan dari mana

`GET /api/admin/reconcile` dapat blok `providerReconciliation`. Setiap angka di
dalamnya keluar dari ledger atau dari baris yang ditulis Admin; tidak ada yang
diturunkan dari `Campaign.collectedAmount`, dan tidak ada yang angka tersimpan.

- `pots` -- `providerBalances` (`src/lib/money/ledger.ts`) menjumlahkan
  `GATEWAY_CLEARING` per provider per direction. Debit-normal, karena Settlement
  yang DEBIT Provider Balance.
- `withdrawals` -- `reconcileProviderBalances`
  (`src/lib/money/provider-withdrawals.ts`) membandingkan, per penarikan
  tercatat, angka yang menurut buku keluar dari penyedia dengan angka yang
  menurut dashboard penyedia itu keluar, lalu menjumlahkannya per penyedia.
- `collectedByKind` -- sumbu lisensi, di-join `Campaign -> Donation -> Payment`,
  tidak pernah dibaca dari kolom.
- `collectionAccountBalance` dan `providerBalanceTotal` -- dua angka yang
  kalimat pembuka tiket ini sebenarnya tanyakan.

### MISMATCH: perlakuan yang dipilih

Ini keputusan yang diminta brief, dan lebih spesifik dari sekadar "report
aja". Yang dibandingkan adalah
`(providerBalanceBefore - providerBalanceAfter) - amount` per penarikan:
pembacaan diambil tepat sebelum dan tepat sesudah pergerakan, jurnal diposting
dalam transaksi yang sama dengan barisnya, jadi **kedua sisi menggambarkan
momen yang sama** dan bisa dikurangi dengan jujur. Selisihnya dilaporkan per
penarikan dan dijumlahkan per penyedia, dan tidak ada satu baris pun yang
ditulis ulang.

Tiga hal yang sengaja tidak dilakukan:

1. **Tidak memaksa `before - after` sama dengan `amount`.** Penyedia boleh
   menggerakkan saldo lebih dari yang kita ambil: biaya atas transfer,
   chargeback yang mendarat di jendela yang sama. Menolaknya berarti menolak
   catatan jujur atas justru hal yang dilaporkan. Mempipihkan salah satu
   angkanya supaya cocok menghapus bukti bahwa ada sesuatu di penyedia yang
   tidak cocok dengan buku.
2. **Tidak memakai `Payout.approvedProviderBalance` sebagai angka rekonsiliasi.**
   Itu pembacaan satu momen; saldo ledger adalah angka momen lain.
   Menguranginya menghasilkan angka yang terlihat seperti rekonsiliasi dan
   sebenarnya penjumlahan dua momen yang tidak berkaitan.
3. **Tidak pernah menulis jurnal apa pun.** Aturan yang sama dengan seluruh
   report ini: rekonsiliasi yang memperbaiki temuannya sendiri menghapus bukti
   apa yang rusak, dan di sistem uang bukti itu satu-satunya cara belajar apa
   yang bocor.

### Yang TIDAK direkonsiliasi, dan sengaja

- **Penyedia yang punya uang tapi belum pernah ada penarikan tercatat tidak
  muncul di `withdrawals`.** Itu berarti "belum ada yang cek", bukan "sudah cek
  dan cocok". Laporan ini tidak berhak menyajikan `0` untuk itu: yang nol
  adalah `divergence.totalDifference`, dan pembacanya harus cek
  `providersWithDivergence` dan daftar `withdrawals`, bukan menjadikannya
  laporan yang lulus.
- **Gerakan Provider Balance yang tidak menyebut provider** (Payout
  `COMPLETED`, dan Refund yang dibayar begitu tiket 32 selesai) tetap di
  bucket sendiri, tidak digabung ke penyedia mana pun.
  `perProviderIsExact` dan `unattributedBalance` menyatakannya, dan
  `providerBalanceTotal` -- bukan perpotongan per penyedia -- adalah angka yang
  ADR 0011 stating invariant-nya dengan. Lihat pertanyaan owner nomor 1.
- **Uang yang KELUAR tidak dipecah per Kind.** `collectedByKind` menghitung
  yang masuk saja, dan alasannya ada di komentar blok itu di `route.ts`.

### Interaksi dengan klaim `transactionId` (PR #82)

Ada **dua** klaim, karena mereka menolak dua hal berbeda, dan keduanya diuji:

- `ProviderWithdrawal.reference` UNIQUE. Inilah yang sebenarnya mencegah
  penarikan dicatat dua kali: penyedia memberi satu referensi per disbursemen,
  jadi referensi yang sama dua kali berarti uang yang sama diklaim dua kali.
  Penegakannya **index, bukan read-first** -- dua Admin yang mencatat entri
  dashboard yang sama di detik yang sama akan dua-duanya membaca "absent", dan
  hanya index yang menghentikan yang kedua sebelum mengurangi pot untuk kedua
  kali. Diklaim sebelum jurnal diposting, jadi klaim yang ditolak tidak
  mem-posting apa pun.
- `provider-withdrawal-<id>` pada `postTransaction`: klaim index yang biasa.
  Dalam operasi normal tidak terjangkau karena barisnya diklaim duluan, dan
  `recordProviderWithdrawal` **tidak** menangkap
  `DuplicateLedgerTransactionError`, jadi kegagalan tulis yang jujur tetap
  muncul sebagai kegagalan dan tidak diterjemahkan menjadi "sudah pernah".

### Interaksi dengan `GATEWAY_CLEARING` yang baru dikreditkan

Sebelum tiket ini Provider Balance hanya dikreditkan oleh dua pergerakan yang
**membayar uang ke luar** (Payout `COMPLETED`, PR #73; dan `refundPaidLegs`,
PR #83, yang belum punya pemanggil). Sekarang ada jalur ketiga, dan itulah yang
membuat "uang sudah sampai bank" sebuah baris, bukan asumsi.

`COLLECTION_ACCOUNT` dan `GATEWAY_CLEARING` sengaja **dua akun berbeda**:
Merchant Account milik PT Jaya Korpora Prima, rekening penghimpunan milik
Collecting Entity dan boleh milik badan hukum lain (ADR 0011). Kalau keduanya
satu, gerakannya tidak terlihat, dan gerakan yang tidak terlihat tidak bisa
dibedakan dari uang yang memang tidak pernah meninggalkan penyedia.

Satu uji sengaja dibuat untuk interaksi paling rapuh di diff ini: **sweep tidak
boleh menggerakkan halaman Impact sama sekali** (`src/app/api/impact/route.test.ts`).
Kedua kakinya platform-level dan tidak menyebut Payment, Refund, Payout, maupun
Campaign, jadi tidak satu pun dari enam baris Impact punya apa pun untuk
membacanya, dan hukum kekekalan
`collected = held + available + disbursed + returned + fees kept` tetap berlaku.
Kalau bentuk gerakan ini suatu saat mendapat salah satu dari itu, halaman akan
melempar `ImpactDoesNotReconcileError` alih-alih menyajikan enam angka yang
tidak berjumlah.

### FFI-07 story 53: saldo yang dicatat saat menyetujui Payout

Dicatat di `Payout.approvedProvider` + `approvedProviderBalance`, ditulis oleh
`updateMany` predicated yang sama yang menyetujui -- jadi tidak ada jendela di
mana Payout APPROVED tanpa angkanya di sampingnya, dan angka itu tidak bisa
direkonstruksi belakangan. `approvePayout` menolak yang tidak ada (422
`PROVIDER_BALANCE_NOT_RECORDED`) dan menolak yang kurang dari nominal Payout
(422 `PROVIDER_BALANCE_INSUFFICIENT`). Kedua route approve (Campaign dan
Volunteer Trip) mengirimnya, jadi tidak ada jalan menyetujui yang melewatinya.

**Penolakan yang kurang adalah pembacaan spec, bukan default yang dikarang.**
Story 53 berbunyi "supaya persetujuan diperiksa terhadap uang yang benar-benar
ada", dan hanya itulah yang bisa diperiksa: tidak ada penyedia yang punya API
saldo (ADR 0006), jadi angkanya manusia yang membaca dashboard, dan sistem tidak
memperlaim bisa memverifikasinya. Kalau owner mau yang lebih longgar -- catat
saja, jangan menolak -- itu perubahan satu baris di `payouts.ts` plus test-nya.
Payout DRAFT yang disetujui sebelum kolom ini ada tetap menyimpan `null`, dan itu
jawaban yang benar, bukan data yang belum terisi.

### Yang belum dikerjakan, dan alasannya

- **Kind tidak jadi kolom di `LedgerEntry`.** Box checklist kalimatnya "carry
  Kind, provider and collecting entity"; sisi provider memang kolom
  (`LedgerEntry.provider`, distempel di Settlement dan di penarikan, karena di
  dua gerakan itu provider adalah fakta). Sisi Kind **diturunkan** lewat join,
  dan itulah yang membuat `collectedByKind` bekerja dan teruji. Alasannya:
  `Campaign.kind` immutable, jadi salinannya tidak akan basi -- tapi tetap saja
  itu sumber kebenaran kedua untuk fakta yang sama, persis kelas yang repo ini
  sudah punya namanya (`Campaign.collectedAmount`). Kalau yang kedua ini yang
  salah, tidak ada yang bisa dibandingkan. Kolomnya bisa ditambahkan belakangan
  tanpa mengubah apa pun yang sudah ada: `PostOptions.provider` sudah jadi
  tempatnya.
- **`collectingEntityId` juga tidak jadi kolom di `LedgerEntry`**, dan ini yang
  sebelumnya tidak tercatat di mana pun. `spec.md:193` meminta entri jurnal
  membawa Kind, provider **dan** collecting entity; entri jurnal membawa Kind
  (diturunkan lewat join, di atas) dan provider (kolom), tapi **tidak punya
  kolom collecting entity sama sekali** -- bukan nullable, tidak ada. Yang ada
  adalah `ProviderWithdrawal.collectingEntityId`, yaitu kolom pada baris yang
  me-posting, dan entri menunjuk baris itu lewat
  `LedgerEntry.providerWithdrawalId`, jadi jawabannya bisa dibaca dari kaki
  jurnal.
  Alasannya sengaja: satu rekening penghimpunan bisa menerima dari lebih dari
  satu penarikan, dan "rekening ini milik badan hukum mana" berubah per
  penarikan, jadi menyalinnya ke tiap kaki jurnal akan menyimpan jawaban yang
  berubah di tempat yang tidak bisa ikut berubah -- kelas yang repo ini sudah
  punya namanya (`Campaign.collectedAmount`). Kolomnya bisa ditambahkan
  belakangan tanpa mengubah apa pun yang sudah ada: `PostOptions` sudah jadi
  tempatnya, sama seperti `provider`.
  Bedakan dengan bullet `collectingEntityId` opsional di bawah: itu soal
  apakah kolomnya pada `ProviderWithdrawal` boleh `null`, sedangkan ini soal
  entri jurnal yang tidak punya kolom itu.
- **Payout dan Refund yang mengikis Provider Balance tidak mencatat provider.**
  Lihat pertanyaan 1.
- **Tidak ada aturan dua orang untuk penarikan ke rekening.** Lihat pertanyaan 2.
- **Laporan ini dibuat saat dipanggil, bukan terjadwal harian.** Story 65
  meminta harian; `runScheduledJobs` adalah tiket 20/45 dan di luar PR ini.
- **`ProviderWithdrawal.collectingEntityId` opsional** (kolom pada baris
  penarikan, bukan pada entri jurnal -- lihat bullet di atas). Kalau rekening
  tujuan adalah milik Platform Operator sendiri, itu bukan Collecting Entity,
  dan kolomnya dibiarkan `null` alih-alih dipaksa jadi Partner Organisation.
  Yang bisa menjangkau keadaan itu cuma satu Admin yang mengisinya, dan tidak
  ada yang mengetahuinya selain catatan itu sendiri -- jadi ini sengaja
  dibiarkan terbuka, bukan dijawab.

### PERTANYAAN UNTUK OWNER

1. **Apakah `completePayout` dan pembayaran `Refund` harus mencatat provider
   yang membayar?** Today keduanya meng-credit `GATEWAY_CLEARING` tanpa menyebut
   provider, jadi angka per penyedia adalah **lantai**, bukan jumlah utuh, dan
   `perProviderIsExact` akan `false` pada setiap database yang pernah punya satu
   Payout selesai. Yang bisa dilakukan: `completePayout` (dan `completeRefund`
   nanti) menuntut nama provider, sama seperti `approvePayout` sekarang menuntut
   saldo. Memindahkan uang dari pot memang terjadi di dashboard provider, jadi
   provider-nya adalah fakta yang diketahui orang yang melakukannya -- hanya
   belum dicatat. Rekomendasi: **ya**, dan itu perubahan terkecil yang membuat
   rekonsiliasi per penyedia benar sepenuhnya; tanpa itu, begitu penyedia kedua
   aktif (FFI-18), tidak ada yang bisa tahu pot yang mana yang sebenarnya
   kosong. Perlu dicatat bahwa ini menyentuh jalur dua-orang yang sudah
   di-review di PR #73, jadi ticket 32 dan sesuatu untuk completion Payout akan
   ikut berubah.
2. **Apakah penarikan ke rekening perlu dua orang?** Fakta yang relevan: Payout
   punya dua orang karena satu orang bisa mengirim uang Campaign ke dirinya
   sendiri; Manual Contribution punya dua orang karena satu Admin bisa
   mengarang donasi. Keduanya tidak berlaku di sini -- uangnya going ke rekening
   bank milik sebuah badan yang namanya dicatat, bukan ke orang -- jadi
   `withAssignmentCheck(ADMIN)` saja yang dipakai, dan satu orang bisa mencatat
   seluruh penarikan. Rekomendasi: **tidak perlu dua orang** seperti sekarang,
   tapi hanya selama `destinationName` wajib dan badan hukumnya tercatat; kalau
   pemilik rekening bisa berarti "rekening orang", aturan ini salah. Tidak ada
   default yang saya pilih di sini.
3. **Apakah selisih yang berulang harus memblokir sesuatu?** Sekarang selisih
   hanya dilaporkan. Kalau ternyata sistematis -- misalnya ada biaya transfer
   yang selalu terpotong dan tidak pernah ada yang mencatatnya -- laporan ini
   akan perpetually menunjukkan angka yang tidak nol dan tidak ada yang
   memperingatkan. Pilihan yang mungkin: (a) tetap lapor saja; (b) blokir
   penarikan provider berikutnya sampai selisih dijelaskan; (c) blokir
   persetujuan Payout berikutnya. Rekomendasi: **(b)**, karena persetujuan Payout
   sudah meminta sebuah pembacaan dan menolak yang tidak cukup, sedangkan
   penarikan berikutnya adalah saat paling murah untuk berhenti. Tidak ada
   default yang saya pilih di sini.
