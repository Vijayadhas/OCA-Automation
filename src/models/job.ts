import type { ComponentInstruction } from './component-instruction';

export interface DetailedConfigurationSource {
  kind: 'detailed-excel';
  instructions: ComponentInstruction[];
}

export interface ReferenceConfigurationSource {
  kind: 'reference';
  referenceType: 'ucid' | 'bom' | 'smart-template' | 'api' | 'database';
  reference: string;
}

export type ConfigurationSource = DetailedConfigurationSource | ReferenceConfigurationSource;

/**
 * The route a model takes: a single CTO server, a Solution Wizard model, or a Storage model.
 * Preset types fill in what a model family always needs; any Excel value given wins:
 * - Nutanix: a server sold to the Nutanix customer account. Customer Account is set to Nutanix in
 *   Advanced Settings and the search result containing "Nutanix" is opened; the rest is the Server route.
 * - Arcus EMEA: the Arcus dHCI solution (HPE GreenLake for PC3000 with Alletra Storage MP (Block)) quoted in
 *   Saudi Arabia, searched by the word "Private" and built in its Wizard (recordings of 2026-10-20 and 21).
 * - Simplivity Wizard: a SimpliVity model built in its Wizard card, not its CTO card ("S8J33A" — CTO beside
 *   "simplivity380Gen12" — Wizard): Processor and Memory first, then what the wizard still asks for.
 * - Alletra 4000: HPE Alletra Storage Servers, searched by "4000" and built in their wizard: the base Alletra
 *   Storage Server first, then Processor and Memory (recording of 2026-10-22).
 * - Alletra 5000: HPE Alletra 5000 arrays, searched by "alletra" and built in the "Alletra5000Sol" — Wizard, tab by
 *   tab (Array Selection, Base Array Components); the array has no Processor or Memory dropdown (2026-10-22).
 */
export const MODEL_TYPES = ['Server', 'Solution', 'Storage', 'Nutanix', 'Arcus EMEA', 'Simplivity Wizard', 'Alletra 4000', 'Alletra 5000'] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

/** What a preset Model Type fills in when the Excel cell is blank. */
export interface ModelPreset {
  route: 'Server' | 'Solution';
  customerAccount?: string;
  /** Text the search result to open must contain. */
  description?: string;
  country?: string;
}

/** Customer Account a Nutanix model is configured under, and the text its search result contains. */
export const NUTANIX = 'Nutanix';

export const MODEL_PRESETS: Partial<Record<ModelType, ModelPreset>> = {
  Nutanix: { route: 'Server', customerAccount: NUTANIX, description: NUTANIX },
  'Simplivity Wizard': { route: 'Solution' },
  'Arcus EMEA': { route: 'Solution', description: 'HPE GreenLake for PC3000 with Alletra Storage MP (Block)', country: 'SAUDI ARABIA' },
  'Alletra 4000': { route: 'Solution', description: 'HPE Alletra Storage Servers' },
  'Alletra 5000': { route: 'Solution', description: 'HPE Alletra 5000' },
};

const presetOf = (modelType: string | undefined): ModelPreset | undefined =>
  modelType ? MODEL_PRESETS[modelType as ModelType] : undefined;

/**
 * Reads a Model Type value ("Server", "solutions", " Storage ", "arcus-emea"). Unknown text is returned as given
 * so the validator can report it; blank means not given (the route is then detected).
 */
export function parseModelType(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  return MODEL_TYPES.find((type) => key(type) === key(raw)) ?? raw;
}

/** Customer Account to set in Advanced Settings: the Excel value, else the preset's (Nutanix), else none (cleared). */
export function customerAccountFor(job: Pick<OcaJob, 'customerAccount' | 'modelType'>): string {
  return job.customerAccount?.trim() || presetOf(job.modelType)?.customerAccount || '';
}

/** Text the search result to open must contain: the Excel description, else the preset's. */
export function searchDescriptionFor(job: Pick<OcaJob, 'modelDescription' | 'solutionName' | 'modelType'>): string | undefined {
  return job.modelDescription ?? job.solutionName ?? presetOf(job.modelType)?.description;
}

/** Landing page Country: the Excel value, else the preset's (Arcus EMEA: Saudi Arabia), else OCA's default. */
export function countryFor(job: Pick<OcaJob, 'country' | 'modelType'>): string | undefined {
  return job.country?.trim() || presetOf(job.modelType)?.country;
}

/** Route flags from a Model Type; without one, the given fallbacks (old Solution/Storage columns). */
export function routeFromModelType(modelType: string | undefined, fallback: { isSolution: boolean; isStorage: boolean }) {
  const route = presetOf(modelType)?.route ?? modelType;
  return modelType
    ? { modelType, isSolution: route === 'Solution', isStorage: route === 'Storage' }
    : { modelType: undefined, ...fallback };
}

export interface OcaJob {
  jobId: string;
  modelNumber: string;
  modelDescription?: string;
  integrationRackPartNumber?: string;
  server?: string;
  solutionName?: string;
  /** Server, Solution, Storage, Nutanix, Arcus EMEA, Simplivity Wizard, Alletra 4000 or Alletra 5000 (Excel "Model Type"); blank = detected from the other columns and OCA. */
  modelType?: string;
  /** Advanced Settings Customer Account (Excel "Customer Account"); blank = cleared, or Nutanix for Nutanix models. */
  customerAccount?: string;
  /** Landing page Country (Excel "Country", e.g. Saudi Arabia or SA); blank = the preset's (Arcus EMEA: Saudi Arabia), else OCA's default, United States. */
  country?: string;
  isSolution: boolean;
  isStorage: boolean;
  quotationMode: 'aaS';
  serviceType: string;
  generateEndBom: boolean;
  enabled: boolean;
  source: ConfigurationSource;
  inputRow: number;
}
