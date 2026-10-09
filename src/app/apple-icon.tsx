import { ImageResponse } from 'next/og';

// The touch icon (home screens, bookmarks): the favicon's mark, drawn full-bleed
// because iOS rounds the corners itself.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#1d1b16' }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <circle cx="14" cy="16" r="7" fill="#fcfcfa" />
          <path d="M15 16.5 L19.5 21 L28 10" fill="none" stroke="#fb631b" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size
  );
}
