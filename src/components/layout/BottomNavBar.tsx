'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export interface BottomNavBarProps {
  activeTab: 'home' | 'galang-dana' | 'donasi-saya' | 'inbox' | 'akun';
  unreadCount?: number;
}

const tabs = [
  {
    id: 'home' as const,
    label: 'Home',
    href: '/',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'galang-dana' as const,
    label: 'Galang Dana',
    href: '/campaign/create',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z" />
        <line x1="12" y1="8" x2="12" y2="14" />
        <line x1="9" y1="11" x2="15" y2="11" />
      </svg>
    ),
  },
  {
    id: 'donasi-saya' as const,
    label: 'Donasi Saya',
    href: '/donasi-saya',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    ),
  },
  {
    id: 'inbox' as const,
    label: 'Inbox',
    href: '/inbox',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    ),
  },
  {
    id: 'akun' as const,
    label: 'Akun',
    href: '/akun',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export default function BottomNavBar({ activeTab, unreadCount }: BottomNavBarProps) {
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border shadow-[0_-2px_8px_rgba(0,0,0,0.08)] lg:hidden pb-safe"
      aria-label="Bottom navigation"
    >
      <div className="relative flex items-center justify-around h-16">
        {/* Sliding active indicator */}
        <motion.div
          className="absolute top-0 h-[3px] bg-primary rounded-b-full"
          style={{ width: `${100 / tabs.length}%` }}
          animate={{ left: `${(activeIndex * 100) / tabs.length}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />

        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const showBadge = tab.id === 'inbox' && unreadCount !== undefined && unreadCount > 0;

          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors duration-150 ${
                isActive ? 'text-primary' : 'text-text-secondary'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="relative">
                {tab.icon}
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
                    {unreadCount! > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
