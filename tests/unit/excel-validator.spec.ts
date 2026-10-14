import { test, expect } from '@playwright/test';
import { ExcelValidator } from '../../src/excel/excel-validator';
import type { OcaJob } from '../../src/models/job';

const job = (jobId: string, inputRow: number) => ({
  jobId, modelNumber: 'P72176-B21', quotationMode: 'aaS', isSolution: false, isStorage: false,
  serviceType: 'Default', generateEndBom: true, enabled: true, inputRow,
  source: { kind: 'detailed-excel', instructions: [] },
}) as unknown as OcaJob;

test('rejects Job IDs that differ only in case or spaces', () => {
  expect(() => new ExcelValidator().validate([job('JOB-001', 2), job(' job-001 ', 3)]))
    .toThrow('Models row 3: duplicate Job ID  job-001 ; every Job ID must be unique');
});

test('accepts unique Job IDs', () => {
  expect(() => new ExcelValidator().validate([job('JOB-001', 2), job('JOB-002', 3)])).not.toThrow();
});
