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

1. Buat user sistem khusus (bukan `deploy`, bukan root) yang hanya boleh **membaca** `DEPLOY_DIR/state`, `DEPLOY_DIR/logs`, dan `DEPLOY_DIR/backups`. Tanpa sudo, tanpa shell login, tanpa grup docker.
2. Buat token acak panjang (minimal 32 karakter): `openssl rand -hex 32`. Simpan hanya di file environment milik user itu (izin 600), bukan di repo.
3. Jalankan `node ops/mcp-ops/server.mjs` sebagai service systemd dengan env `MCP_OPS_TOKEN`, `DEPLOY_DIR`, dan opsional `HEALTH_URL`, `HOST` (default `127.0.0.1`), `PORT` (default `8787`). Kunci service: `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=read-only` dengan `ReadOnlyPaths=` hanya ke tiga folder di atas.
4. Di nginx, buat subdomain khusus dengan TLS, `proxy_pass` ke `127.0.0.1:8787` hanya untuk path `/mcp`, `limit_req` yang ketat, dan jika memungkinkan `allow`/`deny` per IP.
5. Uji dari luar: tanpa token harus `401`; dengan token, `tools/list` mengembalikan empat tool.

## Daftarkan di claude.ai

Tambahkan URL `https://<subdomain>/mcp` di https://claude.ai/customize/connectors sebagai custom connector. Connector baru hanya terbaca oleh **sesi baru**.

**Belum terverifikasi:** apakah form custom connector menerima token bearer statis atau mewajibkan OAuth. Kalau hanya OAuth, server ini perlu ditambah lapisan OAuth (atau di-proxy oleh gateway yang menyediakannya) sebelum bisa didaftarkan. Cek dulu di form sebelum memasang apa pun.

## Risiko

- Pintu masuk baru dari internet ke host yang memuat data donor dan uang. Token bocor berarti orang luar bisa membaca status, log deploy, dan daftar backup.
- Log deploy dimasker (URL dengan kredensial, `password=`, `token=`, header `Authorization`), tetapi masker bukan jaminan. Jangan menulis rahasia ke `deploy.log`.
- Isi log yang dibaca model bisa memuat teks yang berusaha memberi perintah (prompt injection). Karena semua tool baca-saja dan tidak ada tool tulis, dampaknya dibatasi pada pembacaan.
- Jangan menambah tool tulis atau generik (`exec`, `query`) tanpa keputusan owner dan ADR.

## Cabut

Hapus connector di claude.ai, hentikan service, rotasi token, lalu hapus aturan nginx. Tidak ada state yang perlu dipulihkan.
