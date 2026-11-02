export type ExecutionStatus = 'Success' | 'Failed' | 'Skipped' | 'Unsupported';

/**
 * One billing tier row of the Start or End BOM table on OCA's End BOM page, with every visible
 * column under OCA's own header (Billing Tier, Include Billing Tier, Allocated Memory, Server,
 * Used CPU Core, Written Usable GB/TB, Fixed, ...). Columns differ by model, so they are kept as read.
 */
export interface BomTierRecord {
  bom: 'Start' | 'End';
  ucid: string;
  values: Record<string, string>;
}

export interface AutomationResult {
  jobId: string;
  modelNumber: string;
  executionStatus: ExecutionStatus;
  ucid: string;
  quotationMode: string;
  serviceExperience: string;
  serviceTerm: string;
  dataPrivacy: string;
  ocaConfigStatus: string;
  endBomStatus: string;
  startBomId: string;
  endBomId: string;
  endBomAssociated: string;
  startBillingTier: string;
  startBillingTierCustomName: string;
  startAllocatedMemory: string;
  startServerCount: string;
  startUsedCpuCore: string;
  endBillingTier: string;
  endBillingTierCustomName: string;
  endAllocatedMemory: string;
  endServerCount: string;
  endUsedCpuCore: string;
  /** Every billing tier of the Start and End BOM, read just before Associate End BOM. */
  bomTiers: BomTierRecord[];
  selectedComponents: string;
  startTime: string;
  endTime: string;
  duration: number;
  retryCount: number;
  errorStep: string;
  errorMessage: string;
  screenshotPath: string;
  tracePath: string;
}

export function createPendingResult(jobId: string, modelNumber: string, retryCount = 0): AutomationResult {
  return {
    jobId,
    modelNumber,
    executionStatus: 'Failed',
    ucid: '',
    quotationMode: '',
    serviceExperience: '',
    serviceTerm: '',
    dataPrivacy: '',
    ocaConfigStatus: '',
    endBomStatus: 'Not requested',
    startBomId: '',
    endBomId: '',
    endBomAssociated: 'No',
    startBillingTier: '',
    startBillingTierCustomName: '',
    startAllocatedMemory: '',
    startServerCount: '',
    startUsedCpuCore: '',
    endBillingTier: '',
    endBillingTierCustomName: '',
    endAllocatedMemory: '',
    endServerCount: '',
    endUsedCpuCore: '',
    bomTiers: [],
    selectedComponents: '',
    startTime: new Date().toISOString(),
    endTime: '',
    duration: 0,
    retryCount,
    errorStep: '',
    errorMessage: '',
    screenshotPath: '',
    tracePath: '',
  };
}
