'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Skeleton } from './Skeleton';

export interface LazyImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  blurDataURL?: string;
  className?: string;
  priority?: boolean;
  onLoad?: () => void;
  fallback?: React.ReactNode;
  /**
   * Fill the parent instead of pinning the wrapper to `width` x `height`
   * pixels. `width`/`height` still feed next/image's intrinsic ratio. Without
   * this a 1200px wrapper left a grey strip beside it at 1280px.
   */
  fill?: boolean;
}

/**
 * LazyImage wraps Next.js Image with:
 * - Skeleton placeholder while loading
 * - 200ms opacity fade-in transition on load
 * - Gray fallback with icon if image fails to load
 * - Priority loading for above-fold images
 */
export function LazyImage({
  src,
  alt,
  width,
  height,
  blurDataURL,
  className = '',
  priority = false,
  onLoad,
  fallback,
  fill = false,
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    setHasError(true);
  };

  // Show custom fallback or default error placeholder when image fails
  if (hasError) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className}`}
        style={fill ? { width: '100%', height: '100%' } : { width, height }}
        role="img"
        aria-label={alt}
      >
        {/* Generic image icon as fallback */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-gray-400"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={fill ? { width: '100%', height: '100%' } : { width, height }}
    >
      {/* Skeleton placeholder shown while loading */}
      {!isLoaded && (
        <div className="absolute inset-0 z-10">
          <Skeleton
            variant="rectangular"
            width="100%"
            height="100%"
            animated
          />
        </div>
      )}

      {/* Next.js Image with fade-in transition */}
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        placeholder={blurDataURL ? 'blur' : undefined}
        blurDataURL={blurDataURL}
        onLoad={handleLoad}
        onError={handleError}
        className={`transition-opacity duration-200 ease-out ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  );
}
