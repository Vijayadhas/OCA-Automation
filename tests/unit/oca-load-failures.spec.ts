import { test, expect, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { run } from '../../src/main';
import { BrowserSession } from '../../src/automation/browser-session';
import { OcaEngine } from '../../src/automation/oca-engine';
import { ComponentEngine } from '../../src/automation/component-engine';
import { OcaPageLoadError } from '../../src/automation/configuration-errors';
import { ocaProblemMessage, firstErrorLine } from '../../src/core/oca-problem';
import { codeVersion, zipVersion } from '../../src/core/code-version';
import { ExcelWriter } from '../../src/excel/excel-writer';
import { createPendingResult } from '../../src/models/automation-result';
import { menuSection } from './oca-menu-fixture';

// OCA's error dialog as captured on P72176-B21 (DL360 Gen12), when the Menu tab failed to load.
const problemDialog = `<div tabindex="-1" role="dialog" class="ui-dialog dqe-mode ui-widget ui-widget-content ui-front dialog_shadow ui-dialog-buttons">
  <div class="ui-dialog-titlebar"><span id="ui-id-31" class="ui-dialog-title">(OCA) has encountered a problem</span></div>
  <div class="dialog_div ui-dialog-content"><div class="error_message_div">
    <h3 id="error_general_message">Please log a support case for this issue</h3>
    <div id="error_detail_message_main"><span><h3 class="Error_info">UCID: TempUCID</h3></span>
      <div id="error_detail_message" readonly="readonly">java.lang.NoSuchMethodException: Widget does not exist on current page: extended_overview:menu
        com.hp.ngc.uiframework.Window.callJsonMethod(Window.java:659) com.hp.ngc.uiframework.Window.getJsonDocFn(Window.java:234)</div>
    </div></div></div></div>`;
const emptyMenu = '<div id="extended_overview_menu" tabid="menu" role="tabpanel"></div>';

test('reads the exception line from OCA\'s error dialog', async ({ page }) => {
  await page.setContent(emptyMenu + problemDialog);
  expect(await ocaProblemMessage(page)).toBe('java.lang.NoSuchMethodException: Widget does not exist on current page: extended_overview:menu');
  await page.setContent(emptyMenu);
  expect(await ocaProblemMessage(page)).toBe('');
  expect(firstErrorLine('Plain message without frames')).toBe('Plain message without frames');
});

test('fails when the Menu tab has no sections, quoting OCA\'s error', async ({ page }) => {
  await page.setContent(emptyMenu + problemDialog);
  const error = await new ComponentEngine(page).ensureMenuLoaded(500).catch((caught: Error) => caught);
  expect(error).toBeInstanceOf(OcaPageLoadError);
  expect(String(error)).toContain('Menu tab has no component sections');
  expect(String(error)).toContain('OCA error: java.lang.NoSuchMethodException: Widget does not exist on current page: extended_overview:menu');
});

test('accepts a Menu tab with sections', async ({ page }) => {
  await page.setContent(menuSection({ key: 'cpu', title: 'Processor', choices: [{ id: 'cpu_main', title: 'Processor', rows: [] }] }));
  await new ComponentEngine(page).ensureMenuLoaded(500);
});

test('opens OCA again when it fails to load, when automatic retries are on', async () => {
  process.env.OCA_MODEL_ATTEMPTS = '3';
  const directory = test.info().outputPath('load-retry');
  fs.mkdirSync(directory, { recursive: true });
  const input = path.join(directory, 'models.xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ 'Job ID': 'JOB-001', 'Model Number': 'P72176-B21' }]), 'Models');
  XLSX.writeFile(book, input);
  const originalStart = BrowserSession.prototype.start;
  const originalProcess = OcaEngine.prototype.processJob;
  let attempts = 0;
  BrowserSession.prototype.start = async () => ({} as BrowserContext);
  OcaEngine.prototype.processJob = async (job, retryCount) => {
    attempts += 1;
    if (attempts < 2) throw new OcaPageLoadError('OCA\'s Menu tab has no component sections; the configuration did not load');
    const result = createPendingResult(job.jobId, job.modelNumber, retryCount);
    result.executionStatus = 'Success';
    return result;
  };
  try {
    expect(await run(['--input', input, '--output', directory])).toBe(0);
  } finally {
    BrowserSession.prototype.start = originalStart;
    OcaEngine.prototype.processJob = originalProcess;
    delete process.env.OCA_MODEL_ATTEMPTS;
  }
  expect(attempts).toBe(2);
  expect(new ExcelWriter(directory, input).getExisting('JOB-001')?.executionStatus).toBe('Success');
});

test('reports which code a run used', () => {
  expect(codeVersion()).toMatch(/^(commit [0-9a-f]{7,} \d{4}-\d{2}-\d{2} \d{2}:\d{2}( \(GitHub zip\))?|no Git; newest source file .+ modified \d{4}-\d{2}-\d{2} \d{2}:\d{2})$/);
});

test('reads the commit GitHub stamps into VERSION in a zip download', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oca-version-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'main.ts'), '');
    fs.writeFileSync(path.join(root, 'VERSION'), 'c68b71d 2026-10-28 20:37:01 +0530\n');
    expect(zipVersion(root)).toBe('c68b71d 2026-10-28 20:37');
    expect(codeVersion(root)).toBe('commit c68b71d 2026-10-28 20:37 (GitHub zip)');
    // The Windows package build marks its VERSION.
    fs.writeFileSync(path.join(root, 'VERSION'), 'c68b71d 2026-10-28 20:37:01 +0530 package\n');
    expect(codeVersion(root)).toBe('commit c68b71d 2026-10-28 20:37 (Windows package)');
    // In a clone the placeholder is not filled in, so VERSION is ignored.
    fs.writeFileSync(path.join(root, 'VERSION'), '$Format:%h %ci$\n');
    expect(zipVersion(root)).toBeNull();
    expect(codeVersion(root)).not.toContain('GitHub zip');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
