import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { campaignDocuments, documentChecklistItems, DOCUMENT_UPLOADABLE_STATUSES } from '@/lib/documents';
import { DocumentList } from '@/components/documents/DocumentList';
import { RefreshingDocumentUpload } from '@/components/documents/RefreshingDocumentUpload';
import { KIND_LABEL } from '@/lib/campaign-kind';

// The documents change under the Fundraiser as they upload.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * A Fundraiser's documents for one of their Campaigns (ticket 64, PRD §7.1):
 * every checklist item of the Campaign's Kind that needs a paper, what has
 * been uploaded for it, and a picker to add one. This is the "edit" half of
 * uploading; creating a Campaign asks for the same documents on its last step.
 *
 * Guarded on the server like the Payout screen beside it: signed out goes to
 * sign in, and a Campaign that is not this account's answers 404, the same as
 * one that does not exist. Documents are never deleted (decision 03); a wrong
 * one is replaced by uploading the right one, and the Verifier sees both.
 */
export default async function CampaignDocumentsPage({ params }: PageProps) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect('/login');
  }
  const { slug } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, slug: true, title: true, kind: true, creatorId: true, lifecycleStatus: true },
  });
  if (!campaign || campaign.creatorId !== session.user.id) {
    notFound();
  }

  const [items, documents] = await Promise.all([
    documentChecklistItems(prisma, campaign.kind),
    campaignDocuments(prisma, campaign.id),
  ]);
  const uploadable = DOCUMENT_UPLOADABLE_STATUSES.includes(campaign.lifecycleStatus);
  const missingRequired = items.filter(
    (item) => item.required && !documents.some((document) => document.checklistItemId === item.id),
  );

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <Link href="/akun/kampanye-saya" className="text-white/80 text-xs hover:underline">
          Kembali ke Galang Dana Saya
        </Link>
        <h1 className="text-white text-lg font-semibold mt-2">Dokumen Campaign</h1>
        <p className="text-white/80 text-sm mt-1 line-clamp-2">{campaign.title}</p>
      </div>

      <div className="px-4 mt-4 space-y-3">
        <div className="bg-white rounded-xl shadow-xs p-4 text-xs text-text-secondary space-y-1">
          <p>
            Dokumen wajib untuk Campaign {KIND_LABEL[campaign.kind]} (PRD pasal 7.1). Dokumen bersifat privat:
            hanya Anda, Verifier yang memeriksa pengajuan Anda, dan Admin yang dapat membukanya.
          </p>
          <p>Verifier tidak dapat mencentang butir checklist sebelum dokumennya Anda unggah.</p>
          {missingRequired.length > 0 ? (
            <p className="text-[#C62828]" data-testid="documents-missing">
              Belum lengkap: {missingRequired.map((item) => item.label).join(', ')}.
            </p>
          ) : (
            <p className="text-[#2E7D32]" data-testid="documents-complete">
              Semua dokumen wajib sudah diunggah.
            </p>
          )}
        </div>

        {items.map((item) => (
          <section key={item.id} className="bg-white rounded-xl shadow-xs p-4" data-testid={`document-item-${item.id}`}>
            <h2 className="text-sm font-medium text-text">
              {item.label}
              {item.required && <span className="ml-2 text-xs text-[#C62828]">Wajib</span>}
            </h2>
            <div className="mt-2">
              <DocumentList
                documents={documents.filter((document) => document.checklistItemId === item.id)}
                empty="Belum ada dokumen."
              />
            </div>
            {uploadable && (
              <div className="mt-3">
                <RefreshingDocumentUpload
                  fields={{ campaignId: campaign.id, checklistItemId: item.id }}
                  name={item.label}
                />
              </div>
            )}
          </section>
        ))}

        {!uploadable && (
          <p className="text-xs text-text-secondary px-1">Campaign ini sudah ditutup dan tidak menerima dokumen baru.</p>
        )}
      </div>
    </div>
  );
}
