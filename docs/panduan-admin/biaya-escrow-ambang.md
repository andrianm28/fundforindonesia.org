# Platform Fee, Escrow Hold, dan ambang penyalahgunaan

**Layar:** Admin > Platform Fee (`/admin/platform-fee`), Escrow Hold (`/admin/escrow-hold`), Ambang Penyalahgunaan (`/admin/abuse-thresholds`), Penanda Audit dan Donasi (`/admin/scrutiny`). API di bawah `/api/admin/` dengan nama yang sama.
**Siapa:** Admin.

Semua aturan di sini bersifat **tambah-saja**: mengubah nilai menambah baris baru dan baris terbaru yang berlaku; riwayat beserta siapa dan kapan tetap terlihat.

## Platform Fee

Potongan persentase dari Donation yang diambil platform, ditampilkan terbuka di halaman Campaign. Setiap Payment menyimpan fee yang berlaku **saat Payment dibuat**.

1. Pilih target: **Kind** (donasi, wakaf, hibah), **Category** (override), **Campaign** (override), atau **Ambang** pembebasan.
2. Isi persen (mis. `2,5`; layar mengubahnya ke basis poin 0 sampai 10000) atau nominal ambang (rupiah bulat, tidak negatif), simpan.
3. Urutan prioritas: Campaign mengalahkan Category, Category mengalahkan Kind. Donasi di bawah ambang dibebaskan dari fee.

Kind tanpa baris tertulis **belum diatur** dan dihitung 0: layar tidak mengarang angka bawaan.

## Escrow Hold

Masa tunggu sebelum dana Net bisa diminta sebagai Payout. Panjangnya **1 sampai 30 hari**; tanpa baris, berlaku bawaan kode. Atur bawaan atau per Category (mis. dipendekkan untuk bencana). Lamanya dibekukan pada tiap Payment saat dibuat, jadi perubahan tidak berlaku mundur. Selama Campaign Suspended, pelepasan dana tertahan dan berlanjut setelah Suspension dicabut. Pelepasan dijalankan pekerjaan terjadwal (`/api/internal/jobs/run`).

## Ambang penyalahgunaan

Empat batas yang diawasi platform; bila tidak diatur, berlaku angka PRD:

| Batas | Bawaan | Efek bila terlampaui |
| --- | --- | --- |
| Gross Campaign untuk Verifikasi Tambahan | Rp100.000.000 | Sistem membuka pengajuan ulang ke Verifier (sekali seumur Campaign) |
| Gross Campaign untuk Penanda Audit | Rp500.000.000 | Penanda dipasang (sekali seumur Campaign); tidak membekukan |
| Nominal satu Donation untuk Penanda Donasi | Rp50.000.000 | Penanda pada Donation itu |
| Campaign aktif per Fundraiser | 3 | Batas jumlah Campaign aktif per Fundraiser |

Kemiripan judul untuk Petunjuk Duplikat bukan bagian layar ini.

## Penanda Audit dan Donasi (hanya baca)

`/admin/scrutiny` mendaftar penanda yang ditulis sistem saat Donation settle melewati batas. Tidak ada tombol menolak atau membalikkan, dan tidak ada data Donor di dalamnya (hanya id Donation dan tautan Campaign). Angka tidak memuat uang sandbox.

## Hal yang perlu diwaspadai

- Perubahan fee dan escrow memengaruhi **Payment berikutnya**, bukan yang sudah dibuat.
- Angka fee pemilik masih berupa rekomendasi; jangan mengisi nilai tanpa keputusan owner.
- Nilai di layar adalah nilai yang berlaku, dibaca dengan aturan yang sama dengan server.
