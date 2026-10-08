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

export interface OcaJob {
  jobId: string;
  modelNumber: string;
  modelDescription?: string;
  integrationRackPartNumber?: string;
  server?: string;
  solutionName?: string;
  isSolution: boolean;
  isStorage: boolean;
  quotationMode: 'aaS';
  serviceType: string;
  generateEndBom: boolean;
  enabled: boolean;
  source: ConfigurationSource;
  inputRow: number;
}
