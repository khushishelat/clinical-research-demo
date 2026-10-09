// A thumbnail of an indication's map for the homepage: the first company rows, one dot per
// trial at its first-posted date (bigger for later phases, grey when an investigator runs it,
// hollow when finished), orange ticks for news, and a line at today. Things from the last
// week pulse.

type Thumb = { dots: { x: string; p: number; c: boolean; done: boolean }[]; news: string[] }[];

const W = 400;
const ROW = 15;
const START = Date.parse('2019-01-01');

export function MiniMap({ rows, today }: { rows: Thumb; today: string }) {
  const end = Date.parse(`${Number(today.slice(0, 4)) + 1}-12-31`);
  const x = (iso: string) => Math.min(W, Math.max(0, ((Date.parse(iso) - START) / (end - START)) * W));
  const week = new Date(Date.parse(today) - 6 * 86_400_000).toISOString().slice(0, 10);
  const recent = (iso: string) => iso >= week && iso <= today;
  const years = Array.from({ length: Number(today.slice(0, 4)) - 2017 }, (_, i) => x(`${2020 + i}-01-01`));
  const h = rows.length * ROW;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="block h-auto w-full" aria-hidden="true">
      {years.map((at) => (
        <line key={at} x1={at} x2={at} y1={0} y2={h} className="stroke-line" strokeDasharray="2 3" />
      ))}
      {rows.map((r, i) => (
        <g key={i} transform={`translate(0 ${i * ROW})`}>
          {i ? <line x1={0} x2={W} y1={0} y2={0} className="stroke-line" /> : null}
          {r.news.map((d, j) => (
            <rect key={`n${j}`} x={x(d) - 1.5} y={2} width={3} height={3} className={`fill-orange ${recent(d) ? 'svg-ping' : ''}`} />
          ))}
          {r.dots.map((d, j) => {
            const radius = [1.3, 1.5, 1.9, 2.3, 2.6][Math.max(0, Math.min(4, d.p))];
            const y = 7 + ((j * 7919) % 6);
            const color = d.c ? 'var(--color-ink)' : '#adadac';
            return <circle key={j} cx={x(d.x)} cy={y} r={radius} fill={d.done ? 'none' : color} stroke={d.done ? color : 'none'} strokeWidth={0.8} className={recent(d.x) ? 'svg-ping' : undefined} />;
          })}
        </g>
      ))}
      <line x1={x(today)} x2={x(today)} y1={0} y2={h} className="stroke-ink" strokeWidth={1} />
    </svg>
  );
}
