import 'dotenv/config';
import { PrismaClient, Role } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ==================== Helper Functions ====================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// ==================== Seed Data ====================

const CATEGORIES = [
  { name: 'Bencana Alam', slug: 'bencana-alam', icon: '🌊', order: 1 },
  { name: 'Bantuan Medis', slug: 'bantuan-medis', icon: '🏥', order: 2 },
  { name: 'Pendidikan', slug: 'pendidikan', icon: '📚', order: 3 },
  { name: 'Rumah Ibadah', slug: 'rumah-ibadah', icon: '🕌', order: 4 },
  { name: 'Panti Asuhan', slug: 'panti-asuhan', icon: '🏠', order: 5 },
  { name: 'Infrastruktur', slug: 'infrastruktur', icon: '🏗️', order: 6 },
  { name: 'Kemanusiaan', slug: 'kemanusiaan', icon: '🤝', order: 7 },
  { name: 'Zakat', slug: 'zakat', icon: '🌙', order: 8 },
];

const USERS_DATA = [
  // Admin user
  { email: 'admin@kitabisa.com', name: 'Admin', isVerified: true, verificationType: 'organization', avatar: '/avatars/admin.jpg', role: Role.ADMIN },
  // Moderator user
  { email: 'moderator@kitabisa.com', name: 'Moderator', isVerified: true, verificationType: 'organization', avatar: '/avatars/moderator.jpg', role: Role.MODERATOR },
  // Verified creators (5)
  { email: 'ahmad.fauzi@email.com', name: 'Ahmad Fauzi', isVerified: true, verificationType: 'ktp', avatar: '/avatars/ahmad.jpg', role: Role.CAMPAIGN_CREATOR },
  { email: 'siti.nurhaliza@email.com', name: 'Siti Nurhaliza', isVerified: true, verificationType: 'organization', avatar: '/avatars/siti.jpg', role: Role.CAMPAIGN_CREATOR },
  { email: 'budi.santoso@email.com', name: 'Budi Santoso', isVerified: true, verificationType: 'ktp', avatar: '/avatars/budi.jpg', role: Role.CAMPAIGN_CREATOR },
  { email: 'dewi.lestari@email.com', name: 'Dewi Lestari', isVerified: true, verificationType: 'organization', avatar: '/avatars/dewi.jpg', role: Role.CAMPAIGN_CREATOR },
  { email: 'rizki.pratama@email.com', name: 'Rizki Pratama', isVerified: true, verificationType: 'ktp', avatar: '/avatars/rizki.jpg', role: Role.CAMPAIGN_CREATOR },
  // Regular donors (5)
  { email: 'andi.wijaya@email.com', name: 'Andi Wijaya', isVerified: false, verificationType: null, avatar: null, role: Role.DONOR },
  { email: 'putri.ayu@email.com', name: 'Putri Ayu', isVerified: false, verificationType: null, avatar: null, role: Role.DONOR },
  { email: 'hendra.gunawan@email.com', name: 'Hendra Gunawan', isVerified: false, verificationType: null, avatar: null, role: Role.DONOR },
  { email: 'maya.sari@email.com', name: 'Maya Sari', isVerified: false, verificationType: null, avatar: null, role: Role.DONOR },
  { email: 'donor@test.com', name: 'Test Donor', isVerified: false, verificationType: null, avatar: null, role: Role.DONOR },
];

const CAMPAIGNS_DATA = [
  // Bencana Alam (4)
  { title: 'Bantu Korban Banjir Bandang Garut', category: 'bencana-alam', target: 500000000, collected: 387500000, isUrgent: true, status: 'active', daysOld: 5, deadlineDays: 25 },
  { title: 'Gempa Cianjur - Bangun Kembali Rumah Warga', category: 'bencana-alam', target: 1000000000, collected: 892000000, isUrgent: true, status: 'active', daysOld: 14, deadlineDays: 16 },
  { title: 'Tanah Longsor Banjarnegara - Evakuasi Warga', category: 'bencana-alam', target: 250000000, collected: 250000000, isUrgent: false, status: 'completed', daysOld: 60, deadlineDays: -30 },
  { title: 'Erupsi Gunung Semeru - Bantuan Darurat', category: 'bencana-alam', target: 750000000, collected: 312000000, isUrgent: true, status: 'active', daysOld: 3, deadlineDays: 27 },
  // Bantuan Medis (4)
  { title: 'Bantu Adik Rafi Lawan Leukemia', category: 'bantuan-medis', target: 300000000, collected: 178500000, isUrgent: true, status: 'active', daysOld: 10, deadlineDays: 20 },
  { title: 'Operasi Jantung untuk Ibu Sumiati', category: 'bantuan-medis', target: 450000000, collected: 450000000, isUrgent: false, status: 'completed', daysOld: 45, deadlineDays: -15 },
  { title: 'Pengobatan Kanker Anak Yatim Piatu', category: 'bantuan-medis', target: 200000000, collected: 95000000, isUrgent: true, status: 'active', daysOld: 7, deadlineDays: 23 },
  { title: 'Bantu Pak Joko Cuci Darah Rutin', category: 'bantuan-medis', target: 150000000, collected: 67000000, isUrgent: false, status: 'active', daysOld: 20, deadlineDays: 40 },
  // Pendidikan (4)
  { title: 'Beasiswa Anak Pedalaman Papua', category: 'pendidikan', target: 200000000, collected: 142000000, isUrgent: false, status: 'active', daysOld: 30, deadlineDays: 60 },
  { title: 'Bangun Perpustakaan Desa Terpencil', category: 'pendidikan', target: 100000000, collected: 100000000, isUrgent: false, status: 'completed', daysOld: 90, deadlineDays: -30 },
  { title: 'Laptop untuk Siswa Berprestasi Kurang Mampu', category: 'pendidikan', target: 75000000, collected: 52000000, isUrgent: false, status: 'active', daysOld: 15, deadlineDays: 45 },
  { title: 'Beasiswa S2 Guru Honorer Berprestasi', category: 'pendidikan', target: 350000000, collected: 89000000, isUrgent: false, status: 'active', daysOld: 8, deadlineDays: 82 },
  // Rumah Ibadah (4)
  { title: 'Renovasi Masjid Al-Ikhlas yang Hampir Roboh', category: 'rumah-ibadah', target: 400000000, collected: 267000000, isUrgent: true, status: 'active', daysOld: 12, deadlineDays: 18 },
  { title: 'Bangun Mushola di Pelosok Kalimantan', category: 'rumah-ibadah', target: 150000000, collected: 150000000, isUrgent: false, status: 'completed', daysOld: 120, deadlineDays: -60 },
  { title: 'Renovasi Gereja Tua di Flores', category: 'rumah-ibadah', target: 200000000, collected: 78000000, isUrgent: false, status: 'active', daysOld: 25, deadlineDays: 65 },
  { title: 'Pembangunan Pura di Desa Adat Bali', category: 'rumah-ibadah', target: 300000000, collected: 134000000, isUrgent: false, status: 'active', daysOld: 18, deadlineDays: 72 },
  // Panti Asuhan (4)
  { title: 'Bantu Makan 50 Anak Panti Asuhan Al-Falah', category: 'panti-asuhan', target: 100000000, collected: 72000000, isUrgent: true, status: 'active', daysOld: 6, deadlineDays: 24 },
  { title: 'Renovasi Panti Asuhan Kasih Ibu', category: 'panti-asuhan', target: 250000000, collected: 198000000, isUrgent: false, status: 'active', daysOld: 35, deadlineDays: 25 },
  { title: 'Perlengkapan Sekolah Anak Panti', category: 'panti-asuhan', target: 50000000, collected: 50000000, isUrgent: false, status: 'completed', daysOld: 80, deadlineDays: -20 },
  { title: 'Santunan Lebaran Anak Yatim Se-Jakarta', category: 'panti-asuhan', target: 300000000, collected: 215000000, isUrgent: false, status: 'active', daysOld: 10, deadlineDays: 20 },
  // Infrastruktur (4)
  { title: 'Bangun Jembatan Penghubung 2 Desa di NTT', category: 'infrastruktur', target: 500000000, collected: 234000000, isUrgent: false, status: 'active', daysOld: 40, deadlineDays: 50 },
  { title: 'Perbaikan Jalan Desa Terisolir Sulawesi', category: 'infrastruktur', target: 350000000, collected: 89000000, isUrgent: false, status: 'active', daysOld: 20, deadlineDays: 70 },
  { title: 'Sumur Bor untuk Desa Kekeringan', category: 'infrastruktur', target: 75000000, collected: 75000000, isUrgent: false, status: 'completed', daysOld: 100, deadlineDays: -40 },
  { title: 'Listrik Tenaga Surya Desa Pedalaman', category: 'infrastruktur', target: 200000000, collected: 67000000, isUrgent: false, status: 'active', daysOld: 15, deadlineDays: 75 },
  // Kemanusiaan (4)
  { title: 'Bantuan Pangan Warga Terdampak PHK', category: 'kemanusiaan', target: 150000000, collected: 112000000, isUrgent: true, status: 'active', daysOld: 4, deadlineDays: 26 },
  { title: 'Paket Sembako untuk 1000 Keluarga Miskin', category: 'kemanusiaan', target: 400000000, collected: 287000000, isUrgent: false, status: 'active', daysOld: 22, deadlineDays: 38 },
  { title: 'Bantuan untuk Pengungsi Rohingya di Aceh', category: 'kemanusiaan', target: 600000000, collected: 423000000, isUrgent: true, status: 'active', daysOld: 9, deadlineDays: 21 },
  { title: 'Dapur Umum Ramadan untuk Duafa', category: 'kemanusiaan', target: 100000000, collected: 100000000, isUrgent: false, status: 'completed', daysOld: 70, deadlineDays: -10 },
  // Zakat (2)
  { title: 'Zakat Fitrah untuk Mustahik Sekitar Kita', category: 'zakat', target: 200000000, collected: 156000000, isUrgent: false, status: 'active', daysOld: 5, deadlineDays: 25 },
  { title: 'Zakat Maal - Berdayakan Ekonomi Umat', category: 'zakat', target: 500000000, collected: 312000000, isUrgent: false, status: 'active', daysOld: 30, deadlineDays: 60 },
];

const STORIES = [
  'Assalamualaikum saudara-saudara sekalian, kami membutuhkan bantuan mendesak untuk para korban yang terdampak. Kondisi di lapangan sangat memprihatinkan dan banyak warga yang kehilangan tempat tinggal serta harta benda mereka. Mari kita bersatu membantu sesama.\n\nDana yang terkumpul akan digunakan untuk:\n- Penyediaan makanan dan air bersih\n- Tenda darurat dan selimut\n- Obat-obatan dan kebutuhan medis\n- Bantuan evakuasi dan logistik\n\nSetiap rupiah yang Anda donasikan akan sangat berarti bagi mereka yang membutuhkan.',
  'Perkenalkan, saya ingin berbagi kisah tentang perjuangan yang kami hadapi. Dengan hati yang berat namun penuh harapan, kami memohon bantuan dari para dermawan sekalian.\n\nKondisi saat ini sangat membutuhkan perhatian dan bantuan dari kita semua. Kami telah berupaya sekuat tenaga namun masih membutuhkan dukungan lebih.\n\nTarget dana yang kami kumpulkan akan digunakan sepenuhnya untuk kebutuhan yang sudah direncanakan dengan transparan.\n\nSemoga Allah SWT membalas kebaikan para donatur dengan berlipat ganda. Aamiin.',
  'Salam sejahtera untuk kita semua. Di tengah kondisi yang sulit ini, kami hadir untuk menggalang bantuan bagi saudara-saudara kita yang membutuhkan.\n\nProyek ini telah kami rencanakan dengan matang dan transparan. Setiap perkembangan akan kami update secara berkala.\n\nBerapapun yang bisa Anda berikan, akan sangat membantu. Jangan lupa untuk mendoakan agar program ini berjalan lancar.\n\nMari kita buktikan bahwa kebaikan tidak pernah habis di Indonesia.',
];

const PRAYER_TEXTS = [
  'Semoga cepat sembuh dan diberikan kesabaran. Aamiin Ya Rabbal Alamin.',
  'Ya Allah, permudahkanlah urusan saudara-saudara kami. Aamiin.',
  'Semoga bantuan ini bermanfaat dan menjadi amal jariyah bagi kita semua.',
  'Doa terbaik untuk semua yang terdampak. Semoga Allah berikan kemudahan.',
  'Bismillah, semoga donasi ini berkah dan bermanfaat. Aamiin.',
  'Ya Allah, berikanlah kesembuhan dan kekuatan kepada mereka yang sakit.',
  'Semoga Allah melapangkan rezeki dan memudahkan segala urusan. Aamiin.',
  'Turut berduka, semoga diberikan ketabahan dan kekuatan.',
  'Semoga target donasi segera tercapai. Aamiin Ya Allah.',
  'Ya Rabb, lindungilah dan berkahilah saudara-saudara kami.',
  'Mudah-mudahan kebaikan kita dibalas berlipat ganda oleh Allah SWT.',
  'Semoga anak-anak yang membutuhkan bisa terus bersekolah. Aamiin.',
  'Doa kami selalu menyertai. Semoga semuanya dimudahkan.',
  'Ya Allah, jadikan donasi ini pemberat timbangan amal kebaikan kami.',
  'Semoga kampung halaman segera pulih dan warga bisa kembali beraktivitas.',
  'Aamiin, semoga semua yang sakit segera diberikan kesembuhan.',
  'Ikhlas membantu, semoga menjadi sedekah yang diterima Allah SWT.',
  'Semoga bencana segera berlalu dan warga bisa bangkit kembali.',
  'Ya Allah, ridhoi langkah kami dalam membantu sesama. Aamiin.',
  'Cepat sembuh ya dek, kami semua mendoakanmu dari sini.',
];

const PAYMENT_METHODS = ['bca', 'mandiri', 'bni', 'bri', 'gopay', 'ovo', 'dana', 'shopeepay'];

const DONATION_AMOUNTS = [
  10000, 20000, 25000, 50000, 75000, 100000, 150000, 200000, 250000,
  300000, 500000, 750000, 1000000, 1500000, 2000000, 5000000, 10000000,
];

const UPDATE_TITLES = [
  'Laporan Perkembangan Minggu Ini',
  'Terima Kasih Para Donatur!',
  'Update Penggunaan Dana',
  'Perkembangan Terbaru di Lapangan',
  'Foto-foto Kegiatan Terbaru',
  'Pencapaian Target Tahap Pertama',
  'Laporan Keuangan Transparan',
  'Kabar Baik dari Penerima Manfaat',
  'Dokumentasi Penyaluran Bantuan',
  'Progres Pembangunan Minggu Ke-3',
  'Alhamdulillah Dana Tersalurkan!',
  'Update: Kondisi Terkini di Lapangan',
];

const UPDATE_CONTENTS = [
  'Alhamdulillah, berkat doa dan bantuan dari para donatur sekalian, kami telah berhasil menyalurkan bantuan tahap pertama. Berikut adalah laporan penggunaan dana:\n\n1. Pembelian bahan pokok: Rp 15.000.000\n2. Logistik dan transportasi: Rp 5.000.000\n3. Perlengkapan darurat: Rp 10.000.000\n\nKami akan terus mengupdate perkembangan secara berkala.',
  'Terima kasih banyak kepada seluruh donatur yang telah membantu. Saat ini progres sudah mencapai 75% dari target. Kami optimis target akan tercapai dalam waktu dekat.\n\nSemoga Allah membalas kebaikan kalian semua. Aamiin.',
  'Berikut dokumentasi kegiatan di lapangan hari ini. Tim kami telah bekerja keras untuk memastikan bantuan sampai ke tangan yang tepat.\n\nJumlah penerima manfaat: 150 KK\nWilayah cakupan: 3 desa\nPeriode penyaluran: 1 minggu',
];

// ==================== Main Seed Function ====================

async function main() {
  console.log('🌱 Seeding database...\n');

  // 1. Seed Categories
  console.log('📂 Creating categories...');
  const categories = [];
  for (const cat of CATEGORIES) {
    const category = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
    categories.push(category);
  }
  console.log(`   ✓ ${categories.length} categories created\n`);

  // 2. Seed Users
  console.log('👤 Creating users...');
  const password = await bcrypt.hash('password123', 12);
  const users = [];
  for (const userData of USERS_DATA) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        name: userData.name,
        password,
        avatar: userData.avatar,
        isVerified: userData.isVerified,
        verificationType: userData.verificationType,
        role: userData.role,
        donationBalance: userData.isVerified ? 0 : randomInt(50000, 500000),
      },
    });
    users.push(user);
  }
  const admins = users.filter(u => u.role === Role.ADMIN);
  const moderators = users.filter(u => u.role === Role.MODERATOR);
  const creators = users.filter(u => u.role === Role.CAMPAIGN_CREATOR);
  const donors = users.filter(u => u.role === Role.DONOR);
  console.log(`   ✓ ${users.length} users created (${admins.length} admin, ${moderators.length} moderator, ${creators.length} creators, ${donors.length} donors)\n`);

  // 3. Seed Campaigns
  console.log('📢 Creating campaigns...');
  const campaigns = [];
  for (const campaignData of CAMPAIGNS_DATA) {
    const creator = randomElement(creators);
    const slug = slugify(campaignData.title);
    const campaign = await prisma.campaign.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title: campaignData.title,
        description: campaignData.title + ' - Mari berdonasi untuk membantu sesama.',
        story: randomElement(STORIES),
        coverImage: `/images/campaigns/${campaignData.category}-${randomInt(1, 3)}.jpg`,
        targetAmount: campaignData.target,
        collectedAmount: campaignData.collected,
        category: campaignData.category,
        status: campaignData.status,
        isUrgent: campaignData.isUrgent,
        deadline: campaignData.deadlineDays > 0 ? daysFromNow(campaignData.deadlineDays) : daysAgo(Math.abs(campaignData.deadlineDays)),
        creatorId: creator.id,
        createdAt: daysAgo(campaignData.daysOld),
      },
    });
    campaigns.push(campaign);
  }
  console.log(`   ✓ ${campaigns.length} campaigns created\n`);

  // 4. Seed Donations (100+)
  console.log('💰 Creating donations...');
  const donations = [];
  const activeCampaigns = campaigns.filter(c => c.status === 'active' || c.status === 'completed');

  for (let i = 0; i < 110; i++) {
    const campaign = randomElement(activeCampaigns);
    const donor = randomElement(users);
    const isAnonymous = Math.random() < 0.2;
    const paymentStatus = Math.random() < 0.85 ? 'confirmed' : (Math.random() < 0.5 ? 'pending' : 'failed');

    const donation = await prisma.donation.create({
      data: {
        amount: randomElement(DONATION_AMOUNTS),
        isAnonymous,
        paymentMethod: randomElement(PAYMENT_METHODS),
        paymentStatus,
        message: Math.random() < 0.6 ? randomElement(PRAYER_TEXTS) : null,
        campaignId: campaign.id,
        donorId: donor.id,
        createdAt: daysAgo(randomInt(0, 60)),
      },
    });
    donations.push(donation);
  }
  console.log(`   ✓ ${donations.length} donations created\n`);

  // 5. Seed Prayers (50+)
  console.log('🤲 Creating prayers...');
  const confirmedDonations = donations.filter(d => d.paymentStatus === 'confirmed');
  const donationsForPrayers = confirmedDonations.slice(0, Math.min(55, confirmedDonations.length));
  let prayerCount = 0;

  for (const donation of donationsForPrayers) {
    await prisma.prayer.create({
      data: {
        text: randomElement(PRAYER_TEXTS),
        amiinCount: randomInt(0, 50),
        donationId: donation.id,
        campaignId: donation.campaignId,
        userId: donation.donorId,
        createdAt: donation.createdAt,
      },
    });
    prayerCount++;
  }
  console.log(`   ✓ ${prayerCount} prayers created\n`);

  // 6. Seed Campaign Updates (12+)
  console.log('📝 Creating campaign updates...');
  let updateCount = 0;
  for (let i = 0; i < 12; i++) {
    const campaign = randomElement(activeCampaigns);
    await prisma.campaignUpdate.create({
      data: {
        title: UPDATE_TITLES[i % UPDATE_TITLES.length],
        content: randomElement(UPDATE_CONTENTS),
        images: [`/images/updates/update-${randomInt(1, 5)}.jpg`],
        campaignId: campaign.id,
        createdAt: daysAgo(randomInt(1, 30)),
      },
    });
    updateCount++;
  }
  console.log(`   ✓ ${updateCount} campaign updates created\n`);

  // 7. Seed Disbursements (6+)
  console.log('💸 Creating disbursements...');
  const completedCampaigns = campaigns.filter(c => c.status === 'completed');
  let disbursementCount = 0;

  for (const campaign of completedCampaigns) {
    // Each completed campaign gets 1-2 disbursements
    const numDisbursements = randomInt(1, 2);
    for (let i = 0; i < numDisbursements; i++) {
      await prisma.disbursement.create({
        data: {
          amount: Math.floor(campaign.collectedAmount / numDisbursements),
          description: `Pencairan dana tahap ${i + 1} - ${campaign.title}`,
          proofImage: `/images/disbursements/proof-${randomInt(1, 5)}.jpg`,
          campaignId: campaign.id,
          createdAt: daysAgo(randomInt(5, 30)),
        },
      });
      disbursementCount++;
    }
  }
  console.log(`   ✓ ${disbursementCount} disbursements created\n`);

  // 8. Seed Notifications (20+)
  console.log('🔔 Creating notifications...');
  const notificationTypes = [
    { type: 'donation_confirmed', title: 'Donasi Berhasil!', message: 'Donasi Anda sebesar {amount} telah dikonfirmasi.' },
    { type: 'campaign_update', title: 'Update Campaign', message: 'Ada update terbaru dari campaign yang Anda donasi.' },
    { type: 'disbursement', title: 'Dana Dicairkan', message: 'Dana campaign telah dicairkan ke penerima manfaat.' },
  ];
  let notifCount = 0;

  for (const user of users) {
    const numNotifs = randomInt(2, 4);
    for (let i = 0; i < numNotifs; i++) {
      const notifType = randomElement(notificationTypes);
      const campaign = randomElement(campaigns);
      await prisma.notification.create({
        data: {
          type: notifType.type,
          title: notifType.title,
          message: notifType.message.replace('{amount}', `Rp ${randomElement(DONATION_AMOUNTS).toLocaleString('id-ID')}`),
          isRead: Math.random() < 0.4,
          userId: user.id,
          link: `/campaign/${campaign.slug}`,
          createdAt: daysAgo(randomInt(0, 14)),
        },
      });
      notifCount++;
    }
  }
  console.log(`   ✓ ${notifCount} notifications created\n`);

  // 9. Seed Auto Donations (4+)
  console.log('🔄 Creating auto donation settings...');
  const autoDonationCategories = ['bencana-alam', 'bantuan-medis', 'kemanusiaan', 'zakat'];
  let autoDonationCount = 0;

  for (let i = 0; i < 4; i++) {
    const user = donors[i % donors.length];
    await prisma.autoDonation.create({
      data: {
        amount: randomElement([10000, 25000, 50000, 100000]),
        category: autoDonationCategories[i],
        schedule: i % 2 === 0 ? 'weekly' : 'daily',
        time: `${String(randomInt(6, 21)).padStart(2, '0')}:00`,
        isActive: Math.random() < 0.75,
        userId: user.id,
      },
    });
    autoDonationCount++;
  }
  console.log(`   ✓ ${autoDonationCount} auto donation settings created\n`);

  console.log('═══════════════════════════════════════════');
  console.log('✅ Database seeding complete!');
  console.log('═══════════════════════════════════════════');
  console.log('\n📋 Summary:');
  console.log(`   Categories:       ${categories.length}`);
  console.log(`   Users:            ${users.length}`);
  console.log(`   Campaigns:        ${campaigns.length}`);
  console.log(`   Donations:        ${donations.length}`);
  console.log(`   Prayers:          ${prayerCount}`);
  console.log(`   Campaign Updates: ${updateCount}`);
  console.log(`   Disbursements:    ${disbursementCount}`);
  console.log(`   Notifications:    ${notifCount}`);
  console.log(`   Auto Donations:   ${autoDonationCount}`);
  console.log('\n🔑 Test Credentials:');
  console.log('   Admin:     admin@kitabisa.com / password123');
  console.log('   Moderator: moderator@kitabisa.com / password123');
  console.log('   Donor:     donor@test.com / password123');
  console.log('');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
