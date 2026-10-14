import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { ExcelWriter } from '../../src/excel/excel-writer';
import { createPendingResult } from '../../src/models/automation-result';

test('writes service and Start/End BOM details to the result workbook', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oca-results-'));
  const result = createPendingResult('JOB-1', 'MODEL-1');
  Object.assign(result, {
    serviceExperience: 'Lite', serviceTerm: '5 Years', dataPrivacy: 'None/Manual',
    startBomId: 'START-1', endBomId: 'END-1', endBomAssociated: 'Yes',
    startBillingTier: 'Start tier', startAllocatedMemory: '109', startServerCount: '1', startUsedCpuCore: '32',
    endBillingTier: 'End tier', endAllocatedMemory: '327', endServerCount: '3', endUsedCpuCore: '96',
  });
  const writer = new ExcelWriter(directory, path.join(directory, 'models.xlsx'));
  await writer.writeResult(result);

  const workbook = XLSX.readFile(writer.outputPath);
  const row = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Results, { defval: '' })[0];
  expect(row).toMatchObject({
    'Service Experience': 'Lite', 'Service Term': '5 Years', 'Data Privacy': 'None/Manual',
    'Start BOM UCID': 'START-1', 'End BOM UCID': 'END-1', 'Associate End BOM': 'Yes',
    'Start Allocated Memory': '109', 'End Allocated Memory': '327',
  });
});

test('lists each model\'s Start and End BOM UCIDs on a last sheet, with the failure reason as comment', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oca-results-'));
  const writer = new ExcelWriter(directory, path.join(directory, 'models.xlsx'));
  const done = createPendingResult('JOB-1', 'P72176-B21');
  Object.assign(done, { executionStatus: 'Success', startBomId: 'START-1', endBomId: 'END-1', endBomAssociated: 'Yes', endBomStatus: 'Generated and associated' });
  const failed = createPendingResult('JOB-2', 'S2U63A');
  Object.assign(failed, { executionStatus: 'Failed', errorStep: 'Open BOM and Billing Tier Setup', errorMessage: 'Billing Tier Setup dialog should close after OK' });
  await writer.writeResult(done);
  await writer.writeResult(failed);

  const workbook = XLSX.readFile(writer.outputPath);
  expect(workbook.SheetNames.at(-1)).toBe('BOM UCIDs');
  expect(XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['BOM UCIDs'], { defval: '' })).toEqual([
    { 'Job ID': 'JOB-1', 'Model Number': 'P72176-B21', 'Start BOM UCID': 'START-1', 'End BOM UCID': 'END-1',
      'End BOM Associated': 'Yes', 'Execution Status': 'Success', Comments: 'Generated and associated' },
    { 'Job ID': 'JOB-2', 'Model Number': 'S2U63A', 'Start BOM UCID': '', 'End BOM UCID': '',
      'End BOM Associated': 'No', 'Execution Status': 'Failed',
      Comments: 'Open BOM and Billing Tier Setup: Billing Tier Setup dialog should close after OK' },
  ]);
});
