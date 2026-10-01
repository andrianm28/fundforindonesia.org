# 43: Sapuan untuk Refund Trip Fee yang tertahan setelah settlement terlambat

**Type:** implementation

**Status:** done

**Blocked by:** none (tiket 40 sudah di `main`)

## Why

Review independen tiket 40 (2026-09-29) menemukan celah yang sudah ada sebelumnya
dan diperluas tiket 40 ke kasus `EXPIRED`: di webhook settlement
(`src/app/api/webhooks/[provider]/route.ts`), `refundLateSettlement` dipanggil di
dalam try/catch setelah settlement ter-commit. Bila panggilan itu gagal, galatnya
hanya dicatat di log, peristiwanya sudah dianggap diproses, dan tidak ada yang
mengulang. Uang Volunteer tertahan diam-diam sampai ada orang yang menyadarinya.
Disetujui owner 2026-10-01 ("ya semua").

## Scope

- Satu fase baru pada job terjadwal (`runScheduledJobs`, dipanggil
  `POST /api/internal/jobs/run`) yang mencari Registration berstatus `CANCELLED`
  atau `EXPIRED` yang Payment-nya `PAID` tetapi belum punya Refund penuh, lalu
  memanggil `refundLateSettlement` untuk masing-masing. Baca dulu bagaimana
  `refundLateSettlement` dan `createRefund` menjaga idempotensi (pemeriksaan sisa,
  kunci Trip, Registration, Payment); sapuan hanya memanggil fungsi yang ada, tidak
  menulis ledger sendiri.
- Terbatas per putaran (batas jumlah baris), urut dari yang tertua, dan laporan
  hasil job memuat jumlah yang dicoba, berhasil, dan gagal (pakai nama
  `attemptedCount`, bukan `sentCount`, sesuai tiket 14).
- Kegagalan satu Registration tidak menghentikan yang lain, dan dicatat tanpa data
  pribadi (hanya id).
- Registration `CONFIRMED` tidak pernah disentuh. Registration yang Refund-nya
  sudah ada (apa pun statusnya) tidak dibuat ulang.
- Tidak ada layar baru; hasilnya terlihat di laporan job dan di `/admin/refunds`.

## Acceptance

- Tes: Registration `EXPIRED` dan `CANCELLED` dengan Payment `PAID` tanpa Refund
  mendapat satu Refund penuh; yang sudah punya Refund tidak mendapat kedua; yang
  `CONFIRMED` tidak disentuh; satu kegagalan tidak menghentikan sisanya; batas per
  putaran dihormati; dijalankan dua kali berturut-turut menghasilkan satu Refund.
- Tes terhadap Postgres sungguhan untuk dua sapuan bersamaan (pola
  `src/__tests__/integration/escrow-sweep-rotation.test.ts`), karena pengaman
  idempotensinya adalah kunci baris.
- Kode uang: review independen `sonnet` wajib, dan ketiga canary carry-trap harus
  sama dengan `main`.
