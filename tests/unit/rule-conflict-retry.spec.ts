import { test, expect, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { run } from '../../src/main';
import { BrowserSession } from '../../src/automation/browser-session';
import { OcaEngine } from '../../src/automation/oca-engine';
import { ConfigurationRuleError } from '../../src/automation/configuration-errors';
import { ExcelWriter } from '../../src/excel/excel-writer';
import { createPendingResult } from '../../src/models/automation-result';

const workbook = (name: string) => {
  const directory = test.info().outputPath(name);
  fs.mkdirSync(directory, { recursive: true });
  const input = path.join(directory, 'models.xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ 'Job ID': 'JOB-001', 'Model Number': 'P72176-B21' }]), 'Models');
  XLSX.writeFile(book, input);
  return { directory, input };
};

async function withMockedEngine(processJob: OcaEngine['processJob'], body: () => Promise<void>) {
  const originalStart = BrowserSession.prototype.start;
  const originalProcess = OcaEngine.prototype.processJob;
  BrowserSession.prototype.start = async () => ({} as BrowserContext);
  OcaEngine.prototype.processJob = processJob;
  try { await body(); } finally {
    BrowserSession.prototype.start = originalStart;
    OcaEngine.prototype.processJob = originalProcess;
  }
}

test('starts a model again with new picks when OCA rules stay unmet', async () => {
  const { directory, input } = workbook('retry-success');
  let attempts = 0;
  await withMockedEngine(async (job, retryCount) => {
    attempts += 1;
    if (attempts < 3) throw new ConfigurationRuleError('Cannot continue to Services while OCA error icons remain: Processor');
    const result = createPendingResult(job.jobId, job.modelNumber, retryCount);
    result.executionStatus = 'Success';
    return result;
  }, async () => {
    expect(await run(['--input', input, '--output', directory])).toBe(0);
  });
  expect(attempts).toBe(3);
  expect(new ExcelWriter(directory, input).getExisting('JOB-001')?.executionStatus).toBe('Success');
});

test('gives up after three attempts, and never retries other failures', async () => {
  const conflict = workbook('retry-exhausted');
  let attempts = 0;
  await withMockedEngine(async () => {
    attempts += 1;
    throw new ConfigurationRuleError('Cannot continue to Services while OCA error icons remain: Storage Devices');
  }, async () => {
    expect(await run(['--input', conflict.input, '--output', conflict.directory])).toBe(1);
  });
  expect(attempts).toBe(3);

  const other = workbook('no-retry');
  attempts = 0;
  await withMockedEngine(async () => {
    attempts += 1;
    throw new Error('OCA returned no search results for P72176-B21 in aaS mode');
  }, async () => {
    expect(await run(['--input', other.input, '--output', other.directory])).toBe(1);
  });
  expect(attempts).toBe(1);
});
