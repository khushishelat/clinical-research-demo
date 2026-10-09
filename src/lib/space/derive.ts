// Small derivations shared by the loader (server-only) and the views (pure).

import type { Space } from './load';

/** Trials on a company row: the company's own, and investigator-run trials of its drugs. */
export const mapTrialIds = (s: Pick<Space, 'companies' | 'included'>) => new Set(s.companies.filter((c) => !c.web_only || s.included.has(c.name)).flatMap((c) => [...c.trials, ...c.investigator_trials]));

/** When anything on the map last changed: the registry pull, or the latest news a monitor brought. */
export const freshest = (s: Pick<Space, 'fetched' | 'news'>) => [s.fetched, s.news.last_new ?? ''].sort().at(-1)!;
