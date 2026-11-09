# Panduan Admin dan Verifier

Panduan ringkas per modul panel Fund for Indonesia, ditulis dari layar yang benar-benar ada di kode. Untuk istilah (Campaign, Payout, Escrow Hold, dst.) lihat [CONTEXT.md](../../CONTEXT.md). Untuk keadaan darurat lihat [runbooks/insiden.md](../runbooks/insiden.md).

## Dua panel, dua peran

| Panel | Alamat | Siapa | Catatan |
| --- | --- | --- | --- |
| Admin | `/admin` | Penugasan **ADMIN** | Selain itu mendapat halaman 404 |
| Moderasi (Verifier) | `/moderasi` | Penugasan **VERIFIER** | Satu orang boleh memegang keduanya |

Kekuasaan hanya datang dari penugasan, bukan dari peran akun ([ADR 0005](../adr/0005-roles-are-separate-assignments-not-a-hierarchy.md)). Admin dan Verifier tidak pernah bertindak atas Campaign, Volunteer Trip, atau rekening **miliknya sendiri**.

## Aturan dua orang (ringkasan)

| Tindakan | Siapa yang tidak boleh melanjutkan |
| --- | --- |
| Payout | Penyetuju bukan pengaju; penyelesai (bukti transfer) bukan penyetuju |
| Refund | Penyetuju bukan pembuat; penyelesai bukan pembuat dan bukan penyetuju |
| Kontribusi Manual | Pemutus bukan pencatat; pembalikan oleh Admin ketiga |
| Transfer antar Campaign | Pemutus bukan pencatat |
| Mencabut Suspension | Admin yang bukan pelaku Suspension |
| Memberi peran ADMIN | Diajukan satu Admin, dikonfirmasi Admin lain (bukan penerima) |

## Indeks modul

| Modul | Panduan | Layar utama |
| --- | --- | --- |
| Campaign dan moderasi | [campaign-dan-moderasi.md](campaign-dan-moderasi.md) | `/admin/campaigns`, `/admin/campaigns/lifecycle`, `/moderasi/campaigns` |
| Checklist verifikasi | [verifikasi-checklist.md](verifikasi-checklist.md) | `/admin/verification-checklist` |
| Partner Organisation dan izin | [partner-organisation-dan-izin.md](partner-organisation-dan-izin.md) | `/moderasi/partner-organisations`, `/moderasi/kind-authorisations`, `/moderasi/rekening`, `/admin/collecting-entities` |
| Penyaluran (Payout) | [penyaluran.md](penyaluran.md) | `/admin/payouts` |
| Refund | [refund.md](refund.md) | `/admin/refunds` |
| Rekonsiliasi | [rekonsiliasi.md](rekonsiliasi.md) | `/admin/reconciliation` |
| Keuangan dan rekap | [keuangan.md](keuangan.md) | `/admin/finance`, `/admin/dormant-balances`, `/admin/manual-contributions`, `/admin/campaign-transfers` |
| Kategori | [kategori.md](kategori.md) | `/admin/kategori` |
| Laman publik | [laman-publik.md](laman-publik.md) | `/admin/site-settings` |
| Pengguna dan peran | [pengguna-dan-peran.md](pengguna-dan-peran.md) | `/admin/users` |
| CSR dan Program | [csr-dan-program.md](csr-dan-program.md) | `/admin/partnership-inquiries`, `/admin/programs` |
| Volunteer Trip | [volunteer-trip.md](volunteer-trip.md) | `/admin/volunteer-trips`, `/moderasi/volunteer-trips` |
| Operasional | [operasional.md](operasional.md) | `/admin/operasional`, `/admin/payment-providers` |
| Fee, escrow, dan ambang | [biaya-escrow-ambang.md](biaya-escrow-ambang.md) | `/admin/platform-fee`, `/admin/escrow-hold`, `/admin/abuse-thresholds`, `/admin/scrutiny` |

Menu **Laporan** di panel Moderasi (`/moderasi/reports`) masih halaman "segera hadir", belum berfungsi.

Ringkasan PDF panduan ini dibuat di luar repo.
