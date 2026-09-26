import { notFound } from "next/navigation";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { effectiveStatus } from "@/lib/campaign-lifecycle";
import { CampaignStatusBadge } from "@/components/campaign/CampaignStatusBadge";
import { CampaignModerationActions } from "./CampaignModerationActions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ModerasiCampaignDetailPage({ params }: PageProps) {
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      creator: {
        select: { name: true, email: true },
      },
    },
  });

  if (!campaign) {
    notFound();
  }

  const status = effectiveStatus(campaign, new Date());

  return (
    <div>
      <div className="mb-6">
        <a
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
        </a>
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
            <InfoItem label="Email Pembuat" value={campaign.creator.email} />
            <InfoItem
              label="Target Donasi"
              value={`Rp ${campaign.targetAmount.toLocaleString("id-ID")}`}
            />
            <InfoItem label="Kategori" value={campaign.category} />
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

      {/* Moderation Actions */}
      <div className="mt-6">
        <CampaignModerationActions
          campaignId={campaign.id}
          currentStatus={status}
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
