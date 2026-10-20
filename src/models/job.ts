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
 * Nutanix is a server sold to the Nutanix customer account: Customer Account is set to Nutanix in
 * Advanced Settings and the search result containing "Nutanix" is opened; the rest is the Server route.
 */
export const MODEL_TYPES = ['Server', 'Solution', 'Storage', 'Nutanix'] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

/**
 * Reads a Model Type value ("Server", "solutions", " Storage "). Unknown text is returned as given
 * so the validator can report it; blank means not given (the route is then detected).
 */
export function parseModelType(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  return MODEL_TYPES.find((type) => type.toLowerCase() === raw.toLowerCase().replace(/s$/, '')) ?? raw;
}

/** Customer Account a Nutanix model is configured under, and the text its search result contains. */
export const NUTANIX = 'Nutanix';

/** Customer Account to set in Advanced Settings: the Excel value, Nutanix for Nutanix models, else none (cleared). */
export function customerAccountFor(job: Pick<OcaJob, 'customerAccount' | 'modelType'>): string {
  return job.customerAccount?.trim() || (job.modelType === 'Nutanix' ? NUTANIX : '');
}

/** Text the search result to open must contain: the Excel description, "Nutanix" for Nutanix models. */
export function searchDescriptionFor(job: Pick<OcaJob, 'modelDescription' | 'solutionName' | 'modelType'>): string | undefined {
  return job.modelDescription ?? job.solutionName ?? (job.modelType === 'Nutanix' ? NUTANIX : undefined);
}

/** Route flags from a Model Type; without one, the given fallbacks (old Solution/Storage columns). */
export function routeFromModelType(modelType: string | undefined, fallback: { isSolution: boolean; isStorage: boolean }) {
  return modelType
    ? { modelType, isSolution: modelType === 'Solution', isStorage: modelType === 'Storage' }
    : { modelType: undefined, ...fallback };
}

export interface OcaJob {
  jobId: string;
  modelNumber: string;
  modelDescription?: string;
  integrationRackPartNumber?: string;
  server?: string;
  solutionName?: string;
  /** Server, Solution, Storage, or Nutanix (Excel "Model Type"); blank = detected from the other columns and OCA. */
  modelType?: string;
  /** Advanced Settings Customer Account (Excel "Customer Account"); blank = cleared, or Nutanix for Nutanix models. */
  customerAccount?: string;
  /** Landing page Country (Excel "Country", e.g. Saudi Arabia or SA); blank = OCA's default, United States. */
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
