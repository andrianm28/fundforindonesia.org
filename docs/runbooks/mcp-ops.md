# Runbook: server MCP ops (read-only) di host produksi

Server kecil yang membuat sesi Claude di Project bisa **membaca** status produksi lewat HTTPS, tanpa SSH dan tanpa shell. Kodenya: `ops/mcp-ops/server.mjs` (tanpa dependency, Node 24). Dokumen ini sengaja generik: hostname, IP, dan token hanya diketahui owner (repo ini publik).

**Status: usulan, belum dipasang.** Memasangnya adalah **langkah owner** di host produksi. Tidak ada thread atau agent yang memasangnya. Aturan di `CLAUDE.md` (agent tidak menyentuh stack produksi) tetap berlaku; server ini hanya menyediakan jalur baca sempit yang owner pilih sendiri.

## Yang ditawarkan

Empat tool, semuanya baca-saja dan berisi tetap:

| Tool | Isi |
| --- | --- |
| `health` | Status HTTP dari `/api/health` di host. |
| `deploy_status` | SHA dan digest rilis yang berjalan dan rilis sebelumnya (`state/current`, `state/previous`). |
| `deploy_log_tail` | N baris terakhir `logs/deploy.log` (maks 200), kredensial dimasker. |
| `backups` | Nama, ukuran, dan waktu berkas di `backups/`. Tidak pernah isinya. |

Yang **sengaja tidak ada**: shell, query database, `.env`, log container (bisa memuat data donor), deploy, restart.

## Pasang (langkah owner)

Semua langkah ini mengubah host produksi, jadi hanya owner (atau agent servernya atas perintah owner) yang menjalankannya. Host harus punya **Node 24** (aplikasi berjalan di Docker, jadi Node di host belum tentu ada; pasang dari sumber resmi atau jalankan server ini di container `node:24-slim` yang hanya me-mount tiga folder di bawah secara read-only dan membuka port ke `127.0.0.1`).

1. Buat user sistem khusus `mcp-ops` (bukan `deploy`, bukan root): tanpa shell login, tanpa sudo, tanpa grup docker.
2. **Beri hak baca.** `ops/deploy.sh` memakai `umask 077`, jadi `state/`, `logs/`, dan `backups/` milik `deploy` bermode 700 dan berkas di dalamnya 600; user `mcp-ops` tidak bisa membacanya, dan tiga tool file akan selalu menjawab "not readable". Beri akses baca-saja lewat ACL, termasuk default ACL supaya berkas yang dibuat deploy berikutnya ikut terbaca, dan izin lewat (traverse) pada folder induk:

   ```bash
   setfacl    -m  u:mcp-ops:--x <DEPLOY_DIR>
   # state dan logs: baca penuh, termasuk berkas baru (default ACL)
   setfacl -R -m  u:mcp-ops:rX  <DEPLOY_DIR>/state <DEPLOY_DIR>/logs
   setfacl -R -d -m u:mcp-ops:rX <DEPLOY_DIR>/state <DEPLOY_DIR>/logs
   # backups: hanya daftar nama/ukuran/waktu (r-x pada folder), TANPA hak baca pada berkas dump
   setfacl    -m  u:mcp-ops:r-x <DEPLOY_DIR>/backups
   ```

   Jangan memberi akses ke `.env` atau folder lain. Dump di `backups/` berisi data donor, karena itu ACL di atas sengaja **tidak** diberikan pada berkasnya: `mcp-ops` bisa melihat nama dan ukuran (cukup untuk tool `backups`) tetapi tidak membaca isinya. Jangan menambah `-R` atau default ACL pada `backups/`. Setelah deploy berikutnya, cek dengan `getfacl` bahwa `state/` dan `logs/` baru tetap terbaca dan dump baru tetap tertutup.
3. Buat token acak panjang (minimal 32 karakter): `openssl rand -hex 32`. Simpan hanya di `/etc/mcp-ops.env` (izin 600, milik root) dengan isi `MCP_OPS_TOKEN=...` dan `DEPLOY_DIR=...`, bukan di repo.
4. Jalankan sebagai service systemd dengan `ExecStart=<path absolut node> <path absolut repo>/ops/mcp-ops/server.mjs`, `User=mcp-ops`, `EnvironmentFile=/etc/mcp-ops.env`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`, `ProtectHome=read-only` (hanya relevan bila `DEPLOY_DIR` ada di `/home`), `ReadOnlyPaths=` ke tiga folder di atas. Opsional: `HEALTH_URL` (default `http://127.0.0.1:8093/api/health`), `HOST` (default `127.0.0.1`), `PORT` (default `8787`). `DEPLOY_DIR` wajib; server menolak start tanpanya.
5. Di nginx, buat subdomain khusus dengan TLS, `proxy_pass` ke `127.0.0.1:8787` hanya untuk path `/mcp`, `limit_req` yang ketat, dan `allow 160.79.104.0/21; deny all;` (lihat di bawah).
6. Uji dari luar: tanpa token harus `401`; dengan `Authorization: Bearer <token>`, `tools/list` mengembalikan empat tool. Server hanya menerima awalan `Bearer `; token polos ditolak.

## Daftarkan di claude.ai

Tambahkan URL `https://<subdomain>/mcp` di https://claude.ai/customize/connectors → **Add custom connector** (akun Free/Pro/Max boleh; connector baru hanya terbaca oleh **sesi baru**). Sumber: dokumentasi [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted) dan [Authentication for connectors](https://claude.com/docs/connectors/building/authentication) (dicek 2026-10-15).

Cara autentikasi yang didukung claude.ai:

| Jalur | Status | Cocok untuk server ini? |
| --- | --- | --- |
| **Request headers** (token bearer statis): pilih **No sign-in**, buka **Request headers**, header `authorization`, nilai `Bearer <token>` (kata `Bearer ` ikut diketik) | Beta, hanya organisasi tertentu. Bagian itu tidak muncul di dialog kalau akun belum punya akses. | **Ya, tanpa perubahan kode.** Syarat: bagian itu muncul di dialog. |
| OAuth (daftar otomatis/DCR, Client ID Metadata Document, atau client OAuth milik sendiri) | Didukung semua akun | Perlu lapisan OAuth di server ini (belum ada di PR). |
| Tanpa autentikasi | Didukung | **Jangan.** Siapa pun yang tahu URL bisa membaca. |

Kredensial tidak boleh lewat URL (`?token=`): dilarang spesifikasi MCP dan bocor lewat log. Pengaturan autentikasi tidak bisa diubah setelah connector dibuat; salah isi berarti hapus dan buat ulang.

Jaringan: lalu lintas Anthropic ke servermu berasal dari `160.79.104.0/21` ([daftar IP resmi](https://platform.claude.com/docs/en/api/ip-addresses)). Di nginx, `allow 160.79.104.0/21; deny all;` untuk path `/mcp` menyingkirkan hampir semua pemindai internet. Ini tambahan, bukan pengganti token.

MCP tunnels (tanpa membuka port) hanya untuk paket Enterprise, jadi tidak tersedia di akun Max.

## Risiko

- Pintu masuk baru dari internet ke host yang memuat data donor dan uang. Token bocor berarti orang luar bisa membaca status, log deploy, dan daftar backup.
- Log deploy dimasker (URL dengan kredensial, pasangan `kunci=nilai` atau `"kunci":"nilai"` yang kuncinya memuat kata seperti password/secret/token/key, nilai Bearer/Basic), tetapi masker hanya menebak bentuk umum: rahasia dalam bentuk lain lolos. Jangan menulis rahasia ke `deploy.log`.
- Isi log yang dibaca model bisa memuat teks yang berusaha memberi perintah (prompt injection). Karena semua tool baca-saja dan tidak ada tool tulis, dampaknya dibatasi pada pembacaan.
- Jangan menambah tool tulis atau generik (`exec`, `query`) tanpa keputusan owner dan ADR.

## Cabut

Hapus connector di claude.ai, hentikan service, rotasi token, lalu hapus aturan nginx. Tidak ada state yang perlu dipulihkan.
