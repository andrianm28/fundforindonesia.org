'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { LazyImage } from '@/components/ui/LazyImage';

export interface HeroBannerProps {
  slides: {
    image: string;
    headline: string;
    cta: { label: string; href: string };
  }[];
  autoPlayInterval?: number; // default: 5000ms
}

/**
 * HeroBanner - Auto-rotating carousel with:
 * - Configurable auto-play interval (default 5000ms)
 * - Dot indicators for navigation
 * - Touch/swipe support on mobile
 * - Pause on hover, resume on mouse leave
 * - Framer Motion slide transitions
 * - Responsive: 16:9 on mobile, shorter on desktop
 */
export function HeroBanner({ slides, autoPlayInterval = 5000 }: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  const slideCount = slides.length;

  const goToSlide = useCallback((index: number) => {
    setDirection(index > currentIndex ? 1 : -1);
    setCurrentIndex(index);
  }, [currentIndex]);

  const goToNext = useCallback(() => {
    setDirection(1);
    setCurrentIndex((prev) => (prev + 1) % slideCount);
  }, [slideCount]);

  const goToPrevious = useCallback(() => {
    setDirection(-1);
    setCurrentIndex((prev) => (prev - 1 + slideCount) % slideCount);
  }, [slideCount]);

  // Auto-rotate interval
  useEffect(() => {
    if (isPaused || slideCount <= 1) return;

    const interval = setInterval(() => {
      goToNext();
    }, autoPlayInterval);

    return () => clearInterval(interval);
  }, [isPaused, autoPlayInterval, goToNext, slideCount]);

  // Touch/swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;

    const diff = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      if (diff > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  // Framer Motion slide variants
  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '100%' : '-100%',
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? '-100%' : '100%',
      opacity: 0,
    }),
  };

  if (!slides || slides.length === 0) {
    return null;
  }

  const currentSlide = slides[currentIndex];

  return (
    <div
      className="relative w-full overflow-hidden aspect-[16/9] md:aspect-[21/9] lg:aspect-[3/1]"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      role="region"
      aria-label="Hero banner carousel"
      aria-roledescription="carousel"
    >
      {/* Slide content */}
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div
          key={currentIndex}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className="absolute inset-0"
          aria-roledescription="slide"
          aria-label={`Slide ${currentIndex + 1} of ${slideCount}: ${currentSlide.headline}`}
        >
          {/* Slide image */}
          <div className="absolute inset-0">
            <LazyImage
              src={currentSlide.image}
              alt={currentSlide.headline}
              width={1200}
              height={400}
              priority={currentIndex === 0}
              className="w-full h-full"
            />
          </div>

          {/* Overlay gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

          {/* Content */}
          <div className="absolute inset-0 flex flex-col justify-end p-4 md:p-8 lg:p-12">
            <h2 className="text-white text-lg md:text-2xl lg:text-3xl font-bold mb-2 md:mb-4 max-w-2xl leading-tight">
              {currentSlide.headline}
            </h2>
            <Link
              href={currentSlide.cta.href}
              className="inline-flex items-center justify-center bg-[var(--color-primary,#2F7A5F)] hover:bg-[var(--color-primary-dark,#255F4A)] text-white font-semibold text-sm md:text-base px-4 md:px-6 py-2 md:py-3 rounded-lg transition-colors duration-200 w-fit"
            >
              {currentSlide.cta.label}
            </Link>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Dot indicators */}
      {slideCount > 1 && (
        <div
          className="absolute bottom-3 md:bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10"
          role="tablist"
          aria-label="Slide navigation"
        >
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`rounded-full transition-all duration-300 ${
                index === currentIndex
                  ? 'w-6 h-2 bg-white'
                  : 'w-2 h-2 bg-white/50 hover:bg-white/75'
              }`}
              role="tab"
              aria-selected={index === currentIndex}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
