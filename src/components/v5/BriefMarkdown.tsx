'use client';

// A brief@2 issue: the deep-research run's markdown, with each inline [n]
// citation linked to its reference, and the numbered references below.

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Brief } from '@/lib/space/types';
import { hostOf } from '@/lib/space/view';
import { Favicon } from './Favicon';

export function BriefMarkdown({ markdown, references }: { markdown: string; references: NonNullable<Brief['references']> }) {
  const url = new Map(references.map((r) => [r.n, r.url]));
  // "[12]" becomes a link to reference 12; links already written as [text](url) are left alone.
  const linked = markdown.replace(/\[(\d{1,3})\](?!\()/g, (m, n) => (url.has(Number(n)) ? `[[${n}]](${url.get(Number(n))})` : m))
    // Each development ends with its "Why it matters" line; set it off so it scans.
    .replace(/(^|[^*])Why it matters:/g, '$1**Why it matters:**');
  return (
    <div className="mt-6 text-[15px] leading-relaxed">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h3 className="mt-7 border-t border-line pt-5 text-[19px] leading-snug">{children}</h3>,
          h3: ({ children }) => <h4 className="mt-5 text-[16px] font-medium">{children}</h4>,
          p: ({ children }) => <p className="mt-2">{children}</p>,
          ul: ({ children }) => <ul className="mt-2 list-disc space-y-1.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1.5 pl-5">{children}</ol>,
          strong: ({ children }) => <strong className="font-medium">{children}</strong>,
          table: ({ children }) => (
            <div className="mt-3 overflow-x-auto rounded-[4px] border border-line">
              <table className="w-full border-collapse text-left text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-line bg-page px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.05em] text-muted">{children}</th>,
          td: ({ children }) => <td className="border-b border-line px-3 py-2 align-top">{children}</td>,
          a: ({ href, children }) => {
            const cite = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : '';
            return /^\[\d+\]$/.test(cite) ? (
              <a href={href} target="_blank" rel="noreferrer" title={hostOf(href) ?? undefined} className="ml-0.5 align-super font-mono text-[10px] text-orange hover:underline">
                {cite.slice(1, -1)}
              </a>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                {children}
              </a>
            );
          },
        }}
      >
        {linked}
      </Markdown>
      {references.length ? (
        <section className="mt-8 border-t border-line pt-5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{references.length} sources</h3>
          <ol className="mt-2 space-y-1.5">
            {references.map((r) => (
              <li key={r.n} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 text-[13px]">
                <span className="font-mono text-[11px] text-muted">{r.n}</span>
                <a href={r.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-start gap-1.5 hover:underline">
                  <Favicon host={hostOf(r.url)} name={hostOf(r.url) ?? '?'} size={12} />
                  <span className="min-w-0">
                    <span className="block truncate">{r.title || hostOf(r.url)}</span>
                    <span className="block truncate font-mono text-[10px] text-faint">{hostOf(r.url)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
