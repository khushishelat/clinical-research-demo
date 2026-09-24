/** Core data model for the pipeline intelligence demo.
 *  Field names mirror ClinicalTrials.gov registry fields so Task API
 *  output_schemas map 1:1 onto these types.
 */

export type TrialStatus =
  | "RECRUITING"
  | "ACTIVE_NOT_RECRUITING"
  | "COMPLETED"
  | "NOT_YET_RECRUITING"
  | "SUSPENDED"
  | "TERMINATED"
  | "WITHDRAWN"
  | "UNKNOWN";

export type ChangeType = "NEW" | "PHASE_CHANGE" | "STATUS_CHANGE";

export interface Citation {
  title: string;
  url: string;
}

export interface TrialChange {
  type: ChangeType;
  /** Human-readable, e.g. "Phase 2 → Phase 3" */
  detail: string;
  detectedAt: string; // ISO date
  basis: Citation[];
}

export interface EnrichmentItem {
  kind: "PRESS_RELEASE" | "EARNINGS" | "FDA_FILING" | "PUBLICATION" | "NEWS";
  headline: string;
  summary: string;
  date?: string;
  source: string;
  url: string;
}

export interface Trial {
  nctId: string;
  title: string;
  sponsor: string;
  phase: string; // e.g. "Phase 3"
  status: TrialStatus;
  conditions: string[];
  interventions: string[];
  studyType: string;
  enrollment?: number;
  startDate?: string;
  primaryCompletionDate?: string;
  lastUpdatePosted?: string;
  locationCount?: number;
  change?: TrialChange;
  enrichment: EnrichmentItem[];
  citations: Citation[];
}

export interface Sponsor {
  id: string;
  name: string;
  shortName: string;
  focus: string;
}

export const SPONSORS: Sponsor[] = [
  { id: "lilly", name: "Eli Lilly and Company", shortName: "Lilly", focus: "Obesity · Diabetes · Alzheimer's" },
  { id: "novo", name: "Novo Nordisk", shortName: "Novo", focus: "Obesity · Diabetes · GLP-1" },
  { id: "pfizer", name: "Pfizer Inc.", shortName: "Pfizer", focus: "Obesity · Oncology · Vaccines" },
];

export interface PipelineBrief {
  generatedAt: string;
  title: string;
  /** Markdown body with inline citations */
  body: string;
  citations: Citation[];
}
