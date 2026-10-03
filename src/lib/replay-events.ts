// Compact Task run events for replays: recorded live by the pipeline while
// runs work (a finished run returns only its final state), played back by the
// app's "Watch the research" panel. Pure.

export type CompactEvent =
  | { k: 'search'; run: string; t: number; m: string }
  | { k: 'extract'; run: string; t: number; url: string }
  | { k: 'tool'; run: string; t: number; connector: string; tool: string }
  | { k: 'stats'; run: string; t: number; considered: number; read: number; sample?: string[] }
  | { k: 'state'; run: string; t: number; status: string };

const TOOL_CALL = /^Executing MCP tool call on server (\S+) with tool (\S+?)\.?$/;

/**
 * Maps one Task run event to its compact form, or null for noise (tool
 * listings, plans, exec status). `t` is seconds since the stream or run began.
 */
type RunEvent = { type?: string; message?: string; source_stats?: { num_sources_considered?: number; num_sources_read?: number; sources_read_sample?: string[] }; run?: { status?: string } };

export function compactRunEvent(event: RunEvent | null | undefined, run: string, t: number): CompactEvent | null {
  switch (event?.type) {
    case 'task_run.progress_msg.search':
      return { k: 'search', run, t, m: String(event.message ?? '').replace(/^Objective:\s*/, '').slice(0, 200) };
    // Observed in streams but not among the documented subtypes; counts come from progress_stats.
    case 'task_run.progress_msg.extract': {
      const url = String(event.message ?? '').replace(/^Extract:\s*/, '').trim();
      return /^https?:\/\//.test(url) ? { k: 'extract', run, t, url: url.slice(0, 300) } : null;
    }
    case 'task_run.progress_msg.tool_call': {
      const hit = String(event.message ?? '').match(TOOL_CALL);
      return hit ? { k: 'tool', run, t, connector: hit[1], tool: hit[2] } : null;
    }
    // The documented counts: sources considered and read, with a sample of the pages read.
    case 'task_run.progress_stats': {
      const sample = (event.source_stats?.sources_read_sample ?? []).filter((u) => /^https?:\/\//.test(u)).slice(0, 8).map((u) => u.slice(0, 300));
      return { k: 'stats', run, t, considered: event.source_stats?.num_sources_considered ?? 0, read: event.source_stats?.num_sources_read ?? 0, ...(sample.length ? { sample } : {}) };
    }
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
