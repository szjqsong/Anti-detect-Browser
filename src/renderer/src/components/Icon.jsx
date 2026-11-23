import React from 'react';

// Minimal stroke icon set (24x24 viewBox, currentColor).
const PATHS = {
  profiles: 'M3 7l9-4 9 4-9 4-9-4z M3 12l9 4 9-4 M3 17l9 4 9-4',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  code: 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
  plus: 'M12 5v14 M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  trash: 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6',
  more: 'M12 6h.01 M12 12h.01 M12 18h.01',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4 M21 3v6h-6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  warning: 'M12 3l10 18H2z M12 10v4 M12 17h.01',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  move: 'M5 12h14 M13 6l6 6-6 6',
  cpu: 'M6 6h12v12H6z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4',
  fingerprint: 'M12 11v3a6 6 0 0 1-1.5 4 M8.5 8.5A5 5 0 0 1 17 12v2 M5 15v-3a7 7 0 0 1 12-5 M15 17a9 9 0 0 1-1 3 M9 12a3 3 0 0 1 6 0v2a8 8 0 0 1-1 4',
  key: 'M15 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l5-5a4 4 0 0 1 7-1z',
  monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
};

export default function Icon({ name, size = 16, className = '', strokeWidth = 1.8 }) {
  const filled = name === 'play' || name === 'stop';
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
