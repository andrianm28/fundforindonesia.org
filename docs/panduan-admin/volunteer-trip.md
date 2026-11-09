# Volunteer Trip

**Layar:** Moderasi > Volunteer Trip (`/moderasi/volunteer-trips`, detail `/moderasi/volunteer-trips/[id]`); Admin > Penangguhan Volunteer Trip (`/admin/volunteer-trips`). Sisi Fundraiser: `/akun/volunteer-trip`.
**Siapa:** Verifier meninjau pengajuan. Admin menangguhkan dan mencabut penangguhan.

Volunteer Trip adalah entitas terpisah dari Campaign ([ADR 0014](../adr/0014-volunteer-trip-stays-separate-entity.md)): Volunteer membayar **Trip Fee** untuk biaya partisipasinya sendiri; uang ini bukan donasi tetapi memakai jalur Payment, Escrow Hold, dan Payout yang sama. Pendaftaran berbayar hanya terbuka bila `NEXT_PUBLIC_VOLUNTEER_ENABLED` aktif.

## Meninjau pengajuan (Verifier)

1. Buka **Volunteer Trip Menunggu Review** (terlama lebih dulu) dan pilih Trip.
2. Baca isi dan Batch. Trip yang Submitted tidak bisa diedit, jadi yang Anda baca adalah yang diputuskan.
3. **Loloskan**, atau **Tolak** dengan **Alasan penolakan** (tombol Tolak aktif setelah alasan ditulis). Fundraiser dapat memperbaiki Trip Draft atau Rejected dan mengajukan lagi.
4. Verifier tidak memutuskan Trip miliknya sendiri.

## Menangguhkan dan mencabut (Admin)

1. Di `/admin/volunteer-trips`, Trip Active adalah kandidat **Tangguhkan Trip**; Trip Suspended adalah kandidat **Cabut Penangguhan**. Isi alasan.
2. Penangguhan tidak berasal dari Flag dan **tidak pernah oleh Admin pemilik Trip itu**.
3. **Mencabut** hanya oleh Admin yang **bukan** pelaku penangguhan; tombolnya tidak ditawarkan kepada pelaku, dengan keterangan alasannya.

## Hal yang perlu diwaspadai

- Selama Suspended: tidak ada Registration baru dan tidak ada Payout Trip Fee. Registration yang ada, termasuk Confirmed, **tidak dibatalkan atau di-refund otomatis**; Trip Fee yang settle atas kursi yang sudah ditahan tetap mengonfirmasi kursinya.
- Payout Trip Fee hanya atas dana Batch yang sudah `COMPLETED` ([penyaluran.md](penyaluran.md)). Dana Batch yang belum selesai masih bisa di-refund ke Volunteer ([refund.md](refund.md)).
- Pendaftaran berbayar ikut berhenti bila saklar donasi dimatikan ([operasional.md](operasional.md)).
