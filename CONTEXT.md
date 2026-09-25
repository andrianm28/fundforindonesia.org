# Fund for Indonesia

Platform social impact yang dioperasikan PT Jaya Korpora Prima, menyatukan donasi, galang dana, zakat, wakaf, hibah, dan kolaborasi CSR dalam satu akun dan satu riwayat dampak. Volunteer tetap ada di produk tanpa slot menu utama, membayar Trip Fee untuk menutup biaya partisipasinya sendiri; jalur uangnya terpisah dari Campaign meski memakai infrastruktur Payment yang sama, lihat Volunteer Trip di bawah dan [ADR 0014](./docs/adr/0014-volunteer-trip-stays-separate-entity.md). Yayasan Indonesia Emas Merdeka (YIEM) adalah organisasi program pertama di atasnya, bukan pemilik platform. Konteks ini mencakup seluruh produk; istilah di bawah berlaku di PRD, kode, dan percakapan tim.

## Language

### Jalur kontribusi

**Campaign**:
Satu ajakan mengumpulkan dana daring dengan target, satu Fundraiser, dan tenggat yang wajib kecuali pada Kind `wakaf`. Semua uang daring masuk lewat Campaign, apa pun Kind-nya.
_Avoid_: Kampanye, program, project, penggalangan (untuk entitasnya)

**Campaign Status**:
Tahap hidup Campaign: Draft, Submitted, Rejected, Active, Suspended, Cancelled, Completed, Expired. Hanya Active yang menerima Donation. Expired terjadi otomatis saat tenggat lewat; Completed hanya bisa dicapai dari Active, ditetapkan Fundraiser atau Admin, dan butuh minimal satu Campaign Update siapa pun yang menetapkannya; setelah itu final, satu-satunya jalan keluar adalah Suspension. Tercapainya target tidak mengubah status. Campaign Active yang tenggatnya sudah lewat diperlakukan sebagai Expired walau belum dicatat demikian.
_Avoid_: State, pending, published

**Kind**:
Jenis Campaign yang menentukan aturan uangnya: `donation`, `zakat`, `wakaf`, atau `hibah`. Kind menentukan Platform Fee default dan dokumen yang wajib ada.
_Avoid_: Type, jenis campaign, kategori (Category adalah hal lain)

**Hibah**:
Kind Campaign untuk pemberian atau hibah institusional yang bukan zakat maupun wakaf: dananya ditransfer untuk tujuan tertentu, berbeda dari Wakaf yang mengikat aset itu selamanya. Perlakuan uangnya — kebutuhan Kind Authorisation, batas Refund, Platform Fee default — sementara mengikuti pola `wakaf` sampai ditinjau ulang terhadap ketentuan syariah yang berlaku; ini asumsi sementara, bukan keputusan final.
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
Item katalog milik satu Fundraiser yang mengumpulkan Volunteer untuk ikut satu atau beberapa Volunteer Batch, dengan destinasi, itinerary, dan Trip Fee yang sama di semua Batch-nya. Bukan Campaign dan bukan Kind: uangnya bergerak sebagai Trip Fee, bukan Donation (lihat [ADR 0014](./docs/adr/0014-volunteer-trip-stays-separate-entity.md)). Dinamai "Trip", bukan "Program", supaya tidak tertukar dengan Program CSR di atas.
_Avoid_: Volunteer Event, Volunteer Program, Kegiatan, activity, trip package

**Volunteer Batch**:
Satu jadwal bertanggal dari sebuah Volunteer Trip, dengan kuota maksimum sendiri dan kuota minimum sendiri yang diisi Fundraiser. Bila kuota minimumnya tidak tercapai sampai tenggat pendaftaran, Fundraiser membatalkan Batch itu dan setiap Registration yang sudah membayar Trip Fee mendapat Refund penuh.
_Avoid_: Jadwal, schedule, departure, cohort

**Registration**:
Pendaftaran satu Volunteer pada satu Volunteer Batch. Belum mengunci kuota sampai Trip Fee-nya Settlement; sebelum itu Registration hanya menahan kursi sementara dalam jendela waktu terbatas.
_Avoid_: Booking, sign-up

### Orang dan peran

**Donor**:
Orang yang membayar Donation. Tidak wajib punya akun.
_Avoid_: Donatur (di kode), user, contributor

**Guest Donor**:
Donor tanpa akun; hanya meninggalkan data minimal yang dibutuhkan untuk Receipt.

**Fundraiser**:
Pengguna terdaftar yang memiliki sebuah Campaign dan menerima Payout-nya. Organisasi program seperti YIEM adalah Fundraiser untuk Campaign yang dijalankannya sendiri; Platform Operator bukan Fundraiser.
_Avoid_: Penggalang dana (di kode), creator, campaigner, owner

**Wakif**:
Donor pada Campaign ber-Kind `wakaf`. Dipakai di UI dan dokumen akad, bukan sebagai peran terpisah.

**Volunteer**:
Pengguna terdaftar yang mendaftar Volunteer Batch dan membayar Trip Fee-nya. Berbeda dari Donor: uangnya menutup partisipasinya sendiri, bukan disumbangkan untuk tujuan orang lain.
_Avoid_: Relawan (di kode), Donor

**Platform Operator**:
PT Jaya Korpora Prima, pemilik dan pengelola platform. Memegang akun merchant penyedia pembayaran, mempekerjakan Verifier dan Admin, dan menerima Platform Fee. Bukan pemilik dana Campaign.
_Avoid_: YIEM, penyelenggara, pemilik platform

**Partner Organisation**:
Organisasi yang menjalankan program di atas platform dan menjadi Fundraiser, seperti YIEM. Kind Authorisation melekat padanya, bukan pada Platform Operator.
_Avoid_: Mitra, lembaga, yayasan

**Collecting Entity**:
Badan hukum yang menghimpun dana sebuah Campaign atas izinnya sendiri, dicatat pada setiap Campaign. Selalu sebuah Partner Organisation; Platform Operator tidak pernah menjadi Collecting Entity. Fundraiser perorangan menghimpun di bawah Collecting Entity yang menaunginya.
_Avoid_: Penghimpun, lembaga penerima, pemilik dana

**Fundraising Permit**:
Izin penghimpunan dana sosial bertanggal yang dipegang sebuah Collecting Entity. Campaign hanya bisa dibuka bila Collecting Entity-nya memegang izin yang masih berlaku untuk Kind itu; saat izinnya lewat, Campaign berhenti menerima Donation sampai diperpanjang.
_Avoid_: Izin PUB (di kode), lisensi, legalitas

**Verifier**:
Peran di sisi Platform Operator yang meloloskan atau menolak Campaign, memasang Flag, memverifikasi identitas Fundraiser, dan memeriksa rekening tujuan baik untuk Payout maupun untuk Refund. Tidak men-suspend; itu keputusan Admin. Di kode peran ini bernama MODERATOR.
_Avoid_: Verifikator, moderator (di percakapan)

**Cancellation**:
Penarikan diri Fundraiser atas Campaign Active-nya sendiri, diajukan Fundraiser dan disetujui Admin yang bukan orang yang mengajukan, hanya selama belum ada Payout Completed. Selama pengajuan menunggu, Campaign tetap Active dan tetap menerima Donation; bila Campaign keluar dari Active sebelum diputuskan, pengajuan itu gugur dan harus diajukan ulang. Berbeda dari Suspension, yang merupakan pembekuan karena masalah.
_Avoid_: Pembatalan, close, withdraw

**Suspension**:
Pembekuan Campaign yang Active, Expired, atau Completed oleh Admin, lazimnya atas Flag dari Verifier; tanpa Flag pun boleh selama alasannya tercatat (lihat [ADR 0015](./docs/adr/0015-suspension-reaches-closed-campaigns.md)). Donation berhenti, Escrow Hold dan Campaign Balance dibekukan, Payout ditolak, dan Refund bisa dimulai. Hanya Admin yang bukan pelaku Suspension itu yang boleh mencabutnya; saat dicabut Campaign kembali ke status sebelum Suspension, kecuali Campaign yang tadinya Active dan tenggatnya sudah lewat, yang langsung menjadi Expired.
_Avoid_: Ban, takedown, blokir

**Flag**:
Penanda dari Verifier bahwa sebuah Campaign perlu dipertimbangkan untuk Suspension, dengan alasan. Satu Campaign bisa punya beberapa Flag; masing-masing berakhir karena Suspension atau ditolak Admin beserta alasannya.
_Avoid_: Laporan (bentrok dengan Usage Report), report, aduan, dilaporkan

**Verification Request**:
Satu pengajuan Campaign untuk diperiksa Verifier, dengan checklist dokumen dan hasil lolos atau ditolak beserta alasan. Setiap submit ulang membuat Verification Request baru, sehingga riwayat penolakan tersimpan.
_Avoid_: Moderasi, review, approval

**Admin**:
Peran di sisi Platform Operator yang menyetujui Payout, melihat rekonsiliasi, mengelola peran pengguna, memutuskan dan mencabut Suspension, menyetujui Cancellation, menandai Campaign Completed, dan memasang Urgent. Tidak pernah bertindak sebagai Admin atas Campaign miliknya sendiri; di sana ia hanya Fundraiser. Penugasan terpisah dari Verifier; satu orang boleh memegang keduanya.

### Uang

**Donation**:
Niat memberi dari satu Donor ke satu Campaign dengan nominal tertentu. Donation belum memindahkan uang sampai Payment-nya settle.
_Avoid_: Donasi (di kode), transaction, contribution

**Trip Fee**:
Nominal yang dibayar Volunteer untuk satu Registration pada Volunteer Batch, menutup biaya partisipasinya sendiri (transport, akomodasi, konsumsi). Bukan Donation dan bukan kontribusi untuk komunitas tujuan; memakai jalur Payment, Escrow Hold, dan Payout yang sama dengan Campaign tanpa menjadi Kind (lihat [ADR 0014](./docs/adr/0014-volunteer-trip-stays-separate-entity.md)). Tidak dipotong Platform Fee. Refund-nya bertingkat menurut jarak waktu ke keberangkatan saat Volunteer membatalkan, dan penuh tanpa syarat waktu saat Fundraiser membatalkan Batch — berbeda dari Refund Gross Campaign (ADR 0007), yang tidak berlaku untuk Trip Fee. Bila Trip Fee-nya justru settle setelah Registration-nya sudah dibatalkan (baik oleh Volunteer sendiri maupun oleh pembatalan Batch), sistem mengembalikan penuh secara otomatis begitu penyelesaian itu terdeteksi — aturan ketiga ini, terpisah dari kedua aturan Refund di atas.
_Avoid_: Donation, Program Fee, biaya trip (di kode), tiket

**Payment**:
Tagihan di penyedia pembayaran untuk satu Donation. Satu Donation boleh punya beberapa Payment bila Donor mencoba lagi setelah gagal atau kedaluwarsa, tetapi paling banyak satu yang Settlement.
_Avoid_: Transaction, charge, invoice

**Settlement**:
Saat penyedia pembayaran mengonfirmasi Payment dibayar. Hanya setelah ini uang dicatat. Berbeda dari saat dana benar-benar masuk saldo penyedia, yang datang belakangan.
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
Masa tunggu sejak perkiraan settlement penyedia selama dana belum bisa diminta sebagai Payout, untuk memberi ruang Refund dan margin atas keterlambatan settlement. Default tujuh hari, diatur Admin dan boleh dipendekkan untuk Campaign bencana; lamanya dibekukan pada setiap Payment saat dibuat dan ditampilkan di halaman Campaign.
_Avoid_: Holding period, pending balance

**Campaign Balance**:
Dana Net yang sudah lewat Escrow Hold dan belum dibayarkan lewat Payout. Selalu dihitung dari buku besar, bukan dari angka tampilan.
_Avoid_: Collected amount, saldo, dana terkumpul (angka tampilan Gross)

**Payout**:
Permintaan Fundraiser untuk mengirim sebagian Campaign Balance ke Bank Account terverifikasinya, disetujui satu Admin, lalu ditarik dari dashboard penyedia dan ditandai selesai dengan bukti transfer oleh Admin yang berbeda.
_Avoid_: Pencairan (di kode), disbursement, withdrawal

**Usage Report**:
Laporan Fundraiser tentang pemakaian dana sebuah Payout, tampil publik di halaman Campaign. Syarat sebelum Payout berikutnya boleh diajukan.
_Avoid_: Laporan penggunaan dana (di kode), impact report (itu untuk Program CSR)

**Manual Contribution**:
Dana yang masuk di luar payment gateway, seperti transfer langsung atau tunai, dicatat Admin dengan bukti dan aturan dua orang, lalu langsung menjadi Campaign Balance atau Program Balance tanpa Escrow Hold dan tanpa kedua fee. Bisa dibalikkan lewat jurnal lawan, tidak pernah dihapus.
_Avoid_: Offline donation, donasi manual, top-up

**Refund**:
Pengembalian uang satu Payment ke Donor, penuh sebesar Gross atau sebagian darinya, tidak pernah dikurangi biaya apa pun. Dibuat satu Admin, disetujui Admin lain, dan diselesaikan Admin yang berbeda dari penyetujunya; Provider Fee yang tidak kembali ditanggung platform.

**Dormant Balance**:
Campaign Balance pada Campaign yang sudah Expired atau Completed dan tidak dicairkan lebih dari 180 hari meski Fundraiser sudah tiga kali diingatkan. Muncul di laporan Admin sejak 60 hari, dan baru disebut Dormant Balance setelah 180 hari. Pengalihannya ke Campaign ber-Kind sama milik Partner Organisation yang sama ada di roadmap; sampai itu ada, ditangani Admin kasus per kasus.
_Avoid_: Saldo menganggur, dana nganggur, unclaimed

**Bank Account**:
Rekening tujuan uang keluar yang sudah diperiksa Verifier: milik Fundraiser untuk Payout, atau milik Donor untuk Refund.

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
Campaign yang boleh dilihat tetapi ditolak menerima Donation dan Payout karena datanya fiktif.
_Avoid_: Sample, test campaign, contoh (di kode)

**Prayer**:
Pesan dukungan singkat dari Donor yang tampil di halaman Campaign. Bukan jalur kontribusi.
_Avoid_: Doa (di kode), comment
