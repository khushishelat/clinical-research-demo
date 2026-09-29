'use client';

import type { Flag } from '@/lib/domain/types';
import { fmtDate, statusLabel } from '@/lib/view/format';
import { Chip, FlagBadge } from './ui';
import { useRegistry } from './useRegistry';

/** The row flag against today's registry, with the change line when it moved. */
export function LiveFlag({ keyName, nctId, recorded }: { keyName: string; nctId: string; recorded: Flag | undefined }) {
  const { data } = useRegistry(keyName);
  const f = data?.freshness[nctId];
  if (!f || f.state === 'unchanged') return <FlagBadge flag={recorded} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {f.state === 'caught_up' ? <Chip tone="ok">✓ Registry caught up</Chip> : f.state === 'changed_pending' ? <FlagBadge flag="news" pending /> : <FlagBadge flag={f.flag} />}
      <span className="text-[12px] text-muted">
        Registry now {statusLabel(f.status)}
        {f.changed_on ? ` · updated ${fmtDate(f.changed_on)}` : ''}
      </span>
    </span>
  );
}

/** "Still Recruiting as of today" or the live status, for the registry column. */
export function LiveStatus({ keyName, nctId, recorded }: { keyName: string; nctId: string; recorded: string }) {
  const { data, loading } = useRegistry(keyName);
  const f = data?.freshness[nctId];
  if (loading) return <span className="text-muted">{statusLabel(recorded)}</span>;
  if (!f || f.state === 'unchanged') return <span>{statusLabel(recorded)} <span className="text-[12px] text-muted">· still, as of today</span></span>;
  return (
    <span>
      <span className="text-muted line-through">{statusLabel(recorded)}</span> → {statusLabel(f.status)}
    </span>
  );
}
