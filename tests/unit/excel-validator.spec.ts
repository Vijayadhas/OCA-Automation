import { test, expect } from '@playwright/test';
import { ExcelValidator } from '../../src/excel/excel-validator';
import type { OcaJob } from '../../src/models/job';
import { prepareRunJobs } from '../../src/app/run-workbook';

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

test('the dashboard Model Type sets the route of a posted job', () => {
  const [solution, storage, detected] = prepareRunJobs([
    { ...job('JOB-1', 2), modelType: 'Solution' }, { ...job('JOB-2', 3), modelType: 'Storage' }, { ...job('JOB-3', 4), isStorage: true },
  ]);
  expect([solution.isSolution, solution.isStorage]).toEqual([true, false]);
  expect([storage.isSolution, storage.isStorage]).toEqual([false, true]);
  expect([detected.modelType, detected.isStorage]).toEqual([undefined, true]);
});
