// A company or source favicon from its hostname, with a first-letter fallback.
/* eslint-disable @next/next/no-img-element */
'use client';

import { useState } from 'react';

export function Favicon({ host, name, size = 16 }: { host: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!host || failed)
    return (
      <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-[3px] bg-wash font-mono text-[9px] uppercase text-muted" style={{ width: size, height: size }}>
        {name.charAt(0)}
      </span>
    );
  return <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" width={size} height={size} className="shrink-0 rounded-[3px]" onError={() => setFailed(true)} />;
}
