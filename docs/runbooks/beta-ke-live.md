# Runbook: dari Beta ke uang nyata (go-live)

Dijalankan **owner** di host produksi. Agent tidak menyentuh host produksi dan tidak men-dispatch deploy (lihat `CLAUDE.md`). Asal: tiket 94 (`.scratch/rilis-1-benda/issues/94-beta-ledger-mode-and-simulation.md`), keputusan owner 2026-10-04/05. Penanda dan guard Sumopod dari tiket 92.

> **PERINGATAN: jangan aktifkan `BETA_SANDBOX=true` di produksi sebelum tiket 94 ter-deploy.**
> Tanpa 94, saldo Campaign, sapuan Escrow Hold, Payout, Refund, dan Provider Balance masih mencampur uang uji dengan uang nyata. Tiket 92 hanya menyaring Payment, bukan jalur Ledger. Urutan yang benar: deploy kode 94 (penanda masih mati), baru nyalakan penanda.

## Apa yang dimaksud Beta dan live

- **Beta**: `BETA_SANDBOX=true`. Sumopod hanya boleh sandbox (`https://api-pay-sandbox.sumopod.com`). Setiap Payment, entri Ledger, Payout, Refund, dan Usage Report yang lahir di masa ini dicap `sandbox = true`. Payout, Usage Report, dan Refund bisa disimulasikan penuh di layar, berlabel **UJI**, tanpa transfer nyata ke penyedia.
- **Live**: penanda dicabut, URL Sumopod live diisi. Baris yang sudah dicap `sandbox` **dikecualikan permanen** dari saldo, Payout, Impact & Transparency, rekap, dan Dormant. **Tidak ada data yang dihapus.**

Cap diambil dari baris sumbernya (Payment, Refund, Payout), bukan dari penanda saat itu. Jadi sapuan Escrow Hold, Refund, atau penyelesaian yang terjadi setelah go-live atas Payment beta tetap ber-cap sandbox, dan tidak masuk angka nyata.

Selama penanda aktif, dua hal ini **ditutup** karena memindahkan uang nyata dan tidak punya mode sendiri: Pengalihan dana Campaign (Campaign Transfer) dan Penarikan dari penyedia (Provider Withdrawal). Keduanya kembali normal setelah penanda dicabut.

## Sebelum mulai

1. Kode tiket 94 sudah ter-deploy, CI hijau, dan `main` berisi migrasi `20261005010000_sandbox_mode_columns`.
2. Cadangan basis data terbaru ada dan bisa dipulihkan (`docs/runbooks/restore.md`).
3. Simpan nilai `.env` produksi sekarang di tempat aman (tanpa menempelkannya ke repo atau chat).

## Urutan

Jalankan berurutan. Berhenti di langkah mana pun yang gagal; jangan lanjut.

### 1. Bekukan donasi sementara (opsional, disarankan)

Belum ada tombol pembekuan donasi; cara praktisnya, jadwalkan go-live di jam sepi dan umumkan jeda singkat. Pastikan tidak ada Payment baru yang masuk selama penggantian. Cek tidak ada Payment `PENDING` yang masih hidup:

```sql
SELECT id, "sandbox", status, "createdAt" FROM "Payment" WHERE status = 'PENDING' ORDER BY "createdAt";
```

Payment sandbox yang masih `PENDING` boleh dibiarkan kedaluwarsa. Webhook yang datang terlambat tetap memakai cap Payment-nya (sandbox).

### 2. Periksa rekonsiliasi di mode Beta

Masuk sebagai Admin, buka `GET /api/admin/reconcile`. Harus bersih untuk uang nyata:

- `unbalancedTransactions` kosong.
- `negativeBalances` dan `tripNegativeBalances` kosong.
- `mismatches` kosong.

Laporan ini hanya menghitung uang nyata. Data beta tidak muncul di sana kecuali di antrean Refund (ditandai `sandbox`).

Bila tidak bersih, **berhenti** dan selidiki dulu. Jangan go-live di atas angka yang tidak cocok.

### 3. Selesaikan atau biarkan antrean uji

Payout, Refund, dan Usage Report uji yang masih menggantung dikecualikan dari angka nyata. Pertama cek bahwa tidak ada **uang nyata** yang menggantung:

```sql
SELECT status, count(*) FROM "Payout" WHERE "sandbox" = false GROUP BY status;
SELECT status, count(*) FROM "Refund" WHERE "sandbox" = false GROUP BY status;
```

Cek juga Refund yang belum final (`AWAITING_DONOR_DETAILS`, `PROCESSING`) dan Payout `DRAFT`/`PENDING` ber-cap sandbox. **Tolak atau selesaikan Payout dan Refund sandbox yang masih menggantung sebelum go-live**: setelah rekening nyata dipakai, Payout sandbox yang masih `DRAFT` tidak boleh disetujui.

```sql
SELECT status, count(*) FROM "Payout" WHERE "sandbox" = true AND status NOT IN ('COMPLETED','REJECTED','FAILED') GROUP BY status;
SELECT status, count(*) FROM "Refund" WHERE "sandbox" = true AND status NOT IN ('COMPLETED','REJECTED','FAILED') GROUP BY status;
```

Hasil dua query pertama (uang nyata) harus kosong atau hanya berisi status akhir (`COMPLETED`, `REJECTED`, `FAILED`). Sebelum go-live biasanya memang kosong, karena belum ada uang nyata.

### 4. Ganti URL dan kredensial Sumopod ke live

Di `.env` produksi:

1. Isi `SUMOPOD_BASE_URL` dengan URL live.
2. Isi `SUMOPOD_API_KEY` dan `SUMOPOD_WEBHOOK_SECRET` dengan kredensial **live**.
3. Pastikan `PAYMENT_PROVIDER=sumopod`.

Guard boot memeriksa URL Sumopod saja, bukan API key; pastikan sendiri kunci yang diisi adalah kunci sandbox selama Beta. Jangan cabut penanda dulu bila kredensial live belum siap: guard boot menolak kombinasi penanda aktif dengan URL live, dan guard Sumopod menolak sandbox saat penanda mati. Dua guard ini sengaja saling mengunci, jadi go-live dilakukan **satu langkah**: cabut penanda dan isi URL live dalam satu penggantian `.env` dan satu restart.

### 5. Cabut penanda dan restart

1. Hapus `BETA_SANDBOX` (atau kosongkan) dari `.env` produksi.
2. Restart stack (owner, lewat prosedur deploy biasa).
3. Cek `GET /api/health` mengembalikan `{ "ok": true }`.

Bila boot gagal, pesan galatnya menyebut nama variabel yang salah (tanpa nilainya). Perbaiki `.env` dan restart; jangan mengembalikan penanda bersama URL live.

### 6. Verifikasi setelah live

1. Banner "Beta, tidak ada uang nyata" hilang dari beranda, konfirmasi donasi, dan Receipt baru.
2. Receipt lama yang Payment-nya ber-cap sandbox tetap memuat catatan beta. Itu disengaja.
3. Halaman Campaign tidak lagi menampilkan baris "Donasi uji", dan progres Campaign hanya uang nyata.
4. Buka `GET /api/admin/reconcile` lagi: harus tetap bersih.
5. Lakukan **satu donasi kecil nyata** milik owner, lalu pastikan:
   - Payment-nya `sandbox = false`;
   - entri Ledger-nya `sandbox = false`;
   - angka muncul di Campaign dan di rekonsiliasi.

```sql
SELECT p."sandbox" AS payment_sandbox, le."sandbox" AS ledger_sandbox, count(*)
FROM "Payment" p JOIN "LedgerEntry" le ON le."paymentId" = p.id
WHERE p."createdAt" > now() - interval '1 hour'
GROUP BY 1, 2;
```

Payment baru harus `false | false`. Baris `true | false` atau `false | true` berarti cap tidak konsisten: **hentikan donasi** dan laporkan.

6. Pastikan baris beta tetap utuh dan terpisah:

```sql
SELECT "sandbox", count(*) FROM "LedgerEntry" GROUP BY "sandbox";
```

## Yang tidak dilakukan

- Tidak ada penghapusan data beta. Data itu tetap ada, ber-cap sandbox, dan tidak masuk angka nyata mana pun.
- Saldo uji tidak bisa dipakai untuk Payout atau Refund nyata, dan sebaliknya. Tidak ada langkah memindahkan saldo uji ke saldo nyata.
- Tidak ada kembali ke Beta di atas data live yang sama. Bila perlu uji lagi, pakai lingkungan lain.

## Bila harus mundur

Mundur hanya aman **sebelum** ada Payment nyata pertama. Setelah itu, jangan menyalakan kembali penanda di basis data yang sama: guard boot akan menolak, dan donasi nyata yang ada tidak boleh bercampur dengan simulasi.

- Sebelum Payment nyata pertama: kembalikan `.env` dari cadangan langkah "Sebelum mulai" (penanda aktif, URL sandbox) dan restart.
- Sesudahnya: perbaiki ke depan (roll forward). Hubungi pengembang dengan hasil `GET /api/admin/reconcile`.
