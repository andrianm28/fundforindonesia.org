# 15: Aamiin anti-ganda + beranda kurasi manual

**Blocked by:** 12 (slot skema)

**Status:** ready-for-agent

**What to build:** Pasal 3.7(5)–(6), BERSYARAT, owner memutuskan dikerjakan (2026-11-09). (a) Aamiin: tabel per (doa, penanda) dengan unik; penanda = user id bila login, atau id anonim stabil dari cookie bertanda tangan bila tamu; `amiinCount` hanya naik bila baris baru; klien menampilkan status sudah-Aamiin. (b) Beranda kurasi: Admin menandai Campaign sebagai 'Pilihan' dan 'Unggulan kategori' (per kategori), serta menandai doa untuk 'Sorotan doa'; beranda memakai penandaan ini (urutan manual), jatuh ke perilaku otomatis sekarang bila belum ada penandaan. Penandaan tercatat siapa dan kapan.

- [ ] Test: Aamiin kedua oleh penanda yang sama tidak menambah
- [ ] Test: beranda memakai penandaan, fallback otomatis
- [ ] Layar Admin kurasi, non-Admin 404
