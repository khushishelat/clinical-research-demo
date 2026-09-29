// Turns citations into links a person can open. Connector facts are sometimes
// cited as the connector's own server URL (seen in testing:
// https://pubmed.mcp.claude.com/mcp, https://hcls.mcp.claude.com/npi_registry/mcp)
// or as a ClinicalTrials.gov API URL. Map those to public pages.

export type LinkContext = { nctId?: string; pmids?: string[]; npi?: string };

export type SourceKind =
  | 'registry'
  | 'sec_filing'
  | 'press_release'
  | 'partner_filing'
  | 'conference'
  | 'publication'
  | 'preprint'
  | 'non_us_registry'
  | 'site_or_group'
  | 'news';

export function publicUrl(url: string, ctx: LinkContext = {}): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'clinicaltrials.gov' && u.pathname.startsWith('/api/')) {
    const id = u.pathname.match(/NCT\d{8}/)?.[0] ?? ctx.nctId;
    return id ? `https://clinicaltrials.gov/study/${id}` : 'https://clinicaltrials.gov/';
  }
  if (host.endsWith('.mcp.claude.com')) {
    if (u.pathname.includes('npi')) return ctx.npi ? `https://npiregistry.cms.hhs.gov/provider-view/${ctx.npi}` : 'https://npiregistry.cms.hhs.gov/';
    if (host.startsWith('pubmed')) return ctx.pmids?.[0] ? `https://pubmed.ncbi.nlm.nih.gov/${ctx.pmids[0]}/` : null;
    if (u.pathname.includes('clinical') || host.startsWith('clinical')) return ctx.nctId ? `https://clinicaltrials.gov/study/${ctx.nctId}` : null;
    return null;
  }
  return url;
}

/** True when a citation came from a connector rather than the open web. */
export const isConnectorCitation = (url: string) => /mcp\.claude\.com|clinicaltrials\.gov\/api\//.test(url);

export function sourceKind(url: string): SourceKind {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'news';
  }
  if (host === 'clinicaltrials.gov' || host.endsWith('.mcp.claude.com')) return 'registry';
  if (host === 'sec.gov') return 'sec_filing';
  if (host.includes('hkexnews')) return 'partner_filing';
  if (/asco\.org|ascopubs\.org|esmo\.org|aacrjournals\.org|wclc|iaslc/.test(host)) return 'conference';
  if (/biorxiv|medrxiv/.test(host)) return 'preprint';
  if (/pubmed|pmc\.ncbi|doi\.org|sciencedirect|sagepub|thelancet|nejm|jamanetwork|nature\.com|elsevierpure/.test(host)) return 'publication';
  if (/cancer\.fr|euclinicaltrials|clinicaltrialsregister\.eu|chictr|jrct/.test(host)) return 'non_us_registry';
  if (/mskcc|mdanderson|eortc|ecog-acrin|unicancer|chu-|massgeneral|cedars|umhealthresearch|childrenshospital/.test(host)) return 'site_or_group';
  if (/businesswire|globenewswire|prnewswire/.test(host) || /^ir\.|investors?\./.test(host)) return 'press_release';
  return 'news';
}
