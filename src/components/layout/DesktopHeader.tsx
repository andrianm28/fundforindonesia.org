'use client';

import { useState } from 'react';
import Link from 'next/link';
import { User } from '@/types';

export interface DesktopHeaderProps {
  user: User | null;
  notificationCount?: number;
  onSearch: (query: string) => void;
}

export default function DesktopHeader({
  user,
  notificationCount = 0,
  onSearch,
}: DesktopHeaderProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  return (
    <header className="hidden lg:block fixed top-0 left-0 right-0 z-50 bg-white border-b border-[var(--color-border)] shadow-sm">
      <div className="mx-auto max-w-[1200px] px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex-shrink-0">
          <span className="text-2xl font-bold text-[#2F7A5F]">Fund for Indonesia</span>
        </Link>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md mx-8">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari yang ingin kamu bantu..."
              className="w-full h-10 pl-10 pr-4 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-colors"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-secondary)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </form>

        {/* Nav Links + User Section */}
        <div className="flex items-center gap-6">
          {/* Navigation Links */}
          <nav className="flex items-center gap-6">
            <Link
              href="/explore/all"
              className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
            >
              Donasi
            </Link>
            <Link
              href="/campaign/create"
              className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
            >
              Galang Dana
            </Link>
            <Link
              href="/zakat"
              className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
            >
              Zakat
            </Link>
          </nav>

          {/* Notification Bell */}
          {user && (
            <Link
              href="/inbox"
              className="relative p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
              aria-label="Notifikasi"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
              {notificationCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-[var(--color-danger)] rounded-full">
                  {notificationCount > 99 ? '99+' : notificationCount}
                </span>
              )}
            </Link>
          )}

          {/* User Section */}
          {user ? (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-[var(--color-bg-secondary)] flex items-center justify-center">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg
                    className="w-5 h-5 text-[var(--color-text-secondary)]"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                )}
              </div>
              <span className="text-sm font-medium text-[var(--color-text)] max-w-[120px] truncate">
                {user.name}
              </span>
            </div>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-9 px-5 text-sm font-semibold text-white bg-[var(--color-primary)] rounded-full hover:bg-[var(--color-primary-dark)] transition-colors"
            >
              Masuk
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
