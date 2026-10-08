import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { prepareRunJobs, writeRunWorkbook } from '../../src/app/run-workbook';
import { ExcelReader } from '../../src/excel/excel-reader';
import type { OcaJob } from '../../src/models/job';

const dashboardJob = (overrides: Partial<OcaJob>): OcaJob => ({
  jobId: 'J-1', modelNumber: 'P72176-B21', isSolution: false, isStorage: false, quotationMode: 'aaS',
  serviceType: 'Random', generateEndBom: true, enabled: true,
  source: { kind: 'detailed-excel', instructions: [] }, inputRow: 0, ...overrides,
});

const roundTrip = (jobs: OcaJob[]): OcaJob[] => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oca-run-')), 'input.xlsx');
  writeRunWorkbook(prepareRunJobs(jobs), file);
  return new ExcelReader().read(file);
};

const sections = (job: OcaJob) => job.source.kind === 'detailed-excel'
  ? job.source.instructions.map((item) => `${item.section}:${item.selectionType}`) : [];

test('a model without components keeps random selections when another model has components', () => {
  const jobs = roundTrip([
    dashboardJob({ jobId: 'PLAIN' }),
    dashboardJob({
      jobId: 'DETAILED',
      source: { kind: 'detailed-excel', instructions: [{
        jobId: 'DETAILED', section: 'Memory', productNumber: 'MEM-1', quantity: 2, selectionType: 'quantity', sequence: 10,
      }] },
    }),
  ]);
  expect(sections(jobs[0])).toEqual([
    'Processor:random', 'Memory:random', 'Smart Chassis:random', 'Power Supplies:random',
  ]);
  expect(sections(jobs[1])).toEqual(['Memory:quantity']);
});

test('a single dashboard model without components gets random selections', () => {
  const [job] = roundTrip([dashboardJob({ jobId: 'ONLY' })]);
  expect(sections(job)).toEqual([
    'Processor:random', 'Memory:random', 'Smart Chassis:random', 'Power Supplies:random',
  ]);
});

test('Storage, Solution, and component descriptions survive the dashboard workbook', () => {
  const [storage, solution] = roundTrip([
    dashboardJob({ jobId: 'STORAGE', isStorage: true }),
    dashboardJob({
      jobId: 'SOLUTION', isSolution: true,
      source: { kind: 'detailed-excel', instructions: [{
        jobId: 'SOLUTION', section: 'Processor', productNumber: 'CPU-1', description: 'Intel Xeon',
        quantity: 1, selectionType: 'radio', sequence: 10,
      }] },
    }),
  ]);
  expect(storage).toMatchObject({ jobId: 'STORAGE', isStorage: true, isSolution: false });
  expect(solution).toMatchObject({ jobId: 'SOLUTION', isStorage: false, isSolution: true });
  expect(solution.source.kind === 'detailed-excel' && solution.source.instructions[0].description).toBe('Intel Xeon');
});

test('dashboard jobs are normalized before validation', () => {
  const posted = { jobId: 'RAW', modelNumber: 'P72176-B21', serviceType: 'Random', generateEndBom: true, enabled: true } as OcaJob;
  const [job] = prepareRunJobs([posted]);
  expect(job).toMatchObject({ isSolution: false, isStorage: false, quotationMode: 'aaS', inputRow: 2 });
  expect(sections(job)).toHaveLength(4);
});
