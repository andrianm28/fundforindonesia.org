# Spesifikasi Produk dan Teknis

## SuperApp Pramuka Jawa Barat - MVP Pelatihan 2026

| Atribut | Nilai |
| --- | --- |
| Status | Draf untuk implementasi dan penilaian pelatihan |
| Versi | 0.1 |
| Dasar | Juklak Pelatihan Talenta Digital Pramuka Jawa Barat Tahun 2026 |
| Pemilik produk | Kwartir Daerah Gerakan Pramuka Jawa Barat |
| Pengguna awal | Anggota Pramuka, Kwarcab, Kwarda, panitia, dan instruktur |
| Target rilis | Prototype fungsional yang didemonstrasikan pada hari ketiga |

## 1. Tujuan Dokumen

Dokumen ini menerjemahkan juklak menjadi spesifikasi yang dapat digunakan bersama oleh tim UI/UX, frontend, backend, database, QA, dan DevOps. Dokumen ini menetapkan:

- Ruang lingkup prototype minimum yang realistis untuk sprint pelatihan tiga hari.
- Perilaku fungsional, aturan bisnis, peran pengguna, dan kriteria penerimaan.
- Kontrak arsitektur, model data, dan API bersama agar hasil tiap tim menjadi satu aplikasi.
- Batas keamanan dan tata kelola yang wajib dipenuhi sebelum aplikasi memakai data anggota nyata.
- Backlog dan proses keberlanjutan setelah demo.

Dokumen ini mendefinisikan MVP. Ia bukan izin untuk memakai data produksi, menerbitkan sertifikat resmi, atau mengklaim sistem siap produksi.

## 2. Visi dan Hasil yang Diharapkan

SuperApp Pramuka Jawa Barat adalah platform web responsif untuk mendukung identitas anggota, kegiatan, pembinaan, prestasi, pelatihan, komunikasi, dan administrasi Pramuka Jawa Barat.

Hasil MVP harus membuktikan satu alur terpadu berikut:

1. Admin membuat atau mengimpor anggota demo dan menugaskan anggota ke Kwarcab.
2. Anggota masuk ke aplikasi dan melihat kartu anggota digitalnya.
3. Petugas memverifikasi kartu melalui QR Code tanpa melihat data pribadi berlebihan.
4. Anggota mendaftar sebuah kegiatan, lalu panitia mencatat kehadirannya.
5. Admin melihat ringkasan jumlah anggota, pendaftaran, dan kehadiran pada dashboard.
6. Minimal satu modul pembinaan tambahan, e-Prestasi atau e-Pelatihan, berjalan dari ujung ke ujung.

### 2.1 Sasaran keberhasilan MVP

| Sasaran | Definisi selesai |
| --- | --- |
| Integrasi | Seluruh modul menggunakan satu identitas pengguna, role, dan PostgreSQL yang sama. |
| Demo | Aplikasi dapat diakses melalui URL HTTPS dan menjalankan skenario demo tanpa konfigurasi manual. |
| Fungsionalitas | Minimal lima area fungsional yang ditetapkan pada bagian 5 dapat didemonstrasikan. |
| Kualitas kode | Setiap fitur utama memiliki validasi input, penanganan error, dokumentasi singkat, dan pull request. |
| Kolaborasi | Kontribusi seluruh tim dapat ditelusuri melalui issue, branch, pull request, dan review. |
| Keberlanjutan | Repository, environment, akun layanan, dokumentasi deployment, dan backlog diserahkan kepada Kwarda. |

### 2.2 Batasan MVP

Fitur berikut tidak menjadi syarat demo dan harus ditunda sampai fase lanjutan:

- Integrasi dengan basis data keanggotaan resmi atau sistem eksternal.
- Pembayaran, tanda tangan elektronik, dan sertifikat dengan status hukum resmi.
- Push notification native, aplikasi mobile native, dan forum real-time.
- Multi-tenant penuh, integrasi SSO, serta sinkronisasi offline.
- Analitik prediktif, leaderboard publik, dan gamifikasi kompleks.
- Microservice, Kubernetes, atau arsitektur yang membutuhkan operasi kompleks.

### 2.3 Arti prioritas backlog

| Prioritas | Arti |
| --- | --- |
| P0 | Wajib selesai, terintegrasi, dan lulus skenario demo. |
| P1 | Dikerjakan setelah P0 stabil. Minimal satu alur P1 dipilih untuk melengkapi lima area fungsional demo. |
| P2 | Bukan target sprint tiga hari; hanya boleh dikerjakan jika P0 dan P1 terpilih sudah selesai serta teruji. |

## 3. Prinsip Produk dan Keputusan Scope

1. **Satu produk, bukan kumpulan aplikasi.** Semua tim wajib memakai identitas, API, model data, design system, dan repository bersama.
2. **Alur inti lebih penting daripada banyak layar.** Fitur harus dapat diselesaikan pengguna dari awal sampai akhir.
3. **Data minimal.** Prototype hanya memakai data sintetis atau data yang telah disetujui secara tertulis.
4. **Mobile-first.** Pengguna utama kemungkinan mengakses melalui ponsel, meskipun peserta membangun dari laptop.
5. **Accessible by default.** Kontras, fokus keyboard, label form, dan pesan kesalahan harus jelas.
6. **Open collaboration.** Code, issue, dan keputusan teknis tercatat di GitHub organisasi.
7. **Secure by default.** Otorisasi dilakukan di server. Menyembunyikan tombol pada antarmuka tidak cukup sebagai kontrol akses.

## 4. Peran Pengguna dan Hak Akses

| Kode | Peran | Lingkup | Hak utama |
| --- | --- | --- | --- |
| MEMBER | Anggota | Data diri sendiri | Melihat profil/kartu, mendaftar kegiatan, melihat prestasi dan pelatihan sendiri. |
| EVENT_OFFICER | Panitia kegiatan | Kegiatan yang ditugaskan | Melihat peserta, melakukan check-in, dan melihat laporan kegiatan. |
| KWARCAB_ADMIN | Admin Kwarcab | Satu Kwarcab | Mengelola data anggota dan kegiatan Kwarcab, memverifikasi prestasi, melihat statistik Kwarcab. |
| KWARDA_ADMIN | Admin Kwarda | Seluruh Jawa Barat | Mengelola organisasi, admin Kwarcab, data lintas Kwarcab, pengumuman, dan dashboard provinsi. |
| INSTRUCTOR | Instruktur | Pelatihan yang ditugaskan | Mengelola konten pembelajaran, kuis, dan memeriksa hasil. |
| SUPER_ADMIN | Administrator teknis | Sistem | Mengelola konfigurasi, role, audit log, serta pemulihan operasional. Tidak digunakan untuk pekerjaan harian. |

### 4.1 Aturan otorisasi

- `MEMBER` hanya dapat membaca dan mengubah data miliknya sendiri, kecuali data yang bersifat read-only seperti nomor anggota dan status keanggotaan.
- `EVENT_OFFICER` hanya dapat melihat pendaftar dan mencatat kehadiran pada kegiatan yang ditugaskan kepadanya.
- `KWARCAB_ADMIN` tidak dapat melihat atau mengubah data rinci anggota Kwarcab lain.
- `KWARDA_ADMIN` dapat melihat data lintas Kwarcab, tetapi semua perubahan sensitif harus dicatat dalam audit log.
- Role diperiksa oleh backend pada setiap endpoint. Frontend hanya menggunakan role untuk pengalaman pengguna.
- Akun dengan lebih dari satu role memakai gabungan izin yang eksplisit, bukan role paling tinggi secara otomatis.

## 5. Ruang Lingkup Modul

### 5.1 Fondasi Platform

| ID | Kebutuhan | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| PLT-01 | Sistem menyediakan login untuk akun demo dan sesi aman. | P0 | Pengguna dapat login, logout, dan sesi berakhir ketika token/sesi tidak valid. |
| PLT-02 | Sistem menyimpan profil anggota dan organisasi Kwarcab/Kwarda. | P0 | Profil menampilkan nama, nomor anggota, Kwarcab, golongan, dan status keanggotaan. |
| PLT-03 | Sistem menerapkan role-based access control. | P0 | Endpoint admin memberi respons 403 ketika dipanggil oleh anggota biasa. |
| PLT-04 | Sistem memiliki navigasi berdasarkan peran. | P0 | Menu anggota tidak menampilkan fungsi admin; menu admin menampilkan modul yang diizinkan. |
| PLT-05 | Sistem mencatat aksi sensitif. | P1 | Pembuatan anggota, perubahan role, perubahan status anggota, dan check-in tercatat dengan aktor serta waktu. |
| PLT-06 | Sistem menampilkan halaman 403, 404, loading, dan error yang informatif. | P0 | Tidak ada error mentah, stack trace, atau data internal pada browser. |

### 5.2 e-Kartu Pramuka

**Tujuan:** anggota memiliki kartu digital yang dapat diverifikasi oleh petugas tanpa membuka data pribadi yang tidak perlu.

| ID | Kebutuhan | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| CARD-01 | Anggota dapat melihat e-Kartu dari dashboard. | P0 | Kartu memuat foto opsional, nama, nomor anggota, Kwarcab, golongan, dan status aktif. |
| CARD-02 | Sistem membuat QR Code untuk verifikasi kartu. | P0 | QR mengarah ke URL verifikasi publik dengan token yang tidak memuat data pribadi secara langsung. |
| CARD-03 | Halaman verifikasi menampilkan hasil valid, tidak valid, atau kedaluwarsa. | P0 | Halaman hanya menampilkan nama terbatas, Kwarcab, dan status kartu. |
| CARD-04 | Admin dapat mengaktifkan atau menonaktifkan kartu. | P1 | Kartu nonaktif menghasilkan status `Tidak aktif` ketika diverifikasi. |
| CARD-05 | Sistem dapat menerbitkan ulang token QR. | P1 | Token lama langsung tidak valid dan perubahan tercatat di audit log. |

**Aturan bisnis:**

- QR Code tidak menyimpan NTA, email, nomor telepon, atau data pribadi dalam bentuk terbuka.
- Token QR dibuat acak, disimpan sebagai hash, dan dapat diberi tanggal kedaluwarsa.
- Versi demo dapat memakai token berlaku 24 jam. Produksi perlu kebijakan masa berlaku yang diputuskan Kwarda.
- Kartu hanya berstatus `ACTIVE` apabila profil anggota berstatus aktif dan kartunya tidak dicabut.

### 5.3 e-Kegiatan

**Tujuan:** anggota dapat mendaftar kegiatan dan panitia dapat memantau serta mencatat kehadiran.

| ID | Kebutuhan | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| EVT-01 | Admin membuat, mengubah, menerbitkan, dan membatalkan kegiatan. | P0 | Kegiatan memiliki judul, deskripsi, jadwal, lokasi, kapasitas, pendaftaran dibuka/ditutup, dan status. |
| EVT-02 | Anggota melihat daftar dan detail kegiatan yang telah diterbitkan. | P0 | Hanya kegiatan `PUBLISHED` dengan periode pendaftaran aktif yang dapat didaftari. |
| EVT-03 | Anggota mendaftar atau membatalkan pendaftaran. | P0 | Satu anggota hanya memiliki satu pendaftaran aktif per kegiatan. |
| EVT-04 | Sistem menolak pendaftaran saat kuota penuh atau periode tertutup. | P0 | API memberi pesan kesalahan yang jelas dan tidak membuat data parsial. |
| EVT-05 | Panitia melihat daftar peserta berdasarkan kegiatan. | P0 | Panitia hanya melihat kegiatan yang ditugaskan kepadanya. |
| EVT-06 | Panitia mencatat kehadiran manual atau melalui scan QR. | P0 | Check-in tidak boleh tercatat dua kali dan menyimpan waktu serta petugas. |
| EVT-07 | Admin melihat ringkasan pendaftaran dan kehadiran. | P1 | Ringkasan menampilkan jumlah terdaftar, hadir, tidak hadir, dan sisa kuota. |

**Status kegiatan:** `DRAFT`, `PUBLISHED`, `CLOSED`, `CANCELLED`, `COMPLETED`.

**Status pendaftaran:** `REGISTERED`, `CANCELLED`, `WAITLISTED`, `ATTENDED`, `ABSENT`.

### 5.4 e-Prestasi

**Tujuan:** anggota memiliki portofolio prestasi atau TKK digital yang dapat diajukan dan diverifikasi.

| ID | Kebutuhan | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| ACH-01 | Admin membuat katalog jenis prestasi atau TKK. | P1 | Katalog memiliki nama, kategori, deskripsi, dan ikon opsional. |
| ACH-02 | Anggota mengajukan prestasi dengan bukti dan keterangan. | P1 | Pengajuan masuk dengan status `SUBMITTED` dan hanya terlihat oleh pemilik serta pemeriksa yang berwenang. |
| ACH-03 | Admin Kwarcab memverifikasi atau menolak pengajuan. | P1 | Keputusan menyimpan pemeriksa, waktu, catatan, dan status akhir. |
| ACH-04 | Anggota melihat portofolio prestasinya. | P1 | Hanya prestasi `VERIFIED` yang tampil sebagai pencapaian tervalidasi. |

**Status prestasi:** `DRAFT`, `SUBMITTED`, `VERIFIED`, `REJECTED`, `REVOKED`.

### 5.5 e-Pelatihan

**Tujuan:** peserta mengakses materi pembelajaran, mengerjakan kuis, dan memperoleh bukti penyelesaian dalam ruang lingkup internal.

| ID | Kebutuhan | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| LMS-01 | Instruktur membuat pelatihan dan modul. | P1 | Pelatihan berisi judul, deskripsi, modul terurut, serta status publikasi. |
| LMS-02 | Anggota mendaftar atau ditugaskan ke pelatihan. | P1 | Anggota hanya dapat mengakses materi pelatihan yang telah dibuka untuknya. |
| LMS-03 | Anggota membaca materi dan mengerjakan kuis pilihan ganda. | P1 | Sistem menyimpan jawaban, nilai, dan waktu pengumpulan. |
| LMS-04 | Sistem menandai kelulusan berdasarkan nilai ambang. | P1 | Nilai akhir dan status lulus dapat dilihat anggota serta instruktur. |
| LMS-05 | Sistem menghasilkan sertifikat internal. | P2 | Sertifikat diberi label `Prototype` sampai format, penandatangan, dan nomor resmi disetujui. |

### 5.6 Dashboard Admin

**Tujuan:** Kwarcab dan Kwarda mendapatkan ringkasan operasional tanpa membuka seluruh data secara manual.

| ID | Kebutuhan | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| ADM-01 | Dashboard Kwarcab menampilkan metrik wilayahnya. | P0 | Menampilkan jumlah anggota aktif, kegiatan berjalan, pendaftaran, dan kehadiran Kwarcab sendiri. |
| ADM-02 | Dashboard Kwarda menampilkan agregasi seluruh Kwarcab. | P1 | Menampilkan metrik provinsi dan perbandingan sederhana antar-Kwarcab. |
| ADM-03 | Admin dapat memfilter metrik berdasarkan rentang waktu. | P1 | Filter mengubah data tanpa mengekspos informasi anggota yang tidak diperlukan. |
| ADM-04 | Dashboard menyediakan tautan ke daftar data yang relevan. | P0 | Klik metrik membawa pengguna ke daftar anggota atau kegiatan sesuai izin. |

### 5.7 e-Komunikasi

Untuk MVP, modul ini dibatasi pada pengumuman terarah. Forum diskusi dan push notification real-time menjadi fase lanjutan.

| ID | Kebutuhan | Prioritas | Kriteria penerimaan |
| --- | --- | --- | --- |
| COM-01 | Admin Kwarcab/Kwarda dapat menerbitkan pengumuman. | P1 | Pengumuman memiliki judul, isi, sasaran, status publikasi, dan waktu terbit. |
| COM-02 | Anggota melihat pengumuman sesuai sasaran. | P1 | Anggota Kwarcab hanya melihat pengumuman untuk dirinya, Kwarcabnya, atau seluruh provinsi. |
| COM-03 | Sistem menyimpan status telah dibaca. | P2 | Anggota dapat menandai pengumuman telah dibaca dan dashboard dapat menghitung pembacaan. |

## 6. Alur Pengguna Utama

### 6.1 Alur e-Kartu dan verifikasi

1. Admin Kwarcab membuat atau mengimpor anggota demo.
2. Sistem membuat profil anggota dan kartu berstatus aktif.
3. Anggota login lalu membuka halaman e-Kartu.
4. Frontend meminta QR Code aktif dari backend.
5. Petugas memindai QR dan membuka halaman verifikasi publik.
6. Backend memvalidasi token dan mengembalikan status kartu minimal.
7. Halaman menampilkan `Kartu valid`, `Kartu tidak aktif`, `Token tidak valid`, atau `Token kedaluwarsa`.

### 6.2 Alur pendaftaran dan absensi kegiatan

1. Admin menerbitkan kegiatan dengan kapasitas dan periode pendaftaran.
2. Anggota membuka detail kegiatan lalu menekan `Daftar`.
3. Backend memeriksa login, status anggota, periode pendaftaran, pendaftaran ganda, dan kuota secara atomik.
4. Sistem membuat pendaftaran dengan status `REGISTERED`.
5. Panitia membuka daftar peserta atau pemindai QR pada hari kegiatan.
6. Panitia melakukan check-in. Backend menolak check-in duplikat.
7. Sistem memperbarui status pendaftaran menjadi `ATTENDED` dan mencatat audit event.
8. Dashboard memperbarui metrik kehadiran.

### 6.3 Alur prestasi

1. Anggota memilih jenis prestasi/TKK dan mengisi data pengajuan.
2. Anggota mengunggah bukti dengan format serta ukuran yang diizinkan.
3. Sistem menyimpan pengajuan sebagai `SUBMITTED`.
4. Admin Kwarcab meninjau bukti lalu memverifikasi atau menolak dengan catatan.
5. Sistem mencatat keputusan dan anggota melihat hasilnya di portofolio.

## 7. Aturan Data dan Model Domain

### 7.1 Entitas inti

| Entitas | Atribut penting | Aturan |
| --- | --- | --- |
| `Organization` | id, type, name, code, parent_id, active | `type` bernilai `KWARDA` atau `KWARCAB`; Kwarcab berada di bawah satu Kwarda. |
| `User` | id, email/username, password_hash, active, last_login_at | Akun autentikasi terpisah dari profil anggota agar petugas non-anggota tetap dapat memakai sistem. |
| `UserRole` | user_id, role, organization_id | Role Kwarcab selalu dibatasi pada organisasi terkait. |
| `MemberProfile` | id, user_id, member_number, full_name, birth_date, scout_level, organization_id, membership_status | Nomor anggota unik bila sumber data resminya tersedia; gunakan data demo pada prototype. |
| `MembershipCard` | member_id, status, qr_token_hash, expires_at, revoked_at | Satu kartu aktif per anggota. |
| `Event` | id, organization_id, title, start_at, end_at, capacity, registration_open_at, registration_close_at, status | Waktu selesai tidak boleh sebelum waktu mulai. |
| `EventRegistration` | event_id, member_id, status, registered_at, checked_in_at, checked_in_by | Unik pada kombinasi `event_id` dan `member_id`. |
| `AchievementType` | id, name, category, description, active | Katalog referensi yang dikelola admin. |
| `AchievementRecord` | member_id, type_id, status, evidence_url, submitted_at, verified_by, verified_at, review_note | Pengajuan hanya dapat diverifikasi oleh admin berwenang. |
| `Course` | id, title, description, status, pass_score, organization_id | Bisa bersifat provinsi atau khusus satu Kwarcab. |
| `CourseModule` | course_id, title, content, position, published | Materi diurutkan dengan `position`. |
| `Quiz` dan `QuizAttempt` | course_id, pass_score, member_id, score, submitted_at | Jawaban benar tidak pernah dikirim ke browser sebelum pengumpulan. |
| `Announcement` | id, author_id, audience_type, organization_id, title, body, published_at | Sasaran dapat berupa provinsi, Kwarcab tertentu, atau peserta pelatihan tertentu. |
| `AuditLog` | actor_id, action, entity_type, entity_id, metadata, occurred_at | Tidak boleh diubah melalui antarmuka aplikasi. |

### 7.2 Relasi domain

```text
Organization 1---* MemberProfile
Organization 1---* Event
User 1---0..1 MemberProfile
User 1---* UserRole
MemberProfile 1---* EventRegistration *---1 Event
MemberProfile 1---* AchievementRecord *---1 AchievementType
MemberProfile 1---* QuizAttempt *---1 Course
MemberProfile 1---1 MembershipCard
User 1---* AuditLog
```

### 7.3 Kualitas dan retensi data

- Semua tabel menggunakan `created_at`, `updated_at`, dan ID yang tidak mudah ditebak.
- Waktu disimpan dalam UTC dan ditampilkan dalam zona waktu Asia/Jakarta.
- Penghapusan data operasional memakai soft delete bila diperlukan untuk audit; penghapusan permanen membutuhkan prosedur administratif.
- File bukti prestasi disimpan di object storage, bukan sebagai blob pada PostgreSQL.
- Nomor telepon, email, tanggal lahir, dan dokumen bukti tidak boleh tampil pada endpoint verifikasi QR publik.
- Kebijakan retensi, penghapusan, dan data produksi harus mendapat peninjauan hukum serta perlindungan data pribadi sebelum go-live.

## 8. Kontrak API

### 8.1 Konvensi umum

- Base path: `/api/v1`.
- Format: JSON UTF-8, kecuali upload file multipart.
- Tanggal/waktu: ISO 8601 dalam UTC.
- Semua respons error memiliki bentuk `{ "error": { "code": "...", "message": "...", "details": [] } }`.
- Daftar memakai `page`, `pageSize`, `sort`, dan filter eksplisit. Nilai maksimum `pageSize` adalah 100.
- Endpoint privat memerlukan sesi atau access token valid; endpoint publik dibatasi rate limit.
- Semua mutasi divalidasi dengan schema backend sebelum diproses.

### 8.2 Endpoint MVP

| Metode | Endpoint | Akses | Fungsi |
| --- | --- | --- | --- |
| POST | `/auth/login` | Publik | Memulai sesi pengguna. |
| POST | `/auth/logout` | Login | Mengakhiri sesi. |
| GET | `/me` | Login | Mengembalikan profil dan role pengguna aktif. |
| GET | `/members/me/card` | MEMBER | Mengambil kartu dan QR aktif pemilik akun. |
| POST | `/members/{memberId}/card/rotate` | KWARCAB_ADMIN | Menerbitkan ulang token QR kartu. |
| GET | `/card-verifications/{token}` | Publik | Memverifikasi token QR dengan data minimal. |
| GET | `/events` | Login | Menampilkan kegiatan sesuai hak akses. |
| POST | `/events` | KWARCAB_ADMIN, KWARDA_ADMIN | Membuat kegiatan. |
| GET | `/events/{eventId}` | Login | Menampilkan detail kegiatan. |
| PATCH | `/events/{eventId}` | Pemilik organisasi | Mengubah status atau detail kegiatan. |
| POST | `/events/{eventId}/registrations` | MEMBER | Mendaftarkan anggota aktif. |
| DELETE | `/events/{eventId}/registrations/me` | MEMBER | Membatalkan pendaftaran sendiri. |
| GET | `/events/{eventId}/registrations` | EVENT_OFFICER, admin | Melihat peserta sesuai lingkup. |
| POST | `/events/{eventId}/check-ins` | EVENT_OFFICER, admin | Mencatat kehadiran manual atau QR. |
| POST | `/achievements` | MEMBER | Mengajukan prestasi. |
| GET | `/achievements/me` | MEMBER | Melihat portofolio sendiri. |
| PATCH | `/achievements/{id}/review` | KWARCAB_ADMIN, KWARDA_ADMIN | Memverifikasi atau menolak prestasi. |
| GET | `/courses` | Login | Menampilkan pelatihan yang dapat diakses. |
| POST | `/courses/{courseId}/quiz-attempts` | MEMBER | Menyerahkan jawaban kuis. |
| GET | `/dashboard/summary` | Admin | Menampilkan metrik sesuai lingkup role. |
| GET | `/announcements` | Login | Menampilkan pengumuman untuk pengguna. |
| POST | `/announcements` | KWARCAB_ADMIN, KWARDA_ADMIN | Menerbitkan pengumuman. |

### 8.3 Contoh respons verifikasi QR

```json
{
  "data": {
    "status": "VALID",
    "member": {
      "displayName": "Ayu S.",
      "organization": "Kwarcab Kota Bandung",
      "scoutLevel": "Penegak"
    },
    "verifiedAt": "2026-07-15T08:30:00Z"
  }
}
```

Respons tersebut sengaja tidak mengembalikan nomor anggota lengkap, tanggal lahir, alamat, email, atau nomor telepon.

## 9. Arsitektur Referensi MVP

### 9.1 Keputusan arsitektur

Produk MVP memakai **modular monolith**, bukan microservice. Keputusan ini menjaga integrasi, deployment, dan pembelajaran tetap realistis dalam tiga hari.

| Lapisan | Pilihan MVP | Tanggung jawab |
| --- | --- | --- |
| Frontend | Vue.js 3, TypeScript, Vite | UI responsif, routing, form, state klien, konsumsi API. |
| Backend inti | FastAPI, Python 3.11+, SQLAlchemy, Alembic | REST API, autentikasi, otorisasi, aturan bisnis, validasi, dan dokumentasi OpenAPI. |
| Database | PostgreSQL 16 | Data transaksional dan pelaporan dasar. |
| Cache/rate limit | Redis, opsional pada MVP | Rate limit, cache dashboard, dan antrean ringan apabila sudah tersedia. |
| Realtime | Node.js/WebSocket, fase lanjutan | Dipakai hanya ketika kebutuhan notifikasi atau forum real-time telah disetujui. |
| File | Object storage kompatibel S3 atau volume VPS terbatas | Foto profil dan bukti prestasi dengan kontrol akses. |
| Deployment | Docker Compose, Nginx, VPS HTTPS | Menjalankan frontend, API, PostgreSQL, dan layanan pendukung. |

Node.js, Vue.js, FastAPI, PostgreSQL, Redis, Docker, dan GitHub Actions tetap dapat dipelajari sesuai juklak. Namun, Node.js tidak boleh menjadi backend kedua untuk domain inti pada MVP tanpa kontrak API, kepemilikan data, dan rencana integrasi yang disetujui.

### 9.2 Komponen dan aliran data

```text
Browser/PWA
    |
    v
Vue.js frontend ---- HTTPS ----> Nginx reverse proxy
                                      |
                                      v
                                FastAPI application
                                  |       |       |
                                  v       v       v
                            PostgreSQL  Redis  Object storage
                                  |
                                  v
                              Audit log / backup
```

### 9.3 Struktur repository yang direkomendasikan

```text
superapp-pramuka-jabar/
  apps/
    web/                 # Vue.js frontend
    api/                 # FastAPI modular monolith
  packages/
    contracts/           # OpenAPI, JSON schema, shared constants
    design-tokens/       # warna, tipografi, spacing, icon mapping
  infra/
    docker/
    nginx/
  docs/
    architecture/
    api/
    runbooks/
  compose.yaml
  README.md
```

### 9.4 Modul backend

| Modul | Tanggung jawab | Pemilik data |
| --- | --- | --- |
| `identity` | user, session, role, organisasi, member profile | Identity team |
| `membership` | e-Kartu dan token QR | Identity team |
| `events` | kegiatan, pendaftaran, check-in | Event team |
| `achievements` | katalog, pengajuan, verifikasi | Achievement team |
| `learning` | course, materi, kuis, hasil | Learning team |
| `communications` | pengumuman dan status baca | Communication team |
| `reporting` | query dashboard teragregasi | Platform team |
| `audit` | pencatatan mutasi sensitif | Platform team |

Satu tabel hanya memiliki satu modul pemilik. Tim lain mengaksesnya melalui service layer atau API internal, bukan menulis langsung ke tabel milik modul lain.

## 10. Keamanan dan Privasi

### 10.1 Kontrol minimum MVP

| Area | Ketentuan |
| --- | --- |
| Password | Simpan dengan Argon2id atau bcrypt yang memiliki cost memadai. Jangan pernah menyimpan password mentah. |
| Sesi | Cookie `HttpOnly`, `Secure`, `SameSite=Lax` untuk web yang satu domain, atau access token singkat dengan refresh token yang dirotasi. |
| Otorisasi | Selalu diperiksa di API berdasarkan role dan organisasi. |
| QR | Gunakan token acak yang disimpan sebagai hash. Jangan encode data anggota ke QR. |
| Input | Validasi tipe, panjang, format, dan hak akses di backend. Gunakan query terparameter/ORM. |
| Upload | Batasi MIME type, ukuran file, nama file, dan akses; pindai malware bila sudah memakai data nyata. |
| Transport | Semua deployment demo memakai HTTPS. Kredensial tidak dikirim atau disimpan melalui HTTP. |
| Secret | Simpan di environment/secret manager, tidak di repository, screenshot, atau issue GitHub. |
| Log | Jangan log password, token, nomor identitas, dokumen bukti, atau respons autentikasi penuh. |
| Rate limit | Terapkan pada login, verifikasi QR publik, upload, dan endpoint mutasi. |
| Backup | Backup PostgreSQL terenkripsi dan uji proses restore sebelum data nyata digunakan. |

### 10.2 Perlindungan data pribadi

Data anggota dapat mencakup peserta berusia di bawah 18 tahun. Sebelum sistem memakai data nyata, Kwarda sebagai pengendali data harus menetapkan dasar pemrosesan, pemberitahuan privasi, minimisasi data, retensi, pengelolaan akses, prosedur insiden, dan mekanisme persetujuan/wali bila diperlukan. Kepatuhan terhadap Undang-Undang Nomor 27 Tahun 2022 tentang Perlindungan Data Pribadi perlu ditinjau oleh pihak yang berwenang.

Prototype pelatihan wajib memakai akun dan data demo kecuali ada persetujuan tertulis serta kontrol produksi yang telah diverifikasi.

## 11. Kebutuhan Nonfungsional

| Kategori | Target MVP | Verifikasi |
| --- | --- | --- |
| Respons UI | Halaman utama dan API baca sederhana p95 di bawah 2 detik pada beban demo. | Uji manual dengan data demo dan browser devtools. |
| Ketersediaan demo | Aplikasi dapat diakses sepanjang sesi presentasi. | Smoke test sebelum presentasi dan rencana fallback. |
| Kompatibilitas | Chrome Android modern, Safari iOS modern, Chrome/Firefox desktop terbaru. | Uji responsif pada viewport 360px, 768px, dan 1440px. |
| Aksesibilitas | Kontras memadai, fokus keyboard, label input, dan pesan error terbaca. | Audit manual dan Lighthouse bila tersedia. |
| Observabilitas | API memiliki health check dan log error terstruktur. | `GET /health` sukses; log tidak memuat rahasia. |
| Pemulihan | Database dapat dipulihkan dari backup pada environment nonproduksi. | Simulasi restore setelah acara. |
| Dokumentasi | Setup lokal, environment, deployment, dan akun demo didokumentasikan. | Kontributor lain dapat menjalankan proyek dari README. |

## 12. UI/UX dan Navigasi

### 12.1 Peta halaman

| Rute | Pengguna | Isi |
| --- | --- | --- |
| `/login` | Publik | Login. |
| `/beranda` | Semua role | Ringkasan dan tautan aksi utama sesuai role. |
| `/kartu` | MEMBER | e-Kartu dan QR. |
| `/verifikasi-kartu/:token` | Publik | Hasil verifikasi kartu minimal. |
| `/kegiatan` | Login | Daftar dan detail kegiatan. |
| `/kegiatan/:id` | Login | Detail, pendaftaran, atau daftar peserta sesuai izin. |
| `/prestasi` | MEMBER/admin | Portofolio, pengajuan, dan review. |
| `/pelatihan` | MEMBER/instruktur | Daftar pelatihan, materi, kuis. |
| `/pengumuman` | Login | Pengumuman untuk pengguna. |
| `/admin/dashboard` | Admin | Ringkasan metrik. |
| `/admin/anggota` | Admin | Daftar dan manajemen anggota. |
| `/admin/kegiatan` | Admin | Manajemen kegiatan. |

### 12.2 Aturan desain

- Gunakan design token tunggal untuk warna, typography, spacing, radius, state, dan icon.
- Jangan menggunakan warna sebagai satu-satunya penanda status. Status harus memiliki teks dan icon bila relevan.
- Form menampilkan label permanen, indikator wajib, validasi inline, dan pesan error yang dapat ditindaklanjuti.
- Aksi destruktif memerlukan konfirmasi dan tidak boleh hanya dibedakan oleh warna merah.
- Halaman publik verifikasi QR harus sangat sederhana, cepat, dan tidak memerlukan login.
- Tampilan mobile menggunakan bottom navigation atau menu ringkas untuk menu anggota; dashboard admin boleh memakai sidebar pada layar besar.

## 13. Strategi Pengujian dan Kriteria Demo

### 13.1 Pengujian minimum

| Jenis | Cakupan |
| --- | --- |
| Unit test | Validasi kuota, pendaftaran ganda, status kartu, kalkulasi dashboard, dan keputusan prestasi. |
| API integration test | Login, otorisasi, pendaftaran kegiatan, check-in, dan verifikasi QR. |
| E2E smoke test | Login anggota, lihat e-Kartu, daftar kegiatan, login panitia, check-in, lihat dashboard. |
| Manual UX test | Tampilan mobile, empty state, loading, error state, dan alur keyboard dasar. |
| Security smoke test | Anggota tidak dapat memanggil endpoint admin; token QR tidak mengekspos PII; secret tidak ada di repository. |

### 13.2 Skenario penerimaan demo

| No. | Skenario | Hasil yang harus terlihat |
| --- | --- | --- |
| 1 | Login sebagai anggota demo | Beranda anggota muncul dan menu admin tidak terlihat. |
| 2 | Buka e-Kartu | Kartu aktif dan QR tampil. |
| 3 | Scan atau buka QR | Halaman publik menampilkan status kartu valid dan data minimal. |
| 4 | Daftar kegiatan | Pendaftaran berhasil, kuota berkurang, dan status terlihat pada akun anggota. |
| 5 | Coba mendaftar dua kali | Sistem menolak tanpa membuat pendaftaran ganda. |
| 6 | Login sebagai panitia | Daftar peserta kegiatan yang ditugaskan tampil. |
| 7 | Check-in peserta | Status menjadi hadir; check-in kedua ditolak. |
| 8 | Login sebagai admin Kwarcab | Metrik anggota/kegiatan/kehadiran Kwarcab tampil. |
| 9 | Ajukan dan verifikasi prestasi atau selesaikan kuis | Status/hasil berpindah dari proses ke tervalidasi/lulus. |
| 10 | Coba endpoint admin dengan akun anggota | Backend mengembalikan 403. |

## 14. Rencana Implementasi Pelatihan

### 14.1 Persiapan sebelum Hari 1

- Product owner menetapkan scope P0 dan memutuskan modul P1 yang akan didemokan.
- Seluruh peserta menyelesaikan technical check: Git, Node.js, Python, Docker, editor, akun GitHub, dan akses repository.
- Tim menyiapkan repository, issue board, starter project, environment Docker, seed data, domain/subdomain, dan VPS.
- Tim UI/UX menyediakan user flow inti serta design token awal.
- Tim platform menyiapkan autentikasi, role, schema awal, API error contract, dan health check.
- Instruktur menyiapkan akun demo untuk minimal satu anggota, panitia, admin Kwarcab, dan admin Kwarda.

### 14.2 Pembagian tim yang direkomendasikan

| Tim | Fokus | Deliverable hari ketiga |
| --- | --- | --- |
| 1 | Platform identity | Login, role, profil anggota, seed data. |
| 2 | Design system/UI UX | User flow, komponen, halaman responsif, handoff. |
| 3 | e-Kartu | Kartu, QR, verifikasi publik. |
| 4 | e-Kegiatan frontend | Daftar/detail/pendaftaran kegiatan. |
| 5 | e-Kegiatan backend | Event API, kuota, pendaftaran, check-in. |
| 6 | Dashboard | Metrik Kwarcab dan halaman admin. |
| 7 | e-Prestasi | Pengajuan dan review sederhana. |
| 8 | e-Pelatihan | Materi dan kuis sederhana. |
| 9 | QA/documentation | Test scenario, API docs, README, bug triage. |
| 10 | DevOps/integration | Docker, deployment, CI, smoke test, rilis demo. |

### 14.3 Urutan kerja

| Waktu | Fokus | Definition of done |
| --- | --- | --- |
| Hari 1 malam | Scope, model data, wireframe, kontrak API | Backlog P0 diprioritaskan; schema dan endpoint disetujui. |
| Hari 2 pagi | Fondasi platform dan UI | Login, navigasi, schema migrasi, design token, seed data tersedia. |
| Hari 2 siang-malam | Fitur domain | e-Kartu dan e-Kegiatan terhubung pada environment bersama. |
| Hari 3 pagi | Integrasi dan test | Semua skenario demo P0 dapat dijalankan dari satu URL. |
| Hari 3 siang | Polishing dan fallback | Error state, responsif, data demo, dan slide demo siap. |
| Hari 3 sore | Presentasi | Demo menggunakan skenario penerimaan, bukan alur improvisasi. |

## 15. Delivery, Repository, dan Keberlanjutan

### 15.1 Aturan GitHub

- Gunakan repository organisasi Kwarda, bukan akun pribadi peserta.
- Branch `main` selalu deployable. Semua perubahan masuk melalui pull request.
- Setiap pull request harus terkait issue, dijelaskan singkat, dan direview minimal satu kontributor lain bila waktu memungkinkan.
- Lindungi `main` dari push langsung setelah fase pelatihan.
- Commit harus bermakna. Jumlah commit bukan ukuran kualitas utama.
- Tambahkan `README`, `.env.example`, instruksi setup, arsitektur ringkas, dan akun demo tanpa password nyata.

### 15.2 Artefak penyerahan

| Artefak | Penanggung jawab |
| --- | --- |
| Source code dan riwayat Git | Semua tim, dikelola platform team |
| OpenAPI/API documentation | Backend team |
| ERD dan migration database | Database/platform team |
| Link Penpot/Figma dan design tokens | UI/UX team |
| Docker Compose dan deployment runbook | DevOps team |
| Skenario test dan hasil smoke test | QA team |
| Daftar akun demo serta akses layanan | Product owner dan super admin |
| Backlog P1/P2 dan daftar keputusan terbuka | Product owner |

### 15.3 Roadmap pasca-pelatihan

| Fase | Fokus |
| --- | --- |
| 0-30 hari | Stabilkan MVP, perbaiki bug, lengkapi dokumentasi, tetapkan maintainer dan lisensi repository. |
| 31-90 hari | Validasi kebutuhan dengan Kwarcab, hardening auth/RBAC, tambah audit, backup, monitoring, serta pilot dengan data terbatas yang disetujui. |
| 3-6 bulan | Integrasi data anggota resmi bila disetujui, e-Pelatihan lebih lengkap, pengumuman terarah, dan laporan operasional. |
| Setelah validasi | Pertimbangkan notifikasi real-time, forum moderasi, aplikasi mobile/PWA lanjut, serta integrasi lintas sistem. |

## 16. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Scope terlalu luas | Modul tidak terintegrasi pada demo | Kunci backlog P0 sebelum coding dan tunda fitur P1/P2. |
| Kesenjangan kemampuan peserta | Tim tertahan pada instalasi atau konsep dasar | Technical check dan starter repository sebelum acara. |
| Konflik perubahan kode | Integrasi gagal pada hari ketiga | Kepemilikan modul jelas, branch pendek, PR kecil, dan integration owner. |
| VPS atau internet bermasalah | Demo tidak dapat diakses | Siapkan deployment lokal Docker dan seed data sebagai fallback. |
| Data pribadi dipakai tanpa kontrol | Risiko privasi dan kepatuhan | Gunakan data demo; jangan impor data produksi tanpa persetujuan dan review. |
| QR disalin atau bocor | Verifikasi kartu tidak andal | Token acak, hash, rotasi, expiry, dan halaman verifikasi data minimal. |
| Target commit dikejar | Kualitas kode dan review menurun | Nilai pull request, test, demo, dokumentasi, dan kontribusi lintas tim. |

## 17. Keputusan yang Harus Ditetapkan Kwarda

1. Nama domain/subdomain dan pemilik akun hosting/VPS.
2. Siapa pengendali data, product owner, maintainer teknis, dan penanggung jawab keamanan.
3. Sumber resmi nomor anggota serta proses sinkronisasi data bila aplikasi memasuki pilot.
4. Definisi role organisasi dan batas data yang boleh diakses Kwarcab/Kwarda.
5. Kebijakan kartu digital: format QR, masa berlaku, proses pencabutan, serta petugas verifikasi.
6. Status dan otoritas sertifikat e-Pelatihan.
7. Lisensi source code dan kebijakan kontribusi open source.
8. Kebijakan retensi data, backup, respons insiden, serta persetujuan penggunaan data anggota.
9. Modul P1 mana yang akan dipilih sebagai modul kelima untuk demo bila e-Kartu, e-Kegiatan, dan Dashboard sudah berjalan.

## 18. Definition of Done Rilis Prototype

Rilis prototype dinyatakan selesai apabila seluruh kondisi berikut terpenuhi:

- Satu URL HTTPS menjalankan frontend dan API dengan data demo.
- Login, role, profil anggota, e-Kartu, verifikasi QR, e-Kegiatan, check-in, dan dashboard Kwarcab dapat didemokan.
- Minimal satu modul tambahan, e-Prestasi atau e-Pelatihan, selesai dari alur input sampai hasil tampil.
- Akses admin tidak dapat digunakan oleh anggota biasa.
- Tidak ada secret, password nyata, atau data pribadi nyata di repository.
- Repository berisi README, instruksi menjalankan aplikasi, `.env.example`, migration/seed, ERD, dan skenario demo.
- Smoke test dijalankan pada URL demo sebelum presentasi.
- Product owner menerima daftar keterbatasan prototype dan backlog pasca-pelatihan.
