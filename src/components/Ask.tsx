'use client';

// "Ask about this company / trial" on the Responses API with connectors.
// Exploratory: labeled as a quick answer, never changes a flag.

import { useRef, useState } from 'react';
import type { AskEvent } from '@/lib/server/ask';
import { domainOf } from '@/lib/view/format';
import { Card, Chip, connectorName, Label } from './ui';

type Props = { keyName: string; company: string; nctId?: string; trialName?: string; suggestions?: string[]; bare?: boolean };

export async function* readSse<T>(res: Response): AsyncGenerator<T> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      if (data) yield JSON.parse(data) as T;
    }
  }
}

export function Ask({ keyName, company, nctId, trialName, suggestions, bare }: Props) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [searches, setSearches] = useState(0);
  const [connectors, setConnectors] = useState<{ connector: string; tool: string }[]>([]);
  const [citations, setCitations] = useState<{ url: string; title: string | null }[]>([]);
  const [meta, setMeta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(0);
  const subject = trialName ?? company;
  const ideas = suggestions ?? (nctId ? [`Is ${subject} still enrolling?`, `When are ${subject} results expected?`] : [`What are ${company}'s next data readouts?`, `Which ${company} trials changed status this year?`]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setText('');
    setSearches(0);
    setConnectors([]);
    setCitations([]);
    setMeta(null);
    setError(null);
    started.current = Date.now();
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: keyName, nct_id: nctId, question }) });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      for await (const e of readSse<AskEvent>(res)) {
        if (e.k === 'search') setSearches(e.n);
        else if (e.k === 'connector') setConnectors((c) => [...c, e]);
        else if (e.k === 'text') setText((t) => t + e.delta);
        else if (e.k === 'error') setError(e.message);
        else if (e.k === 'done') {
          setText(e.text);
          setCitations(e.citations);
          setMeta(e.cached ? `Answered earlier today · ${e.citations.length} sources · Responses API` : `Answered in ${Math.round((Date.now() - started.current) / 1000)} s · ${e.citations.length} sources · Responses API`);
        }
      }
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={bare ? 'mt-3 p-5' : 'mt-10 p-5'}>
      {bare ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[20px]">Ask about {nctId ? 'this trial' : company}</h2>
          <Chip tone="dashed">Exploratory</Chip>
          <span className="text-[13px] text-muted">Quick answers can be wrong. They never change a flag.</span>
        </div>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={ideas[0]} aria-label="Question" className="h-11 min-w-0 flex-1 rounded-[4px] border border-line-strong bg-card px-3 text-[15px] focus:border-ink focus:outline-none" />
        <button type="submit" disabled={busy || !q.trim()} className="h-11 shrink-0 rounded-[4px] bg-ink px-5 font-mono text-[13px] uppercase text-page disabled:opacity-40">
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </form>
      {!text && !busy && !error ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {ideas.map((s) => (
            <button key={s} type="button" onClick={() => (setQ(s), ask(s))} className="rounded-full border border-line-strong px-3 py-1 text-[13px] text-muted hover:border-ink hover:text-ink">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {busy || connectors.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-muted">
          {busy ? <span className="pulse h-1.5 w-1.5 rounded-full bg-orange" /> : null}
          {searches ? <span>Web searches · {searches}</span> : busy ? <span>Starting research</span> : null}
          {connectors.map((c, i) => (
            <Chip key={i} tone="wash">
              {connectorName(c.connector)} · {c.tool}
            </Chip>
          ))}
        </div>
      ) : null}
      {text ? (
        <div className="mt-4 space-y-3 text-[15px] leading-relaxed">
          {text
            .replace(/\*\*/g, '')
            .split(/\n{2,}/)
            .map((p, i) => (
              <p key={i} className="whitespace-pre-line">
                {p}
              </p>
            ))}
        </div>
      ) : null}
      {citations.length ? (
        <ol className="mt-3 flex flex-wrap gap-2">
          {citations.slice(0, 8).map((c, i) => (
            <li key={c.url}>
              <a href={c.url} target="_blank" rel="noreferrer" title={c.title ?? c.url} className="inline-flex items-center gap-1 rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted hover:border-ink hover:text-ink">
                [{i + 1}] {domainOf(c.url)} ↗
              </a>
            </li>
          ))}
        </ol>
      ) : null}
      {meta ? <Label className="mt-3 block">{meta}</Label> : null}
      {error ? <p className="mt-3 text-[14px] text-muted">{error}</p> : null}
    </Card>
  );
}
