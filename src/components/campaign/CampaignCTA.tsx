'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export interface CampaignCTAProps {
  campaignSlug: string;
  onShare: () => void;
}

export function CampaignCTA({ campaignSlug, onShare }: CampaignCTAProps) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = React.useState(false);

  const handleDonate = () => {
    setIsNavigating(true);
    router.push(`/campaign/${campaignSlug}/donate`);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border shadow-elevated px-4 py-3">
      <div className="max-w-lg mx-auto flex items-center gap-3">
        {/* Share Button */}
        <button
          type="button"
          onClick={onShare}
          className="shrink-0 w-12 h-12 flex items-center justify-center rounded-md border border-border bg-white hover:bg-gray-50 transition-colors duration-fast"
          aria-label="Bagikan kampanye"
        >
          <svg
            className="w-5 h-5 text-text"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
            />
          </svg>
        </button>

        {/* Donate Button */}
        <div className="flex-1">
          <Button
            variant="primary"
            size="full"
            onClick={handleDonate}
            isLoading={isNavigating}
          >
            Donasi sekarang
          </Button>
        </div>
      </div>
    </div>
  );
}
