# Tiket tertunda (definisi terpotong di pesan relay)

Rencana asli (`plan.md`, Track B) terpotong di pesan relay sesi VPS. Tiket berikut belum ditulis karena isinya tidak ada di rencana dan tidak ditebak. Koordinator meminta definisinya ke owner/sesi VPS.

| ID | Yang diketahui dari rencana | Yang hilang |
|---|---|---|
| P1, P2 | Baris "Menuju M1"; dikerjakan builder Gelombang 0 | Judul, isi, ukuran |
| A-1 | Prasyarat gladi tertutup bersama M-a (C1). Kemungkinan terkait Admin yang tidak bisa melihat nomor rekening tujuan Payout (`src/app/admin/payouts/[id]/page.tsx:70`) dan keputusan C6 (reveal hanya Admin penyelesai, tercatat di tabel audit). Ini dugaan topik, bukan definisi | Seluruh baris |
| M-a | Memakai "slot skema" Gelombang 1; prasyarat gladi tertutup (C1) | Judul, isi, ukuran |
| E1 | Item perluasan; C23: domain/prefix tautan pendek | Baris tabel |
| E2 | C23: dasar legal aturan 180 hari | Baris tabel |
| E3 | C23: jendela waktu, batas per Kind, anti-abuse | Baris tabel |
| E4 | C23: peran anggota; apakah anggota boleh minta Payout (rekomendasi: tidak) | Baris tabel |
| E5 | Disebut di Gelombang 4 ("lalu E5") | Seluruh baris |
| E6 | C23: BSP + biaya, model consent; Gelombang 5, WhatsApp | Baris tabel |
| E7 | C23: next-intl, slug tetap Indonesia; Gelombang 5, i18n sendirian | Baris tabel |
| E8 | C23: sub-pertanyaan dari tiketnya; Gelombang 4 | Baris tabel |

Catatan: rencana juga terpotong pada daftar "Tidak boleh berjalan bersamaan" setelah "M-e dengan F4". Tiket 72 (F4) dan 81 (M-e) mencatat batasan yang terlihat.

Setelah definisi tersedia, tulis tiketnya di `.scratch/rilis-1-benda/issues/` (mulai 86) untuk P1, P2, A-1, M-a, dan di `.scratch/fase-3-perluasan/issues/` (mulai 02) untuk E1-E8. Lalu perbarui `peta-tiket.md` dan baris `Built by:` di rilis-1-benda 04, 05, dan 12.
