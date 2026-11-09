# Konfigurasi penyedia eksternal

Daftar penyedia yang dipakai platform dan **nama** variabel lingkungan untuk masing-masing. Hanya nama: nilai asli ada di `.env` host produksi milik owner dan tidak pernah masuk repo (repo ini publik). Komentar rinci tiap variabel ada di [`.env.example`](../.env.example). Mengubah variabel di host produksi adalah langkah owner; variabel `NEXT_PUBLIC_*` ditanam saat build, jadi butuh build ulang image.

## Sumopod (pembayaran)

Referensi teknis adapter, metode pembayaran, biaya, dan webhook: [integrasi-sumopod.md](integrasi-sumopod.md). Keputusan: [ADR 0006](adr/0006-provider-neutral-payments-sumopod-first.md), [ADR 0011](adr/0011-separate-merchant-account-from-makam.md).

| Variabel | Fungsi |
| --- | --- |
| `PAYMENT_PROVIDER` | Provider bawaan untuk charge dan payout baru: `mock` atau `sumopod`. Pilihan Admin di **Admin > Penyedia Pembayaran** mengalahkannya |
| `SUMOPOD_API_KEY` | Kunci API (header `X-Api-Key`) |
| `SUMOPOD_WEBHOOK_SECRET` | Rahasia verifikasi tanda tangan webhook. Wajib: kosong berarti webhook ditolak |
| `SUMOPOD_BASE_URL` | Alamat API; bawaan `.env.example` adalah sandbox |
| `PAYMENT_LINK_ALLOWED_HOSTS` | Host yang boleh dituju tautan pembayaran tersimpan (opsional) |
| `NEXT_PUBLIC_DONATIONS_ENABLED` | Gerbang keras donasi, harus persis `true` |
| `BETA_SANDBOX` | Penanda Beta (hanya sandbox); dilepas saat live, lihat [beta-ke-live.md](runbooks/beta-ke-live.md) |
| `MOCK_MIDTRANS_SERVER_KEY`, `ALLOW_MOCK_PAYMENT_PROVIDER` | Provider mock untuk pengembangan. **Tidak boleh ada di `.env` produksi** |

Endpoint webhook yang didaftarkan di dashboard Sumopod: `/api/webhooks/sumopod` pada alamat publik situs. Penanganan webhook gagal: [runbooks/insiden.md](runbooks/insiden.md) dan [runbooks/payment-reconciliation.md](runbooks/payment-reconciliation.md).

## Email (SMTP)

| Variabel | Fungsi |
| --- | --- |
| `MAIL_PROVIDER` | `mock` atau `smtp`. Kosong: mock di pengembangan dan tes, `smtp` di produksi |
| `SMTP_HOST`, `SMTP_PORT` | Relay dan port (bawaan 465) |
| `SMTP_SECURE` | `true` atau `false`; kosong berarti `true` di port 465, `false` di port lain |
| `SMTP_USER`, `SMTP_PASSWORD` | Kredensial relay |
| `MAIL_FROM` | Alamat pengirim |
| `PARTNERSHIP_TEAM_EMAIL` | Kotak tim kemitraan yang menerima notifikasi Partnership Inquiry |

Di produksi, nilai yang kurang dicatat sebagai `mail_not_configured` pada setiap email yang dicoba; keputusan bisnis tetap tersimpan, hanya emailnya yang tidak terkirim. Alamat kontak publik (`halo@...`, `privasi@...`) ada di `src/lib/site-identity.ts`, bukan di env.

## GlitchTip / Sentry (pemantauan galat)

| Variabel | Fungsi |
| --- | --- |
| `SENTRY_DSN` | DSN server Sentry-kompatibel (GlitchTip). Kosong: tidak ada pelaporan dan tidak ada panggilan jaringan |

Hanya sisi server, tidak pernah `NEXT_PUBLIC_`. Galat browser diteruskan lewat `POST /api/client-error`. Event dibersihkan dari email, nomor rekening, token, dan header autentikasi sebelum dikirim.

## Login Google

| Variabel | Fungsi |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Login Google aktif hanya bila keduanya terisi. Login Google tidak memverifikasi email ([ADR 0022](adr/0022-google-sign-in-does-not-verify-email.md)) |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | Alamat dan rahasia next-auth; URL callback OAuth mengikuti `NEXTAUTH_URL` |

## Backup

Backup bukan variabel lingkungan: ia dijalankan owner di host (dump harian, salinan offsite terenkripsi, latihan restore per kuartal). Prosedur: [runbooks/backup-dan-restore.md](runbooks/backup-dan-restore.md) dan [runbooks/restore.md](runbooks/restore.md). Alat, lokasi, dan kunci backup hanya diketahui owner. `ops/deploy.sh` ikut membuat dump pra-migrasi (7 terakhir), tetapi itu alat rollback, bukan backup.

## Key enkripsi field

`FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID`, `FIELD_HMAC_KEY`, `FIELD_HMAC_KEY_ID`, plus `FIELD_ENCRYPTION_PREVIOUS_KEYS` dan `FIELD_HMAC_PREVIOUS_KEYS` saat rotasi. Wajib lengkap: tanpa itu aplikasi menolak menulis kontak donor dan fundraiser. Simpan terpisah dari backup. Skema: [ADR 0012](adr/0012-field-level-encryption-scheme.md); rotasi: [runbooks/rotasi-kunci-field.md](runbooks/rotasi-kunci-field.md).

## Lain-lain

| Variabel | Fungsi |
| --- | --- |
| `JOBS_SECRET` | Rahasia header `x-jobs-secret` untuk `POST /api/internal/jobs/run` (pelepasan Escrow Hold dan pengingat); scheduler di host memakai nilai yang sama |
| `RATE_LIMIT_SECRET`, `TRUSTED_PROXY_HOPS` | Pembatas laju endpoint publik; hop proxy tepercaya |
| `NEXT_PUBLIC_BASE_URL` | Alamat publik kanonis (ditanam saat build) |
| `DONOR_REFUND_*` | Batas Refund yang diminta Donor; fitur mati bila tidak diisi |
