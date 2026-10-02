# 50: Volunteer bisa menahan seat di banyak Batch tanpa pembayaran (seat-hoarding)

**Type:** implementation (keamanan)

**Status:** needs-triage

**Blocked by:** PR #161

## Why

Audit keamanan menemukan celah: Volunteer bisa membuat hold registrasi di banyak Batch sekaligus tanpa batasan, menghabiskan seat untuk Volunteer lain selama 30 menit, lalu mengulanginya tanpa rate limit.

Detail teknis disimpan owner di luar repo publik.

## Scope

- Volunteer hanya boleh memiliki satu HOLD aktif (owner memilih: per Trip atau global)
- Rate limit pada pembuatan HOLD untuk mencegah spam

## Acceptance

- Tes: Volunteer dengan HOLD aktif ditolak membuat HOLD baru
- Tes: HOLD yang hangus tidak menghalangi HOLD baru
- Tes: Rate limit berfungsi
- PR #161 harus merge terlebih dahulu
