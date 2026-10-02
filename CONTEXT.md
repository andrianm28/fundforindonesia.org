# Fund for Indonesia

Platform social impact yang dioperasikan PT Jaya Korpora Prima, menyatukan donasi, galang dana, zakat, wakaf, hibah, dan kolaborasi CSR dalam satu akun dan satu riwayat dampak. Volunteer tetap ada di produk tanpa slot menu utama, membayar Trip Fee untuk menutup biaya partisipasinya sendiri; jalur uangnya terpisah dari Campaign meski memakai infrastruktur Payment yang sama, lihat Volunteer Trip di bawah dan [ADR 0014](./docs/adr/0014-volunteer-trip-stays-separate-entity.md). Yayasan Indonesia Emas Merdeka (YIEM) adalah organisasi program pertama di atasnya, bukan pemilik platform. Konteks ini mencakup seluruh produk; istilah di bawah berlaku di PRD, kode, dan percakapan tim.

## Language

### Jalur kontribusi

**Campaign**:
Satu ajakan mengumpulkan dana daring dengan target, satu Fundraiser, dan tenggat yang wajib kecuali pada Kind `wakaf`. Semua uang daring masuk lewat Campaign, apa pun Kind-nya. Campaign tidak pernah dihapus; berhentinya selalu tercatat sebagai status (lihat [ADR 0016](./docs/adr/0016-campaigns-are-never-deleted.md)).
_Avoid_: Kampanye, program, project, penggalangan (untuk entitasnya)

**Campaign Status**:
Tahap hidup Campaign: Draft, Submitted, Rejected, Active, Suspended, Cancelled, Completed, Expired. Nama-nama ini dipakai apa adanya dalam kalimat; lencana status di layar menampilkan padanan Indonesianya (Draf, Diajukan, Ditolak, Aktif, Dibekukan, Ditarik, Selesai, Berakhir). Hanya Active yang menerima Donation. Expired terjadi otomatis saat tenggat lewat; Completed hanya bisa dicapai dari Active, ditetapkan Fundraiser atau Admin, dan butuh minimal satu Campaign Update siapa pun yang menetapkannya; setelah itu final, satu-satunya jalan keluar adalah Suspension. Tercapainya target tidak mengubah status. Campaign Active yang tenggatnya sudah lewat diperlakukan sebagai Expired walau belum dicatat demikian. Daftar publik (beranda, Urgent, jelajah, pencarian) hanya mencantumkan Campaign yang efektif Active; Campaign yang berakhir tetap bisa dibuka lewat tautannya dan tetap tercantum di sitemap, sedangkan yang Suspended, Cancelled, atau belum diloloskan tidak dicantumkan di mana pun. Halaman Campaign yang belum diloloskan (Draft, Submitted, Rejected) hanya bisa dibuka Fundraiser-nya, Verifier, dan Admin.
_Avoid_: State, pending, published

**Kind**:
Jenis Campaign yang menentukan aturan uangnya: `donation`, `zakat`, `wakaf`, atau `hibah`. Kind menentukan Platform Fee default dan dokumen yang wajib ada. Kind hanya bisa diubah selama Campaign masih Draft. Sejak diajukan, termasuk setelah Rejected, Kind terkunci; Campaign yang salah Kind dibuat ulang sebagai Campaign baru, supaya aturan izin per Kind tidak bisa dihindari lewat pengajuan ulang.
_Avoid_: Type, jenis campaign, kategori (Category adalah hal lain)

**Hibah**:
Kind Campaign untuk pemberian atau hibah institusional yang bukan zakat maupun wakaf: dananya ditransfer untuk tujuan tertentu, berbeda dari Wakaf yang mengikat aset itu selamanya. Perlakuan uangnya — kebutuhan Kind Authorisation, batas Refund, Platform Fee default — sementara mengikuti pola `wakaf` sampai ditinjau ulang terhadap ketentuan syariah yang berlaku; ini asumsi sementara, bukan keputusan final. Dokumen wajibnya untuk verifikasi tidak: Kind ini tidak punya Akad Wakaf maupun ikrar, dan checklist-nya meminta dokumen lembaga penerima dan Kind Authorisation `hibah` saja. Yang belum diputuskan adalah apakah dua dokumen itu sudah cukup dan apa lagi yang perlu ditambahkan; itu menunggu tinjauan syariah yang sama. Karena Kind menentukan dokumen wajibnya, checklist `hibah` punya barisnya sendiri, yang dapat dibedakan dari panel Admin tanpa menyentuh baris `wakaf`.
_Avoid_: Grant (di kode), donasi terarah, sumbangan

**Kind Authorisation**:
Izin bertanggal hasil verifikasi yang diberikan Verifier kepada sebuah Partner Organisation untuk membuat Campaign ber-Kind `zakat`, `wakaf`, atau `hibah`, berdasarkan dokumen lembaga yang ketentuannya ditetapkan Platform Operator. Saat tanggalnya lewat, Campaign ber-Kind itu berhenti menerima Donation sampai izinnya diperpanjang. Fundraiser perorangan hanya boleh `donation`.
_Avoid_: Amil flag, nazhir flag, permission

**Category**:
Tema Campaign untuk penjelajahan, misalnya kesehatan, pendidikan, kemanusiaan. Tidak mengubah aturan uang.
_Avoid_: Sektor (dipakai untuk CSR), tag

**Urgent**:
Tanda kurasi yang dipasang Admin pada Campaign Active agar ditonjolkan sebagai mendesak di beranda dan penjelajahan. Klaim publik yang menggeser perhatian Donor, karena itu tidak dipasang Fundraiser sendiri. Lepas dengan sendirinya begitu Campaign keluar dari Active dan tidak kembali tanpa keputusan Admin baru. Tidak mengubah aturan uang.
_Avoid_: Prioritas, featured, darurat

**Program**:
Item katalog kolaborasi CSR per Sektor yang dibaca tim CSR perusahaan. Program tidak menerima uang daring; kolaborasinya berjalan lewat Partnership Inquiry.
_Avoid_: Campaign CSR, proposal

**Tim CSR**:
Tim di perusahaan atau lembaga yang mencari program siap implementasi dan bukti dampaknya, lalu mengirim Partnership Inquiry. Ia membaca katalog Program, bukan Campaign, dan tidak memberi uang lewat Donation: Program tidak menerima uang daring. Berbeda dari Partner Organisation, yang juga bergerak di platform tetapi menjadi Fundraiser di atasnya. Ia memakai akun sendiri, diputuskan untuk Rilis 1, dan ia bukan Fundraiser: akunnya tidak membawa Campaign, Payout, atau Verification Request. Satu perusahaan boleh punya lebih dari satu Tim CSR. Permintaannya masuk ke antrean Admin, dan tanpa balasan ia tidak akan pernah tahu hasilnya. Pekerjaan seorang Tim CSR: menelusuri portofolio Program per Sector; membaca anggaran dan KPI sebuah Program; mengirim Partnership Inquiry; dan mencari tahu apa yang terjadi atas permintaannya. Dua pertama ada, dua terakhir belum.
_Avoid_: Mitra (dipakai untuk Partner Organisation), penggalang dana, foundations

**Sector**:
Pengelompokan Program CSR: Health, Education, Environment, Disability Inclusion.
_Avoid_: Category

**Partnership Inquiry**:
Pengajuan diskusi dari sebuah perusahaan atas satu Program, dengan status tindak lanjut oleh tim kemitraan.
_Avoid_: Lead, contact form, discuss with team (nama CTA, bukan entitas)

**Asset Waqf Inquiry**:
Pengajuan wakaf non-tunai (tanah, bangunan, barang) yang ditindaklanjuti nazhir terkait di luar payment gateway, dengan status tindak lanjut.
_Avoid_: Wakaf aset (di kode), donasi barang

**Volunteer Trip**:
Item katalog milik satu Fundraiser yang mengumpulkan Volunteer untuk ikut satu atau beberapa Volunteer Batch, dengan destinasi, itinerary, dan Trip Fee yang sama di semua Batch-nya. Bukan Campaign dan bukan Kind: uangnya bergerak sebagai Trip Fee, bukan Donation (lihat [ADR 0014](./docs/adr/0014-volunteer-trip-stays-separate-entity.md)). Dinamai "Trip", bukan "Program", supaya tidak tertukar dengan Program CSR di atas. Volunteer masuk Rilis 1, diputuskan 2026-09-27, sebelumnya hanya direncanakan untuk rilis 3.
_Avoid_: Volunteer Event, Volunteer Program, Kegiatan, activity, trip package

**Volunteer Batch**:
Satu jadwal bertanggal dari sebuah Volunteer Trip, dengan kuota maksimum sendiri dan kuota minimum sendiri yang diisi Fundraiser. Bila kuota minimumnya tidak tercapai sampai tenggat pendaftaran, Fundraiser membatalkan Batch itu dan setiap Registration yang sudah membayar Trip Fee mendapat Refund penuh.
_Avoid_: Jadwal, schedule, departure, cohort

**Registration**:
Pendaftaran satu Volunteer pada satu Volunteer Batch. Belum mengunci kuota sampai Trip Fee-nya Settlement; sebelum itu Registration hanya menahan kursi sementara selama 30 menit. Tidak ada Registration baru yang dibuka pada Volunteer Trip yang Suspended. Volunteer yang membatalkan Registration miliknya yang sudah `CONFIRMED` mendapat Refund bertingkat (lihat Trip Fee). Setelah Batch-nya diselesaikan, Registration tidak bisa dibatalkan lagi, dan Fundraiser menandai siapa yang hadir; hanya yang hadir menerima Sertifikat Keikutsertaan.
_Avoid_: Booking, sign-up

**Sertifikat Keikutsertaan**:
Bukti digital bahwa seorang Volunteer mengikuti sebuah Volunteer Batch, berbentuk halaman web publik dengan kode unik yang bisa dicetak, bukan berkas PDF buatan server (diputuskan 2026-09-29, `prd-audit/issues/10`). Terbit otomatis, satu per Registration, saat Fundraiser menyelesaikan Batch, hanya untuk Registration `CONFIRMED` yang ditandai hadir. Memuat nama Volunteer, Trip dan destinasi, tanggal Batch, penyelenggara, kode, dan tanggal terbit, dibekukan saat terbit; diterbitkan atas nama Fund for Indonesia (PT Jaya Korpora Prima) tanpa tanda tangan orang. Tidak bisa dikoreksi atau dicabut di Rilis 1. Bukan sertifikat wakaf.
_Avoid_: Ijazah, diploma, sertifikat wakaf

### Orang dan peran

**Donor**:
Orang yang membayar Donation. Tidak wajib punya akun. Pekerjaan seorang Donor: berdonasi tanpa wajib membuat akun; membaca Receipt-nya; mengirim ulang dan mencetak Receipt; melihat riwayat Donation-nya; dan menyembunyikan identitasnya pada sebuah Donation.
_Avoid_: Donatur (di kode), user, contributor

**Guest Donor**:
Donor tanpa akun; hanya meninggalkan data minimal yang dibutuhkan untuk Receipt. Bila ia kemudian mendaftar, Donation tamunya dengan email yang sama bisa menjadi riwayat akunnya (FFI-23, tiket 23), tetapi hanya setelah akun itu mengonfirmasi emailnya lewat tautan yang dikirim ke alamat tersebut (`User.emailVerifiedAt`; tautan sekali pakai, berlaku 24 jam, disimpan sebagai hash). Pencocokan memakai HMAC email di kedua sisi, tidak pernah memindai email yang didekripsi. Akun yang belum terkonfirmasi tidak melihat apa pun, seberapa pun emailnya cocok; mendaftar atau masuk dengan Google tidak mengonfirmasi apa pun (diputuskan 2026-10-02, [ADR 0022](./docs/adr/0022-google-sign-in-does-not-verify-email.md)); mendaftar dengan email milik orang lain tetap diizinkan, tetapi tidak mengklaim apa pun. Donation yang sudah dianonimkan tidak bisa cocok: anonimisasi (tiket 36, PR #172) mengosongkan HMAC-nya, dan klaim mencocokkan HMAC, bukan kolom `anonymisedAt` (kolom itu baru ada setelah #172 merge). Donation tamu dengan key id HMAC lama tidak diklaim setelah kunci dirotasi (gagal-aman) sampai HMAC-nya dibuat ulang dengan key id baru. Konfirmasi berlaku untuk satu alamat: setiap penulisan `email` atau `emailHmac` pada User wajib mengosongkan `emailVerifiedAt` dalam penulisan yang sama (lihat [ADR 0020](./docs/adr/0020-email-change-resets-verification.md)).

**Fundraiser**:
Pengguna terdaftar yang memiliki sebuah Campaign dan menerima Payout-nya. Organisasi program seperti YIEM adalah Fundraiser untuk Campaign yang dijalankannya sendiri; Platform Operator bukan Fundraiser. Setiap pengguna terdaftar boleh mengajukan Campaign atau Volunteer Trip; yang meloloskannya adalah Verifier, yang juga memverifikasi identitas Fundraiser pada pengajuan pertamanya. Tidak ada peringkat atau jenis akun yang membuat seseorang menjadi Fundraiser. Pekerjaan seorang Fundraiser: menyusun dan menyimpan Draft Campaign lengkap dengan dokumennya; mengajukan dan mempertahankan Verification Request; menulis Campaign Update; mengajukan dan memantau Payout; serta melaporkan pemakaian dana lewat Usage Report. Membagikan Campaign ke WhatsApp, Facebook, X, atau lewat tautan salinan juga pekerjaan Fundraiser (PRD FFI-06): tombol "Bagikan" di halaman Campaign membuka ShareModal, dan tiap kanal menandai tautannya dengan Traffic Source sendiri.
_Avoid_: Penggalang dana (di kode), creator, campaigner, owner

**Penerima Manfaat**:
Orang atau lembaga yang menerima dana sebuah Campaign, disebut pada halaman Campaign dan boleh tidak diisi karena tidak selalu diketahui. Tiga Campaign berbeda boleh menunjuk Penerima Manfaat yang sama; Verifier melihatnya lewat Petunjuk Duplikat, karena dana yang berulang ke penerima yang sama adalah pola kecurangan berulang. Disimpan sebagai teks biasa, bukan terenkripsi, dan tidak pernah dicari lewat indeks: yang dicari adalah kemiripan judul, bukan nama.
_Avoid_: penerima, penerima dana, penerima bantuan, beneficiary (untuk orangnya), donatur (menyalahartikan)

**Wakif**:
Donor pada Campaign ber-Kind `wakaf`. Dipakai di UI dan dokumen akad, bukan sebagai peran terpisah.

**Donor Hibah**:
Donor yang memberi hibah untuk lembaga atau tujuan tertentu, melalui Campaign ber-Kind `hibah`. Tetap seorang Donor, bukan peran terpisah: yang membedakan adalah tujuan dan lawannya, bukan statusnya di platform. Berbeda dari Wakif, tidak ada akad yang harus ia konfirmasi — dokumen dan izin melekat pada Collecting Entity, bukan padanya.
_Avoid__: Penghibah, pemberi hibah, wakif (untuk Kind `wakaf`), Donor Institusi

**Volunteer**:
Pengguna terdaftar yang mendaftar Volunteer Batch dan membayar Trip Fee-nya. Berbeda dari Donor: uangnya menutup partisipasinya sendiri, bukan disumbangkan untuk tujuan orang lain. Pekerjaan seorang Volunteer: menelusuri katalog Volunteer Trip dan Batch beserta tanggal dan harganya; mendaftar Volunteer Batch; membayar Trip Fee-nya; membaca konfirmasi pembayarannya; dan menerima sertifikat keikutsertaan.
_Avoid_: Relawan (di kode), Donor

**Platform Operator**:
PT Jaya Korpora Prima, pemilik dan pengelola platform. Memegang akun merchant penyedia pembayaran, mempekerjakan Verifier dan Admin, dan menerima Platform Fee. Bukan pemilik dana Campaign.
_Avoid_: YIEM, penyelenggara, pemilik platform

**Partner Organisation**:
Organisasi yang menjalankan program di atas platform dan menjadi Fundraiser, seperti YIEM. Didaftarkan Verifier setelah memeriksa dokumen legalnya, bersama satu akun Fundraiser yang bertindak atas namanya (anggota tim menyusul). Boleh menyatakan bersedia menaungi Campaign Fundraiser perorangan. Kind Authorisation melekat padanya, bukan pada Platform Operator.
_Avoid_: Mitra, lembaga, yayasan

**Collecting Entity**:
Badan hukum yang menghimpun dana sebuah Campaign atas izinnya sendiri, dicatat pada setiap Campaign. Selalu sebuah Partner Organisation; Platform Operator tidak pernah menjadi Collecting Entity. Fundraiser perorangan menghimpun di bawah Collecting Entity yang menaunginya, dipilihnya dari Partner Organisation yang bersedia menaungi dan dikonfirmasi Verifier saat meloloskan Verification Request. Campaign tanpa Collecting Entity tidak menerima Donation.
_Avoid_: Penghimpun, lembaga penerima, pemilik dana

**Fundraising Permit**:
Izin penghimpunan dana sosial bertanggal yang dipegang sebuah Collecting Entity, dicatat Verifier (nomor, penerbit, Kind yang dicakup, masa berlaku) setelah memeriksa dokumennya. Campaign hanya bisa dibuka bila Collecting Entity-nya memegang izin yang masih berlaku untuk Kind itu; saat izinnya lewat, Campaign berhenti menerima Donation sampai diperpanjang.
_Avoid_: Izin PUB (di kode), lisensi, legalitas

**Verifier**:
Peran di sisi Platform Operator yang meloloskan atau menolak Campaign, memasang Flag, memverifikasi identitas Fundraiser, memverifikasi dokumen legal Partner Organisation, mencatat Fundraising Permit pada Collecting Entity, memoderasi Volunteer Trip, memeriksa rekening tujuan baik untuk Payout maupun untuk Refund serta mencabut atau memulihkan verifikasinya, dan menilai Petunjuk Duplikat sebelum meloloskan. Tidak men-suspend; itu keputusan Admin. Seperti Admin, tidak pernah bertindak sebagai Verifier atas Campaign, Volunteer Trip, atau Bank Account miliknya sendiri. Di kode ini penugasan VERIFIER; Role lama MODERATOR tidak lagi memberi wewenang apa pun.
_Avoid_: Verifikator, moderator (di percakapan)

**Cancellation**:
Penarikan diri Fundraiser atas Campaign Active-nya sendiri, diajukan Fundraiser dan disetujui Admin yang bukan orang yang mengajukan, hanya selama belum ada Payout Completed. Selama pengajuan menunggu, Campaign tetap Active dan tetap menerima Donation; bila Campaign keluar dari Active sebelum diputuskan, pengajuan itu gugur dan harus diajukan ulang. Berbeda dari Suspension, yang merupakan pembekuan karena masalah.
_Avoid_: Pembatalan, close, withdraw

**Suspension**:
Pembekuan Campaign yang Active, Expired, atau Completed oleh Admin, lazimnya atas Flag dari Verifier; tanpa Flag pun boleh selama alasannya tercatat (lihat [ADR 0015](./docs/adr/0015-suspension-reaches-closed-campaigns.md)). Donation berhenti, Escrow Hold dan Campaign Balance dibekukan, Payout ditolak, dan Refund bisa dimulai. Hanya Admin yang bukan pelaku Suspension itu yang boleh mencabutnya; saat dicabut Campaign kembali ke status sebelum Suspension, kecuali Campaign yang tadinya Active dan tenggatnya sudah lewat, yang langsung menjadi Expired. Volunteer Trip yang Active juga bisa dibekukan Admin dengan alasan tercatat, bukan atas Flag, dan tidak pernah oleh Admin pemilik Trip itu. Selama Suspended, tidak ada Registration baru dan tidak ada Payout Trip Fee; Registration yang ada, termasuk yang Confirmed, tidak dibatalkan atau di-refund otomatis (pembatalan Batch tetap tindakan terpisah), dan Trip Fee yang settle atas penahanan kursi yang sudah ada tetap mengonfirmasi kursinya. Pencabutan mengikuti aturan Campaign: hanya Admin yang bukan pelaku Suspension itu.
_Avoid_: Ban, takedown, blokir

**Flag**:
Penanda dari Verifier bahwa sebuah Campaign perlu dipertimbangkan untuk Suspension, dengan alasan. Satu Campaign bisa punya beberapa Flag; masing-masing berakhir karena Suspension atau ditolak Admin beserta alasannya.
_Avoid_: Laporan (bentrok dengan Usage Report), report, aduan, dilaporkan

**Verification Request**:
Satu pengajuan Campaign untuk diperiksa Verifier, dengan checklist dokumen dan hasil lolos atau ditolak beserta alasan. Setiap submit ulang membuat Verification Request baru, sehingga riwayat penolakan tersimpan. Verifier hanya boleh meloloskannya bila setiap butir wajib pada checklist sudah dicentang. Selama belum diputuskan, Fundraiser boleh menariknya (tarik pengajuan; yang ditarik pengajuannya, berbeda dari Cancellation yang menarik Campaign Active): Campaign kembali ke Draft bila itu pengajuan pertamanya, atau ke Rejected bila pengajuan ulang. Campaign yang Draft atau Rejected boleh diedit dan diajukan lagi tanpa batas. Selama Submitted, isinya dibekukan agar Verifier memeriksa versi yang tetap. Pada Campaign Active, hanya cerita dan sampul yang boleh diubah langsung (judul dan deskripsi dibekukan sejak Active, lebih ketat dari PRD, agar Donor tidak menyumbang untuk satu tujuan lalu judulnya berganti); perubahan target, tenggat, atau Bank Account membutuhkan Verification Request baru. Ada tiga jenisnya: pengajuan dari Draft atau Rejected, perubahan atas Campaign Active, dan [Verifikasi Tambahan](#penanda-audit-dan-verifikasi-tambahan) yang dibuka platform sendiri. Hanya jenis pertama yang memindahkan status Campaign.
_Avoid_: Moderasi, review, approval

**Verifikasi Tambahan**:
Pemeriksaan ulang sebuah Campaign ke Verifier karena akumulasi Gross-nya melewati ambang yang berlaku, bukan karena ada yang mengajukan. Itu satu jenis Verification Request, dibuka System dan bukan Fundraiser, paling banyak satu kali seumur Campaign, dan hanya Verifier yang dapat menutupnya; Fundraiser tidak boleh menariknya, sebab permintaan yang bisa dicabut oleh orang yang diperiksa bukan pemeriksaan. Verifikasi Tambahan tidak memindahkan status dan tidak menahan donasi: Campaign tetap Active dan tetap menerima Donation sambil menunggu, dan Verifier tetap dapat memutuskan Permintaan itu setelah Campaign menutup. Menolaknya hanya mencatat kekhawatiran itu beserta alasannya, tanpa tindakan otomatis; satu-satunya jalan yang membekukan Campaign tetap Flag, yang diminta Verifier agar Admin memutuskan Suspension.
_Avoid_: Penanda (bentuknya berbeda), audit, Flag

**Penanda Audit**:
Catatan bahwa akumulasi Gross sebuah Campaign sudah melewati ambang audit, satu kali seumur Campaign, memuat akumulasi Gross dan ambangnya saat penanda itu dipasang. Bukan keputusan: tidak membekukan Campaign, tidak menahan donasi, dan tidak meminta siapa pun melakukan apa pun. Yang terekam adalah bahwa platform memperhatikan besarnya Campaign itu, untuk dibaca saat audit. Berbeda dengan [Verifikasi Tambahan](#penanda-audit-dan-verifikasi-tambahan), yang membawa Campaign ke antrean seorang Verifier; keduanya boleh ada pada Campaign yang sama. Pasangannya untuk satu Donation adalah [Penanda Donasi](#penanda-donasi).
_Avoid_: Flag (yang meminta Suspension), badge, tanda

**Penanda Donasi**:
Satu Donation yang besarnya melewati ambang Donation tunggal, dicatat untuk diperiksa Admin dan tidak pernah menahan apa pun: Donation-nya tetap settle, Receipt dan buku besarnya tetap utuh. Satu baris per Donation, seperti Penanda Audit satu baris per Campaign. Semua ambang ini dapat diatur Admin dan berdiri sendiri satu per satu: ambang kemiripan judul milik [Petunjuk Duplikat](#petunjuk-duplikat) adalah hal lain, karena yang satu dibandingkan antara dua Campaign saat review, sedangkan yang ini dibandingkan dengan uang yang benar-benar masuk.
_Avoid_: Flag (bentuknya milik Verifier dan untuk Suspension), penolakan, pengembalian dana, pemblokiran

**Batas Campaign Active**:
Jumlah Campaign Active yang boleh dijalankan satu Fundraiser sekaligus sebelum Usage Report pertamanya, dihitung ketika Verifier meloloskan Campaign baru: pelolosan yang akan melewati batas ditolak dan Campaign-nya tetap Submitted, tidak berpindah status. Campaign yang sudah Active tidak pernah dirusak oleh batas ini — tidak ada donasi yang ditahan dan tidak ada Campaign yang ditutup. Yang dihitung hanya Campaign Active milik Fundraiser itu sendiri yang tenggatnya belum lewat; Campaign yang sudah Expired, Completed, Cancelled, atau Suspended sudah melepas tempatnya, dan Campaign Demo tidak pernah dihitung karena angkanya bukan hasil penghimpunan. Usage Report kini ada (lihat [Usage Report](#uang)) dan sudah menggerbangi Payout berikutnya pada Campaign yang sama, tetapi belum menjadi jalan keluar dari batas ini: mengirim Usage Report pertama tidak melepas tempat sebuah Campaign dalam hitungan batas, sehingga untuk sekarang satu-satunya jalan melewatinya tetap membiarkan salah satu Campaign yang ada keluar dari Active.
_Avoid_: Flag, Suspension, batas Payout

**Petunjuk Duplikat**:
Lima Campaign paling mirip yang sedang diperiksa Verifier, atau lebih sedikit, dengan alasan masing-masing tercantum. Dicocokkan pada tiga hal: Fundraiser yang sama, kemiripan judul di atas ambang yang dapat diatur Admin, dan Penerima Manfaat yang sama persis. Ambangnya 0,6 sampai Admin mengaturnya, dan kesimirannya memakai ekstensi Postgres `pg_trgm`. Tujuannya menahan duplikat dan kecurangan berulang sebelum dipublikasikan, bukan sesudahnya. Checklist punya butir wajib "bukan duplikat", dan verdict-nya ikut tersimpan bersama Verification Request, sehingga keputusan itu tercatat dan bukan sekadar tidak ditampilkan.
_Avoid_: duplikat (untuk Campaign-nya), similar, recommendations, campaign suggestions

**Identity Verification**:
Catatan bertanggal bahwa seorang Verifier sudah memeriksa identitas seorang Fundraiser, dibuat saat Verification Request pertamanya diloloskan. Berlaku untuk pengajuan berikutnya; tidak pernah diklaim sendiri oleh Fundraiser.
_Avoid_: Terverifikasi (sebagai lencana), isVerified, verified badge

**Capacity**:
Peran yang dipakai seseorang untuk satu tindakan: Fundraiser, Verifier, Admin, atau System (tindakan otomatis platform). Satu orang boleh memegang beberapa penugasan, tetapi setiap tindakan tercatat dalam tepat satu Capacity. Atas Campaign atau Volunteer Trip miliknya sendiri, seseorang hanya bisa bertindak sebagai Fundraiser.
_Avoid_: Role (di kode itu hierarki lama), peran, jabatan

**Admin**:
Peran di sisi Platform Operator yang menyetujui Payout, melihat rekonsiliasi, mengelola peran pengguna, memutuskan dan mencabut Suspension, menyetujui Cancellation, menandai Campaign Completed, memasang dan melepas Urgent, serta menyusun checklist dokumen Verification Request (berlaku untuk pengajuan berikutnya saja), menyetujui dan menolak Refund, mencatat Manual Contribution, dan membuat rekap keuangan. Tidak pernah bertindak sebagai Admin atas Campaign atau Volunteer Trip miliknya sendiri; di sana ia hanya Fundraiser. Penugasan terpisah dari Verifier; satu orang boleh memegang keduanya.

### Uang

**Donation**:
Niat memberi dari satu Donor ke satu Campaign dengan nominal tertentu. Donation belum memindahkan uang sampai Payment-nya settle.
_Avoid_: Donasi (di kode), transaction, contribution

**Trip Fee**:
Nominal yang dibayar Volunteer untuk satu Registration pada Volunteer Batch, menutup biaya partisipasinya sendiri (transport, akomodasi, konsumsi). Bukan Donation dan bukan kontribusi untuk komunitas tujuan; memakai jalur Payment, Escrow Hold, dan Payout yang sama dengan Campaign tanpa menjadi Kind (lihat [ADR 0014](./docs/adr/0014-volunteer-trip-stays-separate-entity.md)). Tidak dipotong Platform Fee. Refund-nya bertingkat menurut jarak waktu ke keberangkatan saat Volunteer membatalkan (14 hari atau lebih: penuh; 3 sampai 13 hari: separuh; kurang dari 3 hari atau sesudah berangkat: tidak ada; diputuskan 2026-09-29, angkanya di `src/lib/volunteer/refunds.ts`), dan penuh tanpa syarat waktu saat Fundraiser membatalkan Batch — berbeda dari Refund Gross Campaign (ADR 0007), yang tidak berlaku untuk Trip Fee. Bila Trip Fee-nya justru settle setelah Registration-nya sudah dibatalkan (baik oleh Volunteer sendiri maupun oleh pembatalan Batch), sistem mengembalikan penuh secara otomatis begitu penyelesaian itu terdeteksi — aturan ketiga ini, terpisah dari kedua aturan Refund di atas. Aturan ketiga ini juga berlaku bila penahanan kursinya sudah kedaluwarsa sebelum Trip Fee settle (diputuskan 2026-09-29, `rilis-1-benda/issues/40`), dan bila kursinya sudah hilang saat Payment-nya dibayar setelah `EXPIRED` atau `FAILED` (diputuskan 2026-10-02, `rilis-1-benda/issues/52`). Bila Payment-nya `EXPIRED` tetapi Registration-nya masih `HOLD`, kursinya masih ada, jadi Trip Fee tetap dikonfirmasi dan tidak di-refund. Berbeda dengan Donation, yang tidak di-refund dalam keadaan serupa (lihat Settlement dan [ADR 0021](./docs/adr/0021-donation-paid-after-expiry-still-settles.md)).
_Avoid_: Donation, Program Fee, biaya trip (di kode), tiket

**Payment**:
Tagihan di penyedia pembayaran untuk satu Donation. Satu Donation boleh punya beberapa Payment bila Donor mencoba lagi setelah gagal atau kedaluwarsa, tetapi paling banyak satu yang Settlement.
_Avoid_: Transaction, charge, invoice

**Settlement**:
Saat penyedia pembayaran mengonfirmasi Payment dibayar. Hanya setelah ini uang dicatat. Berbeda dari saat dana benar-benar masuk saldo penyedia, yang datang belakangan. Payment Donation yang dibayar setelah berstatus `EXPIRED` atau `FAILED` tetap Settlement dan tidak di-refund, supaya uang Donor sampai ke Campaign (diputuskan 2026-10-02, [ADR 0021](./docs/adr/0021-donation-paid-after-expiry-still-settles.md)).
_Avoid_: Confirmed, paid (sebagai kata benda)

**Platform Fee**:
Potongan persentase dari Donation yang diambil platform, diatur Admin per Kind dengan override per Category dan per Campaign, dibebaskan di bawah ambang nominal yang juga diatur Admin, dan ditampilkan terbuka di halaman Campaign. Setiap Payment menyimpan fee yang berlaku saat dibuat.
_Avoid_: Biaya admin, potongan, cut

**Payment Provider**:
Pihak ketiga yang menagih Payment atau mengirim Payout: Sumopod sebelum launching, lalu Midtrans, Xendit, DOKU, Stripe, dan lainnya yang diaktifkan Admin. Setiap Payment mencatat penyedianya.
_Avoid_: Gateway, PG, merchant

**Merchant Account**:
Akun di Payment Provider tempat Payment masuk, dipegang Platform Operator dan tidak pernah dipakai bersama platform lain dalam grup. Berbeda dari rekening penghimpunan, yang dimiliki Collecting Entity.
_Avoid_: Akun gateway, rekening merchant, akun PG

**Provider Fee**:
Biaya yang dipotong penyedia pembayaran atas satu Payment, dibaca dari payload penyedia dan ditanggung Campaign. Bukan pendapatan platform.
_Avoid_: Biaya admin, gateway fee

**Gross**:
Nominal yang dibayar Donor untuk satu Payment, sebelum Provider Fee dan Platform Fee. Sama dengan nominal Donation, karena tidak ada tambahan apa pun di atasnya.

**Net**:
Gross dikurangi Provider Fee dan Platform Fee; nominal yang benar-benar dikreditkan ke Campaign.

**Provider Balance**:
Dana yang sudah dibayar Donor tetapi masih berada di saldo penyedia pembayaran atas nama Platform Operator dan belum ditarik ke rekening penghimpunan. Tercatat sebagai akun buku besar tersendiri per penyedia.
_Avoid_: Saldo gateway, dana mengendap

**Frozen Balance**:
Dana sebuah Payment yang dipindahkan keluar dari Escrow Hold atau Campaign Balance lewat jurnal begitu Refund dibuat, sehingga tidak lagi terlihat tersedia maupun bisa ikut Payout. Tetap menjadi hak Donor tanpa batas waktu.
_Avoid_: Dana beku, hold, freeze

**Program Balance**:
Dana CSR yang tercatat pada sebuah Program, bukan Campaign. Tidak pernah bisa dicairkan lewat Payout karena Program tidak menerima uang daring.
_Avoid_: Saldo CSR, dana program

**Escrow Hold**:
Masa tunggu sejak perkiraan settlement penyedia selama dana belum bisa diminta sebagai Payout, untuk memberi ruang Refund dan margin atas keterlambatan settlement. Default tujuh hari, diatur Admin dan boleh dipendekkan untuk Campaign bencana; lamanya dibekukan pada setiap Payment saat dibuat dan ditampilkan di halaman Campaign. Selama Campaign Suspended, dana yang lewat masa tunggu tidak dilepas ke Campaign Balance; pelepasan berlanjut begitu Suspension dicabut.
_Avoid_: Holding period, pending balance

**Campaign Balance**:
Dana Net yang sudah lewat Escrow Hold dan belum dibayarkan lewat Payout. Selalu dihitung dari buku besar, bukan dari angka tampilan.
_Avoid_: Collected amount, saldo, dana terkumpul (angka tampilan Gross)

**Payout**:
Permintaan Fundraiser untuk mengirim sebagian Campaign Balance ke Bank Account terverifikasinya, disetujui satu Admin, lalu ditarik dari dashboard penyedia dan ditandai selesai dengan bukti transfer oleh Admin yang berbeda. Hanya bisa diajukan dan disetujui selama Campaign Active, Expired, atau Completed; Suspended dan Cancelled menolaknya, termasuk bila Suspension jatuh di antara pengajuan dan persetujuan. Payout Trip Fee ditolak untuk Volunteer Trip yang Suspended, sama seperti untuk Campaign yang Suspended.
_Avoid_: Pencairan (di kode), disbursement, withdrawal

**Usage Report**:
Laporan Fundraiser tentang pemakaian dana sebuah Payout: narasi, rincian per pos yang jumlahnya sama persis dengan nominal Payout, jumlah penerima manfaat, dan minimal satu foto bukti. Tampil publik di halaman Campaign sejak dikirim, tanpa menunggu tinjauan. Dikirim Fundraiser dari layar Payout miliknya sendiri; dibaca publik lewat tab "Pencairan Dana" Campaign. Admin bisa menandainya "dipertanyakan" beserta alasan dari layar detail Payout; alasan itu ikut tampil publik, dan tidak ada jalan mencabutnya lagi. Sebuah Payout berikutnya pada Campaign yang sama tidak bisa diajukan selama ada Payout Completed sebelumnya yang belum punya Usage Report, atau yang Usage Report-nya ditandai dipertanyakan (ticket 22). Khusus Campaign: Volunteer Trip tidak punya kewajiban ini, karena Trip Fee bukan Kind dan bukan Campaign (ADR 0014), dan entri ini sendiri menamai rumahnya "halaman Campaign". Batas Campaign Active di entri [Batas Campaign Active](#batas-campaign-active) masih menyebut Usage Report pertama sebagai jalan keluarnya; jalan itu sendiri belum berlaku -- yang sudah berlaku baru gerbang pada Payout berikutnya.
_Avoid_: Laporan penggunaan dana (di kode), impact report (itu untuk Program CSR)

**Manual Contribution**:
Dana yang masuk di luar payment gateway, seperti transfer langsung atau tunai, dicatat Admin dengan bukti dan aturan dua orang, lalu langsung menjadi Campaign Balance atau Program Balance tanpa Escrow Hold dan tanpa kedua fee. Bisa dibalikkan lewat jurnal lawan, tidak pernah dihapus.
_Avoid_: Offline donation, donasi manual, top-up

**Refund**:
Pengembalian uang satu Payment ke Donor, penuh sebesar Gross atau sebagian darinya, tidak pernah dikurangi biaya apa pun. Dibuat satu Admin, disetujui Admin lain yang mencatat tujuan transfernya (lihat pengecualian Rilis 1 di [Bank Account](#bank-account)), dan diselesaikan Admin ketiga yang berbeda dari penyetujunya dan mengetik ulang nomor rekening tujuan sebagai pasangan mata kedua; Provider Fee yang tidak kembali ditanggung platform.

**Dormant Balance**:
Dirancang untuk Campaign Balance pada Campaign yang sudah Expired atau Completed dan tidak dicairkan lama, yang akhirnya dialihkan ke Campaign ber-Kind sama milik Partner Organisation yang sama. Yang sudah ada hanya **laporan 60 hari** untuk Admin: Campaign Expired atau Completed yang Campaign Balance-nya belum dicairkan 60 hari atau lebih. Pengalihan 180 hari dan pengingat Fundraiser **belum ada** dan tidak masuk Rilis 1, jadi saldo itu tetap Campaign Balance biasa; laporan hanya membuatnya terlihat.
_Avoid_: Saldo menganggur, dana nganggur, unclaimed

**Bank Account**:
Rekening tujuan uang keluar yang sudah diperiksa Verifier: milik Fundraiser untuk Payout, atau milik Donor untuk Refund. Diberikan oleh pemiliknya sendiri di profilnya, tanpa `verifiedAt`, lalu diajukan untuk diperiksa lewat antrean verifikasi tersendiri milik Bank Account, bukan lewat Verification Request sebuah Campaign. Alur ini diputuskan 2026-09-27 (ADR 0018) dan sudah berkode sejak Rilis 1: siapa pun yang masuk boleh menambahkan Bank Account miliknya sendiri, mengajukannya, dan seorang Verifier -- bukan pemiliknya sendiri -- meloloskan atau menolaknya. Sebuah Bank Account yang belum pernah diajukan dan belum terverifikasi boleh dihapus pemiliknya; sebuah Bank Account tidak pernah bisa diedit, karena nomornya adalah yang ditunjuk sebuah Payout -- kesalahan diperbaiki dengan menghapus lalu menambah ulang, bukan mengedit. Account yang sudah terverifikasi tidak diperiksa ulang di Campaign berikutnya; yang diulang hanya rujukan, bukan pemeriksaannya. Alur yang sama dimaksudkan untuk rekening Refund milik Donor, dan pemeriksaannya tetap Verifier meski Refund diproses Admin, karena uang yang kembali ke rekening yang salah tidak bisa dipanggil balik -- tetapi Donor Tamu Rilis 1 tidak punya profil untuk menaruh Bank Account di atasnya, jadi belum ada Bank Account yang bisa diajukan ke Verifier untuk Refund. Pengecualian Rilis 1 (keputusan owner 2026-09-28, Amandemen ADR 0018): tujuan Refund dicatat langsung pada Refund-nya sendiri, bukan sebagai Bank Account, dengan dua pasang mata Admin sebagai gantinya -- Admin yang menyetujui Refund mencatat tujuannya dari permintaan tertulis Donor, dan Admin yang menyelesaikannya, berbeda orang, mengetik ulang nomor rekening itu dan ditolak bila tidak cocok dengan yang tercatat. Begitu Donor bisa menyimpan Bank Account di profilnya, Refund kembali memakai pemeriksaan Verifier penuh seperti Payout, dan pengecualian ini berakhir. Verifier yang memeriksa Bank Account tidak boleh pemilik Bank Account itu, sama seperti larangan bertindak atas Campaign miliknya sendiri. Yang tercatat bukan hanya bahwa seseorang memeriksa, melainkan bank, nama seperti tertulis pada dokumen, dan catatan bebas satu kalimat yang menyatakan apa yang dilihat; dokumennya tidak diunggah. Satu orang boleh memegang lebih dari satu. Nomor rekeningnya disimpan terenkripsi dan tidak pernah dicari, jadi tidak ada apa pun yang menolak nomor yang sama tercatat dua kali -- satu orang bisa saja punya dua Bank Account dengan rekening yang sama dan tidak ada yang memberitahunya. Memulihkan jaminan keunikan berarti menambah pencarian terenkripsi untuk nomor rekening, yang memang tidak ada (ADR 0012). Karena tidak ada yang bisa menolak nomor yang sama, Bank Account yang ditunjuk Fundraiser adalah keputusan yang tercatat dan dapat diubah -- Account itu yang diperiksa sebelum Payout yang menunjuknya disetujui. Verifikasi sebuah Bank Account bisa dicabut dan dipulihkan lagi (keputusan owner 2026-09-28): yang mencabut adalah Verifier yang bukan pemiliknya dan bukan yang terakhir meloloskannya, yang memulihkan adalah Verifier yang bukan pemiliknya dan bukan yang mencabutnya, dan keduanya wajib menyertakan alasan serta memberi tahu pemiliknya. Pencabutan hanya mengosongkan `verifiedAt`, sehingga Payout yang belum selesai ke rekening itu ditolak di langkah berikutnya, sedangkan Payout yang sudah selesai tidak disentuh; ini tindakan terpisah dari Suspension sebuah Campaign. Setiap pencabutan dan pemulihan tercatat berurutan beserta pelaku dan alasannya, jadi rekening yang pernah dicabut lalu dipulihkan tetap bisa dibedakan dari yang tidak pernah dicabut.

### Kepercayaan

**Campaign Update**:
Kabar perkembangan yang ditulis Fundraiser pada Campaign-nya dan dikirim ke semua Donor-nya. Minimal satu sebelum Campaign boleh ditandai selesai.
_Avoid_: Impact update, kabar terbaru, news

**Traffic Source**:
Asal kunjungan yang tercatat pada sebuah Donation dari parameter tautan yang dibagikan, untuk menghitung sumber trafik per tautan.
_Avoid_: UTM, referrer, analytics

**Receipt**:
Bukti Donation yang dikirim ke email Donor setelah Settlement, dengan halaman cetak yang bisa dibuka ulang dari email atau dashboard.
_Avoid_: Invoice, tanda terima (di kode), kwitansi

**Akad Wakaf**:
Dokumen ikrar per Donation pada Campaign `wakaf`, memuat nama Wakif, nominal, peruntukan, dan nazhir, dikirim bersama Receipt.
_Avoid_: Sertifikat wakaf, deed

**Demo Campaign**:
Campaign yang datanya fiktif. Tidak pernah dicantumkan di katalog, di hasil pencarian, maupun di sitemap, dan angkanya tidak masuk hitungan Impact, karena halaman Impact menjumlahkan Campaign yang bisa ditemukan di katalog. Halamannya sendiri tetap terbuka lewat tautannya dan tetap memakai lencana yang menyatakannya, dan tetap ditolak menerima Donation maupun Payout. Admin tetap melihatnya di layar mereka. Yang menentukan mana adalah kolom `isDemo` pada barisnya, bukan nama, slug, atau daftar Campaign tertentu.
_Avoid_: Sample, test campaign, contoh (di kode)

**Prayer**:
Pesan dukungan singkat dari Donor yang tampil di halaman Campaign. Bukan jalur kontribusi.
_Avoid_: Doa (di kode), comment

### Rilis

**Rilis 1**:
Rilis yang dianggap selesai saat gerbang Fase 0, 1, 2, dan 3 PRD §11 semuanya lolos, termasuk Volunteer Trip dengan Trip Fee nyata, dan tidak ada langkahnya yang memerlukan akses basis data langsung. Isi Fase 3 di luar gerbangnya diputuskan per item, bukan ikut otomatis. Diputuskan 2026-09-28; sebelumnya Rilis 1 berarti Fase 0 sampai 2.
_Avoid_: v1 (untuk ruang lingkupnya), MVP, rilis pertama (tanpa nama)

**Soft Launch**:
Saat platform mulai menerima uang publik sebelum Rilis 1 selesai, diizinkan begitu gerbang Fase 2 lolos: sebuah Donation bisa sampai ke rekening bank terverifikasi seorang Fundraiser lewat Payout tanpa akses basis data. Menerima uang publik sebelum gerbang Fase 2 tidak diizinkan, karena janji penyalurannya belum bisa ditepati di dalam produk.
_Avoid_: go-live (untuk tahap ini), beta
