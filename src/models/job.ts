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

/** The route a model takes: a single CTO server, a Solution Wizard model, or a Storage model. */
export const MODEL_TYPES = ['Server', 'Solution', 'Storage'] as const;
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
  /** Server, Solution, or Storage (Excel "Model Type"); blank = detected from the other columns and OCA. */
  modelType?: string;
  isSolution: boolean;
  isStorage: boolean;
  quotationMode: 'aaS';
  serviceType: string;
  generateEndBom: boolean;
  enabled: boolean;
  source: ConfigurationSource;
  inputRow: number;
}
