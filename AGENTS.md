# Agent tiering (anggaran token)

Sumber tunggal aturan model agent untuk proyek ini; `CLAUDE.md` mengimpornya.
Aturan proyek lainnya ada di `CLAUDE.md`.

## Peran dan model

| Peran | Model |
| --- | --- |
| Koordinator (lead orchestrator) | `opus` (keputusan owner 2026-09-27) |
| Builder tiket (TDD), code review pertama, riset, prototipe | `sonnet` |
| Re-review daftar perbaikan, sapuan dokumen, edit mekanis, pencarian kode | `haiku` |
| Eskalasi: kode keamanan, uang, atau konkurensi yang sulit, bila `sonnet` gagal atau review terus menemukan pelanggaran berat | `opus` |

Selalu isi `model` saat men-dispatch; subagent tidak pernah mewarisi model sesi.

## Dispatch

- Builder berjalan sebagai **subagent background** di sesi koordinator, dengan
  worktree sendiri (keputusan owner 2026-09-27); cloud session terpisah hanya
  bila owner memintanya.
- Paling banyak 3 builder sekaligus (container 4 vCPU).
- Sebelum dispatch, cocokkan baris "Blocked by" tiket dengan `**Status:**`
  tiap pemblokir; dispatch hanya bila semuanya `done`.
- Brief menunjuk path file, bukan menempel isi; minta laporan paling banyak
  ~200 kata.

## Review

- Builder menutup dengan `tdd` lalu `code-review` sendiri. Subagent tidak bisa
  men-dispatch subagent, jadi **review independen di-dispatch koordinator**:
  `sonnet` untuk review pertama, `haiku` untuk re-review.
- Diff di bawah ~300 baris: satu reviewer yang melaporkan tiap sumbu di bawah
  judulnya sendiri. Diff lebih besar: reviewer Standards dan Spec paralel.
- Kode uang, keamanan, atau konkurensi selalu mendapat review independen
  `sonnet`; perubahan dokumen saja atau perbaikan kecil dengan CI hijau boleh
  tanpa reviewer tambahan.
