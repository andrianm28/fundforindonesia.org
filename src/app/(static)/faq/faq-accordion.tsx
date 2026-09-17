'use client';

import { useState } from 'react';

const faqs = [
  {
    question: 'Apa itu Fund for Indonesia?',
    answer:
      'Fund for Indonesia adalah platform penggalangan dana online yang menghubungkan para donatur dengan individu, komunitas, dan organisasi yang membutuhkan bantuan. Kami memfasilitasi proses donasi yang aman, transparan, dan mudah diakses oleh siapa saja.',
  },
  {
    question: 'Bagaimana cara membuat kampanye penggalangan dana?',
    answer:
      'Untuk membuat kampanye, Anda perlu mendaftar dan melakukan verifikasi identitas terlebih dahulu. Setelah terverifikasi, Anda dapat membuat kampanye melalui halaman "Galang Dana" dengan mengisi judul, deskripsi, target dana, dan durasi kampanye.',
  },
  {
    question: 'Apakah donasi saya aman?',
    answer:
      'Ya, semua transaksi di Fund for Indonesia diproses melalui sistem pembayaran yang terenkripsi dan aman. Kami bekerja sama dengan penyedia layanan pembayaran terpercaya untuk memastikan keamanan dana Anda. Setiap kampanye juga melewati proses verifikasi.',
  },
  {
    question: 'Berapa biaya yang dikenakan untuk penggalangan dana?',
    answer:
      'Fund for Indonesia mengenakan biaya platform sebesar 5% dari total dana yang terkumpul. Biaya ini digunakan untuk pemeliharaan platform, verifikasi kampanye, dan layanan dukungan pengguna. Tidak ada biaya pendaftaran atau biaya bulanan.',
  },
  {
    question: 'Bagaimana cara mencairkan dana yang terkumpul?',
    answer:
      'Dana yang terkumpul dapat dicairkan ke rekening bank yang telah didaftarkan. Proses pencairan membutuhkan waktu 1-3 hari kerja setelah permintaan pencairan disetujui. Anda dapat mengajukan pencairan kapan saja selama kampanye berjalan.',
  },
  {
    question: 'Apa saja metode pembayaran yang tersedia?',
    answer:
      'Kami menerima berbagai metode pembayaran termasuk transfer bank (BCA, Mandiri, BNI), e-wallet (GoPay, OVO, Dana), dan kartu kredit/debit. Pilihan metode pembayaran mungkin berbeda tergantung pada jenis transaksi.',
  },
  {
    question: 'Bagaimana jika kampanye tidak mencapai target?',
    answer:
      'Jika kampanye tidak mencapai target dalam durasi yang ditentukan, dana yang sudah terkumpul tetap dapat dicairkan oleh penggalang dana. Kami menerapkan sistem flexible funding, sehingga setiap donasi tetap bermanfaat.',
  },
];

function AccordionItem({
  question,
  answer,
  isOpen,
  onToggle,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-border rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-bg-secondary transition-colors"
        aria-expanded={isOpen}
      >
        <span className="font-medium text-text pr-4">{question}</span>
        <svg
          className={`w-5 h-5 text-text-secondary flex-shrink-0 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-text-secondary text-sm leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}

export function FAQAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {faqs.map((faq, index) => (
        <AccordionItem
          key={index}
          question={faq.question}
          answer={faq.answer}
          isOpen={openIndex === index}
          onToggle={() => setOpenIndex(openIndex === index ? null : index)}
        />
      ))}
    </div>
  );
}
