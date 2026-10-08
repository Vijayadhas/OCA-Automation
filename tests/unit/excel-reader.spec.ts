import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { ExcelReader } from '../../src/excel/excel-reader';
import { InputValidationError } from '../../src/excel/excel-validator';

function workbookAt(models: Record<string, unknown>[], components: Record<string, unknown>[]): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oca-excel-'));
  const file = path.join(directory, 'input.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(models), 'Models');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(components), 'Components');
  XLSX.writeFile(workbook, file);
  return file;
}

test('maps and sequences detailed Excel instructions', () => {
  const file = workbookAt([{
    'Job ID': 'J-1', 'Model Number': 'P72176-B21', 'Service Type': 'Lite',
    'Model Description': 'HPE ProLiant configured model', 'Integration Rack Part number': 'P9K08A',
    Server: 'HPE ProLiant DL360 Gen11',
    'Generate End BOM': 'Yes', Enabled: 'Yes',
  }], [
    { 'Job ID': 'J-1', Section: 'Memory', 'Product Number': 'MEM-1', Quantity: 4, 'Selection Type': 'quantity', Sequence: 20 },
    { 'Job ID': 'J-1', Section: 'Processor', 'Product Number': 'CPU-1', Quantity: 2, 'Selection Type': 'radio', Sequence: 10 },
  ]);
  const jobs = new ExcelReader().read(file);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    jobId: 'J-1', modelNumber: 'P72176-B21', modelDescription: 'HPE ProLiant configured model',
    integrationRackPartNumber: 'P9K08A', serviceType: 'Lite', generateEndBom: true,
    server: 'HPE ProLiant DL360 Gen11',
  });
  expect(jobs[0].source.kind).toBe('detailed-excel');
  if (jobs[0].source.kind === 'detailed-excel') {
    expect(jobs[0].source.instructions.map((item) => item.productNumber)).toEqual(['CPU-1', 'MEM-1']);
  }
});

test('rejects invalid quantity instructions', () => {
  const file = workbookAt([{
    'Job ID': 'J-1', 'Model Number': 'MODEL-1', Enabled: 'Yes',
  }], [{
    'Job ID': 'J-1', Section: 'Memory', 'Product Number': 'MEM-1', Quantity: 'many',
    'Selection Type': 'quantity', Sequence: 1,
  }]);
  expect(() => new ExcelReader().read(file)).toThrow(InputValidationError);
});

test('maps one-row business worksheet without a Components tab', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oca-flat-excel-'));
  const file = path.join(directory, 'input.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    'Job ID': 'FLAT-1', 'Model Number': 'P86963-B21', 'Quotation Mode': 'aaS',
    Processor: 'CPU-1', 'Processor Qty': 2, Memory: 'MEM-1', 'Memory Qty': 4,
    'Smart Chassis Product': 'P72221-B21', 'Smart Chassis Qty': 1,
    'Chassis Config': 'Config # 3-18-1', 'Power Supply': 'PSU-1', 'Power Qty': 2,
    Service: 'Lite', 'Generate End BOM': 'Yes', Enabled: 'Yes',
  }]), 'Models');
  XLSX.writeFile(workbook, file);

  const job = new ExcelReader().read(file)[0];
  expect(job).toMatchObject({ jobId: 'FLAT-1', modelNumber: 'P86963-B21', quotationMode: 'aaS', serviceType: 'Lite' });
  if (job.source.kind === 'detailed-excel') {
    expect(job.source.instructions.map((item) => [item.section, item.productNumber, item.quantity])).toEqual([
      ['Processor', 'CPU-1', 2], ['Memory', 'MEM-1', 4], ['Smart Chassis', 'P72221-B21', 1],
      ['Smart Chassis', undefined, undefined], ['Power Supplies', 'PSU-1', 2],
    ]);
    expect(job.source.instructions.map((item) => item.selectionType)).toEqual([
      'quantity', 'quantity', 'quantity', 'configuration', 'quantity',
    ]);
  }
});

test('uses random component instructions when optional business cells are blank', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oca-flat-random-'));
  const file = path.join(directory, 'input.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    'Job ID': 'FLAT-2', 'Model Number': 'P72176-B21', Processor: '', Memory: '',
    'Smart Chassis Product': '', 'Power Supply': '', Service: '',
  }]), 'Models');
  XLSX.writeFile(workbook, file);

  const job = new ExcelReader().read(file)[0];
  expect(job.serviceType).toBe('Random');
  if (job.source.kind === 'detailed-excel') {
    expect(job.source.instructions.map((item) => item.selectionType)).toEqual(['random', 'random', 'random', 'random']);
  }
});

test('recognizes Solution and Solutions columns case-insensitively and defaults to normal model', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oca-flat-solutions-'));
  const file = path.join(directory, 'input.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { 'Job ID': 'SOLUTION-1', 'Model Number': 'S1J88A', Solutions: 'yEs' },
    { 'Job ID': 'SOLUTION-2', 'Model Number': 'S2V31C', Solution: 'Yes' },
    { 'Job ID': 'SOLUTION-3', 'Model Number': 'S2V31C', ' Solution ': 'YES' },
    { 'Job ID': 'SOLUTION-4', 'Model Number': 'S3V83A', Solution: 'Solution Wizard' },
    { 'Job ID': 'SOLUTION-5', 'Model Number': 'S3V83A', 'Product or Solution Description': 'Solution Wizard' },
    { 'Job ID': 'NORMAL-1', 'Model Number': 'P72176-B21', Solutions: 'No' },
    { 'Job ID': 'NORMAL-2', 'Model Number': 'P86963-B21', Solutions: '' },
  ]), 'Models');
  XLSX.writeFile(workbook, file);

  const jobs = new ExcelReader().read(file);
  expect(jobs.map((job) => job.isSolution)).toEqual([true, true, true, true, true, false, false]);
});

test('maps the optional Storage flag without changing normal rows', () => {
  const file = workbookAt([
    { 'Job ID': 'STORAGE-1', 'Model Number': 'S1R06A', Storage: 'Yes' },
    { 'Job ID': 'NORMAL-1', 'Model Number': 'P72176-B21', Storage: 'No' },
  ], []);
  const jobs = new ExcelReader().read(file);
  expect(jobs.map((job) => job.isStorage)).toEqual([true, false]);
});

test('rejects a row that enables both Solution and Storage flows', () => {
  const file = workbookAt([
    { 'Job ID': 'AMBIGUOUS-1', 'Model Number': 'S1R06A', Solution: 'Yes', Storage: 'Yes' },
  ], []);
  expect(() => new ExcelReader().read(file)).toThrow('Solution and Storage cannot both be Yes');
});
