import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { readUserEmail, SELECT_USER_EMAIL } from "@/lib/contact-fields";
import { prisma } from "@/lib/prisma";
import { effectiveStatus, type ChecklistEntry } from "@/lib/campaign-lifecycle";
import { CampaignStatusBadge } from "@/components/campaign/CampaignStatusBadge";
import { CampaignModerationActions } from "./CampaignModerationActions";
import { holdsValidKindAuthorisation, holdsValidPermit, requiresKindAuthorisation } from "@/lib/collecting-entity";
import { KIND_LABEL } from "@/lib/campaign-kind";
import { STATUS_LABEL } from "@/lib/campaign-status-label";
import { formatRupiah } from "@/lib/utils/currency";
import {
  findDuplicateCampaignHints,
  resolveDuplicateSimilarityThreshold,
  type DuplicateHintReason,
} from "@/lib/duplicate-hints";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * The Gross and the limit a Verifikasi Tambahan was raised at, read off the
 * request's own record rather than recomputed: the Verifier judges the Campaign
 * as it stood when the review opened, and a Donation since then would move the
 * number under them. Null on a request raised before this column existed, or
 * by anything but the amount rule.
 */
function amountReviewGross(
  request: { raisedByAmount?: unknown } | null
): { cumulativeGross: number; threshold: number } | null {
  const raw = request?.raisedByAmount as { cumulativeGross?: unknown; threshold?: unknown } | null | undefined;
  if (typeof raw?.cumulativeGross !== 'number' || typeof raw?.threshold !== 'number') return null;
  return { cumulativeGross: raw.cumulativeGross, threshold: raw.threshold };
}

/** What each match is called to the Verifier, in their own words. */const HINT_REASON: Record<DuplicateHintReason, string> = {
  SAME_FUNDRAISER: "Fundraiser sama",
  SIMILAR_TITLE: "Judul mirip",
  SAME_BENEFICIARY: "Nama penerima manfaat sama",
};

/**
 * A match as the Verifier reads it. The title match carries its score, since
 * "mirip" on its own would not say how near it is; the other two are exact
 * and need no number.
 */
function hintReasonLabel(reason: DuplicateHintReason, titleSimilarity: number): string {
  return reason === "SIMILAR_TITLE"
    ? `${HINT_REASON[reason]} ${Math.round(titleSimilarity * 100)}%`
    : HINT_REASON[reason];
}

export default async function ModerasiCampaignDetailPage({ params }: PageProps) {
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      creator: {
        // Decrypted where it is shown (ADR 0012 stores a ciphertext).
        select: { name: true, ...SELECT_USER_EMAIL },
      },
      collectingEntity: {
        select: {
          id: true,
          name: true,
          fundraiserId: true,
          permits: { select: { kinds: true, validFrom: true, validTo: true } },
          kindAuthorisations: { select: { kind: true, validFrom: true, validTo: true } },
        },
      },
    },
  });

  if (!campaign) {
    notFound();
  }

  const now = new Date();
  const status = effectiveStatus(campaign, now);
  // Who collects its money (ADR 0010): the Verifier confirms it by approving.
  const entity = campaign.collectingEntity ?? null;
  const entityLabel = entity
    ? `${entity.name} (${entity.fundraiserId === campaign.creatorId ? "akun organisasi ini" : "menaungi Fundraiser perorangan"})`
    : "Belum ada";
  const permitValid = entity ? holdsValidPermit(entity, campaign.kind, now) : false;
  const kindAuthorisationNeeded = requiresKindAuthorisation(campaign.kind);
  const kindAuthorisationValid =
    entity && kindAuthorisationNeeded
      ? holdsValidKindAuthorisation({ kindAuthorisations: entity.kindAuthorisations ?? [] }, campaign.kind, now)
      : false;
  // The one open request, if any: what the Verifier decides here. The
  // decision itself is judged on the request, never on this page's view.
  // The duplicate hints come with it: the up-to-five Campaigns this one most
  // resembles, so a duplicate or a repeat fraud is caught before the Campaign
  // is published rather than after (PRD FFI-05, prd-compliance 14).
  const [openRequest, identity, hints, similarityThreshold] = await Promise.all([
    prisma.verificationRequest.findFirst({
      where: { campaignId: campaign.id, outcome: "PENDING" },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.identityVerification.findUnique({ where: { userId: campaign.creatorId } }),
    findDuplicateCampaignHints(prisma, { campaignId: campaign.id }),
    resolveDuplicateSimilarityThreshold(prisma),
  ]);

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/moderasi/campaigns"
          className="inline-flex items-center gap-1 text-sm text-[#0073E6] hover:underline"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Kembali ke Daftar Kampanye
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-[#E0E0E0] overflow-hidden">
        {/* Cover Image */}
        {campaign.coverImage && (
          <div className="w-full h-48 bg-[#F5F5F5] relative">
            <Image
              src={campaign.coverImage}
              alt={campaign.title}
              fill
              className="object-cover"
            />
          </div>
        )}

        {/* Campaign Info */}
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-lg font-semibold text-[#212121]">
              {campaign.title}
            </h1>
            <CampaignStatusBadge status={status} />
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoItem label="Pembuat" value={campaign.creator.name} />
            <InfoItem
              label="Email Pembuat"
              value={readUserEmail(campaign.creator) ?? "Tidak tersedia"}
            />
            <InfoItem
              label="Target Donasi"
              value={`Rp ${campaign.targetAmount.toLocaleString("id-ID")}`}
            />
            <InfoItem label="Kategori" value={campaign.category} />
            <InfoItem label="Kind" value={KIND_LABEL[campaign.kind] ?? campaign.kind} />
            <div>
              <InfoItem label="Collecting Entity" value={entityLabel} />
              {entity && (
                <p className={`text-xs mt-0.5 ${permitValid ? "text-[#2E7D32]" : "text-[#C62828]"}`}>
                  {permitValid
                    ? `Memegang Fundraising Permit yang berlaku untuk Kind ${KIND_LABEL[campaign.kind]}.`
                    : `Belum memegang Fundraising Permit yang berlaku untuk Kind ${KIND_LABEL[campaign.kind]}: Campaign ini tidak dapat diloloskan.`}
                </p>
              )}
              {entity && kindAuthorisationNeeded && (
                <p className={`text-xs mt-0.5 ${kindAuthorisationValid ? "text-[#2E7D32]" : "text-[#C62828]"}`}>
                  {kindAuthorisationValid
                    ? `Memegang Kind Authorisation yang berlaku untuk Kind ${KIND_LABEL[campaign.kind]}.`
                    : `Belum memegang Kind Authorisation yang berlaku untuk Kind ${KIND_LABEL[campaign.kind]}: Campaign ini tidak dapat diloloskan.`}
                </p>
              )}
            </div>
            <InfoItem
              label="Tanggal Dibuat"
              value={new Date(campaign.createdAt).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            />
            {campaign.deadline && (
              <InfoItem
                label="Batas Waktu"
                value={new Date(campaign.deadline).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              />
            )}
            <InfoItem label="Penerima Manfaat" value={campaign.beneficiaryName || "Belum diisi"} />
          </div>

          {/* Description */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-[#212121] mb-2">
              Deskripsi
            </h2>
            <p className="text-sm text-[#424242] whitespace-pre-line">
              {campaign.description}
            </p>
          </div>

          {/* Story */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-[#212121] mb-2">
              Cerita Kampanye
            </h2>
            <div
              className="text-sm text-[#424242] prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: campaign.story }}
            />
          </div>
        </div>
      </div>

      {/* Why this request is open, when it is an amount review: the Gross
          that earned it and the limit it passed (prd-compliance 38). */}
      {openRequest?.kind === "AMOUNT_REVIEW" && (
        <div className="mt-6 bg-[#FFF3E0] border border-[#FFB300] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[#E65100] mb-1">Verifikasi Tambahan</h2>
          <p className="text-xs text-[#8D6E63]">
            Campaign ini sudah mengumpulkan lebih dari ambang yang berlaku, jadi Verifier
            memeriksanya lagi. Menolaknya tidak membekukan Campaign dan tidak memblokir donasi baru;
            bila ada yang mencurigakan, pasang Flag agar Admin memutuskan Suspension.
          </p>
          {(() => {
            const gross = amountReviewGross(openRequest);
            return gross ? (
              <p className="text-sm text-[#424242] mt-2">
                Dana terkumpul saat pengajuan ini dibuka: {formatRupiah(gross.cumulativeGross)}, di atas ambang{" "}
                {formatRupiah(gross.threshold)}.
              </p>
            ) : null;
          })()}
        </div>
      )}

      {/* Duplicate hints: the Campaigns this one most resembles, and why. */}
      <div className="mt-6 bg-white rounded-xl border border-[#E0E0E0] p-6">
        <h2 className="text-sm font-semibold text-[#212121] mb-1">Campaign yang Mirip</h2>
        <p className="text-xs text-[#757575] mb-4">
          Paling banyak lima Campaign yang cocok pada salah satu dari tiga hal: Fundraiser
          yang sama, kemiripan judul di atas {Math.round(similarityThreshold * 100)}%, atau nama
          penerima manfaat yang sama persis. Centang &ldquo;Sudah dipastikan bukan duplikat Campaign
          lain&rdquo; pada checklist di bawah hanya setelah Anda sudah melihat Campaign ini.
        </p>
        {hints.length === 0 ? (
          <p className="text-sm text-[#757575]">
            Tidak ada Campaign lain yang mirip dengan Campaign ini.
          </p>
        ) : (
          <ul className="space-y-3">
            {hints.map((hint) => (
              <li key={hint.campaignId} className="border border-[#E0E0E0] rounded-lg p-3">
                <a
                  href={`/moderasi/campaigns/${hint.campaignId}`}
                  className="text-sm font-medium text-[#0073E6] hover:underline"
                >
                  {hint.title}
                </a>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {hint.reasons.map((reason) => (
                    <li
                      key={reason}
                      className="text-xs rounded-full bg-[#FFF3E0] text-[#E65100] px-2 py-0.5"
                    >
                      {hintReasonLabel(reason, hint.titleSimilarity)}
                    </li>
                  ))}
                  {/* Whether the duplicate is still live is half the question. */}
                  <li className="text-xs rounded-full bg-[#F5F5F5] text-[#616161] px-2 py-0.5">
                    {STATUS_LABEL[hint.lifecycleStatus]}
                  </li>
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Moderation Actions */}
      <div className="mt-6">
        <CampaignModerationActions
          campaignId={campaign.id}
          request={
            openRequest && {
              id: openRequest.id,
              isFirst: openRequest.isFirst,
              checklist: openRequest.checklist as ChecklistEntry[],
            }
          }
          identityVerifiedAt={identity?.verifiedAt ?? null}
          collectingEntityName={entity?.name ?? null}
        />
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[#757575]">{label}</p>
      <p className="text-sm font-medium text-[#212121] mt-0.5">{value}</p>
    </div>
  );
}
