import type { OcaJob } from '../models/job';
import { isSelectionType, type ComponentInstruction } from '../models/component-instruction';

export class InputValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Input workbook validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'InputValidationError';
  }
}

export class ExcelValidator {
  validate(jobs: OcaJob[]): void {
    const issues: string[] = [];
    const ids = new Set<string>();
    for (const job of jobs) {
      if (!job.jobId) issues.push(`Models row ${job.inputRow}: Job ID is required`);
      if (!job.modelNumber) issues.push(`Models row ${job.inputRow}: Model Number is required`);
      if (job.quotationMode !== 'aaS') issues.push(`Models row ${job.inputRow}: Quotation Mode must be aaS`);
      if (job.isSolution && job.isStorage) issues.push(`Models row ${job.inputRow}: Solution and Storage cannot both be Yes`);
      if (job.jobId && ids.has(job.jobId)) issues.push(`Models row ${job.inputRow}: duplicate Job ID ${job.jobId}`);
      ids.add(job.jobId);
      if (job.source.kind === 'detailed-excel') {
        this.validateInstructions(job.source.instructions, job, issues);
      }
    }
    if (issues.length) throw new InputValidationError(issues);
  }

  private validateInstructions(instructions: ComponentInstruction[], job: OcaJob, issues: string[]): void {
    const sequences = new Set<number>();
    for (const instruction of instructions) {
      const prefix = `Components job ${job.jobId}, sequence ${instruction.sequence}`;
      if (!instruction.section) issues.push(`${prefix}: Section is required`);
      if (!isSelectionType(instruction.selectionType)) issues.push(`${prefix}: invalid Selection Type`);
      if (sequences.has(instruction.sequence)) issues.push(`${prefix}: duplicate Sequence`);
      sequences.add(instruction.sequence);
      if (['radio', 'quantity', 'checkbox', 'automatic'].includes(instruction.selectionType) && !instruction.productNumber) {
        issues.push(`${prefix}: Product Number is required for ${instruction.selectionType}`);
      }
      if (instruction.selectionType === 'quantity' && (!Number.isInteger(instruction.quantity) || Number(instruction.quantity) < 0)) {
        issues.push(`${prefix}: Quantity must be a non-negative integer`);
      }
      if (instruction.selectionType === 'random' && !/^(processor|memory|smart chassis|power supplies)$/i.test(instruction.section)) {
        issues.push(`${prefix}: random selection is supported only for Processor, Memory, Smart Chassis, or Power Supplies`);
      }
      if (instruction.selectionType === 'configuration' && !instruction.configurationText) {
        issues.push(`${prefix}: Configuration Text is required`);
      }
    }
  }
}
