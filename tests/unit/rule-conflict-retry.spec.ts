import { test, expect, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { run } from '../../src/main';
import { BrowserSession } from '../../src/automation/browser-session';
import { OcaEngine } from '../../src/automation/oca-engine';
import { ConfigurationRuleError } from '../../src/automation/configuration-errors';
import { ModelNotFoundError } from '../../src/core/errors';
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

test('does not retry a failed model by default; the team retries it by hand', async () => {
  const { directory, input } = workbook('no-retry-default');
  let attempts = 0;
  await withMockedEngine(async () => {
    attempts += 1;
    throw new ConfigurationRuleError('Cannot continue to Services while OCA error icons remain: Processor');
  }, async () => {
    expect(await run(['--input', input, '--output', directory])).toBe(1);
  });
  expect(attempts).toBe(1);
  expect(new ExcelWriter(directory, input).getExisting('JOB-001')?.executionStatus).toBe('Failed');
});

test.describe('with OCA_MODEL_ATTEMPTS=3', () => {
test.beforeEach(() => { process.env.OCA_MODEL_ATTEMPTS = '3'; });
test.afterEach(() => { delete process.env.OCA_MODEL_ATTEMPTS; });

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

test('gives up after three attempts, and never retries a model OCA does not offer', async () => {
  const conflict = workbook('retry-exhausted');
  let attempts = 0;
  await withMockedEngine(async () => {
    attempts += 1;
    throw new ConfigurationRuleError('Cannot continue to Services while OCA error icons remain: Storage Devices');
  }, async () => {
    expect(await run(['--input', conflict.input, '--output', conflict.directory])).toBe(1);
  });
  expect(attempts).toBe(3);

  const missing = workbook('no-retry');
  attempts = 0;
  await withMockedEngine(async () => {
    attempts += 1;
    throw new ModelNotFoundError('OCA returned no search results for P72176-B21 in aaS mode');
  }, async () => {
    expect(await run(['--input', missing.input, '--output', missing.directory])).toBe(1);
  });
  expect(attempts).toBe(1);
});

test('starts a model again after any other failure, such as a timeout', async () => {
  const { directory, input } = workbook('retry-any');
  let attempts = 0;
  await withMockedEngine(async (job, retryCount) => {
    attempts += 1;
    if (attempts === 1) throw new Error('locator.click: Timeout 30000ms exceeded.');
    const result = createPendingResult(job.jobId, job.modelNumber, retryCount);
    result.executionStatus = 'Success';
    return result;
  }, async () => {
    expect(await run(['--input', input, '--output', directory])).toBe(0);
  });
  expect(attempts).toBe(2);
});
});
