import { Metadata } from 'next';
import { FAQAccordion } from './faq-accordion';

export const metadata: Metadata = {
  title: 'FAQ - Fund for Indonesia',
  description:
    'Pertanyaan yang sering diajukan tentang Fund for Indonesia. Temukan jawaban tentang cara donasi, penggalangan dana, dan keamanan transaksi.',
};

export default function FAQPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">FAQ</h1>
      <p className="text-text-secondary mb-8">
        Temukan jawaban untuk pertanyaan yang sering diajukan tentang Fund for Indonesia.
      </p>
      <FAQAccordion />
    </article>
  );
}
