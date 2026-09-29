// One compact event shape for everything a viewer watches: the live run
// stream (GET /api/research/:gid/stream) and the recorded replay
// (fixtures/replay/<key>.json, built by scripts/compact-replay.ts from the
// Sep 28 event logs). Pure.

export type RunKind = 'snapshot' | 'mechanism' | 'trial_check' | 'found_check';

export type CompactEvent =
  | { k: 'search'; run: string; t: number; m: string }
  | { k: 'extract'; run: string; t: number; url: string }
  | { k: 'tool'; run: string; t: number; connector: string; tool: string }
  | { k: 'stats'; run: string; t: number; considered: number; read: number }
  | { k: 'state'; run: string; t: number; status: string };

/** `trial_check:NCT05899608`, `snapshot:`: the same key the Task Group metadata dedupe uses. */
export const runKey = (m: { kind?: string; nct_id?: string } | null | undefined) => `${m?.kind ?? 'unknown'}:${m?.nct_id ?? ''}`;

const TOOL_CALL = /^Executing MCP tool call on server (\S+) with tool (\S+?)\.?$/;

/**
 * Maps one Task run event to its compact form, or null for noise (tool
 * listings, plans, exec status). `t` is seconds since the stream or run began.
 */
export function compactRunEvent(event: any, run: string, t: number): CompactEvent | null {
  switch (event?.type) {
    case 'task_run.progress_msg.search':
      return { k: 'search', run, t, m: String(event.message ?? '').replace(/^Objective:\s*/, '').slice(0, 200) };
    case 'task_run.progress_msg.extract': {
      const url = String(event.message ?? '').replace(/^Extract:\s*/, '').trim();
      return /^https?:\/\//.test(url) ? { k: 'extract', run, t, url: url.slice(0, 300) } : null;
    }
    case 'task_run.progress_msg.tool_call': {
      const hit = String(event.message ?? '').match(TOOL_CALL);
      return hit ? { k: 'tool', run, t, connector: hit[1], tool: hit[2] } : null;
    }
    case 'task_run.progress_stats':
      return { k: 'stats', run, t, considered: event.source_stats?.num_sources_considered ?? 0, read: event.source_stats?.num_sources_read ?? 0 };
    case 'task_run.state':
      return { k: 'state', run, t, status: event.run?.status ?? 'unknown' };
    default:
      return null;
  }
}

/** Keeps a replay small: drops consecutive stats events that did not move. */
export function thinStats(events: readonly CompactEvent[]): CompactEvent[] {
  const last = new Map<string, string>();
  return events.filter((e) => {
    if (e.k !== 'stats') return true;
    const sig = `${e.considered}/${e.read}`;
    if (last.get(e.run) === sig) return false;
    last.set(e.run, sig);
    return true;
  });
}
