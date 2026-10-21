import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { countryFor, customerAccountFor, parseModelType, routeFromModelType, searchDescriptionFor } from '../../src/models/job';
import { buildInputTemplate, TEMPLATE_MODEL_COLUMNS } from '../../src/excel/input-template';
import { ExcelReader } from '../../src/excel/excel-reader';

test('Nutanix is a Model Type on the Server route', () => {
  expect(parseModelType(' nutanix ')).toBe('Nutanix');
  expect(routeFromModelType('Nutanix', { isSolution: true, isStorage: true })).toEqual({ modelType: 'Nutanix', isSolution: false, isStorage: false });
});

test('Nutanix models use the Nutanix account and search result; other models clear the account', () => {
  expect(customerAccountFor({ modelType: 'Nutanix' })).toBe('Nutanix');
  expect(searchDescriptionFor({ modelType: 'Nutanix' })).toBe('Nutanix');
  expect(customerAccountFor({ modelType: 'Server' })).toBe('');
  expect(searchDescriptionFor({ modelType: 'Server' })).toBeUndefined();
  // Excel values win.
  expect(customerAccountFor({ modelType: 'Server', customerAccount: ' Nvidia ' })).toBe('Nvidia');
  expect(searchDescriptionFor({ modelType: 'Nutanix', modelDescription: 'DL360 G12' })).toBe('DL360 G12');
});

// Arcus EMEA (2026-10-21 recording): the Arcus solution quoted in Saudi Arabia, opened from a search for "Private".
test('Arcus EMEA is a Solution preset with Saudi Arabia and the Arcus search result; Excel values win', () => {
  expect(parseModelType('arcus-emea')).toBe('Arcus EMEA');
  expect(routeFromModelType('Arcus EMEA', { isSolution: false, isStorage: true })).toEqual({ modelType: 'Arcus EMEA', isSolution: true, isStorage: false });
  expect(countryFor({ modelType: 'Arcus EMEA' })).toBe('SAUDI ARABIA');
  expect(searchDescriptionFor({ modelType: 'Arcus EMEA' })).toBe('HPE GreenLake for PC3000 with Alletra Storage MP (Block)');
  expect(customerAccountFor({ modelType: 'Arcus EMEA' })).toBe('');
  expect(countryFor({ modelType: 'Arcus EMEA', country: 'UAE' })).toBe('UAE');
  expect(countryFor({ modelType: 'Solution' })).toBeUndefined();
});

test('the input template has every dialog field and reads back as runnable jobs', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oca-template-')), 'template.xlsx');
  XLSX.writeFile(buildInputTemplate(), file);
  const workbook = XLSX.readFile(file);
  expect(workbook.SheetNames).toEqual(['Models', 'Components', 'Instructions']);
  expect(XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Models, { header: 1 })[0]).toEqual([...TEMPLATE_MODEL_COLUMNS, 'Notes']);

  const jobs = new ExcelReader().read(file);
  expect(jobs).toHaveLength(14);
  expect(new Set(jobs.map((job) => job.jobId)).size).toBe(14);
  const byId = (jobId: string) => jobs.find((job) => job.jobId === jobId)!;
  expect([byId('JOB-010').modelNumber, byId('JOB-010').modelType, byId('JOB-010').isSolution]).toEqual(['P72176-B21', 'Nutanix', false]);
  expect([byId('JOB-011').modelNumber, byId('JOB-011').isSolution]).toEqual(['S3V83A', true]);
  expect([byId('JOB-014').modelType, byId('JOB-014').isSolution, byId('JOB-014').country]).toEqual(['Arcus EMEA', true, undefined]);
  // Notes are for the team; they never become a search description (only JOB-013 has one in its own column).
  expect(jobs.filter((job) => job.modelDescription !== undefined).map((job) => job.jobId)).toEqual(['JOB-013']);
  const sections = (index: number) => {
    const source = jobs[index].source;
    return source.kind === 'detailed-excel' ? source.instructions.map((item) => item.section) : [];
  };
  // No Components rows: random Processor, Memory, Smart Chassis and Power Supplies, as in the dashboard.
  expect(sections(1)).toEqual(['Processor', 'Memory', 'Smart Chassis', 'Power Supplies']);
});

test('reads Customer Account from the Models sheet', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oca-account-')), 'models.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { 'Job ID': 'J1', 'Model Number': 'P72176-B21', 'Model Type': 'Server', 'Customer Account': 'Nvidia' },
  ]), 'Models');
  XLSX.writeFile(workbook, file);
  expect(new ExcelReader().read(file)[0].customerAccount).toBe('Nvidia');
});

test('reads Country from the Models sheet', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oca-country-')), 'models.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { 'Job ID': 'J1', 'Model Number': 'S3V83A', 'Model Type': 'Solution', Country: 'Saudi Arabia' },
    { 'Job ID': 'J2', 'Model Number': 'P72176-B21', 'Model Type': 'Server' },
  ]), 'Models');
  XLSX.writeFile(workbook, file);
  const jobs = new ExcelReader().read(file);
  expect(jobs.map((job) => job.country)).toEqual(['Saudi Arabia', undefined]);
});
