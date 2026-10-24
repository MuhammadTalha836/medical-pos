import React from 'react';

/** The PharmaCare Pro mark (same artwork as build/icon.svg, the desktop app icon). */
export const AppLogo: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="61 61 902 902" className={`${className} shrink-0`} aria-hidden="true">
    <defs>
      <linearGradient id="app-logo-gradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#14b8a6" />
        <stop offset="1" stopColor="#0f766e" />
      </linearGradient>
    </defs>
    <rect x="61" y="61" width="902" height="902" rx="205" fill="url(#app-logo-gradient)" />
    <rect x="414.5" y="225.5" width="195" height="573" rx="49" fill="#fff" />
    <rect x="225.5" y="414.5" width="573" height="195" rx="49" fill="#fff" />
  </svg>
);
