import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { HtmlCapture } from '../../src/reporting/html-capture';

const outputDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oca-html-'));

test('captures live control state and marks hidden elements', async ({ page }) => {
  await page.setContent(`
    <input id="qty" value="1"><input id="secret" type="password">
    <input id="ack" type="checkbox"><select id="term"><option>12</option><option>36</option></select>
    <div id="collapsed" style="display:none"><span id="inside">Hidden row</span></div>
    <div id="ghost" style="visibility:hidden">Ghost</div><div id="shown">Shown</div>
    <script>window.token = 'do-not-save';</script>`);
  await page.fill('#qty', '2');
  await page.fill('#secret', 'pa55');
  await page.check('#ack');
  await page.selectOption('#term', '36');

  const capture = new HtmlCapture(outputDirectory(), 'failure');
  capture.startJob('JOB 1/A');
  const file = await capture.failure(page, 'Select Support Services');
  expect(path.basename(file)).toBe('01-FAILED-Select_Support_Services.html');
  expect(path.basename(path.dirname(file))).toBe('JOB_1_A');

  const html = fs.readFileSync(file, 'utf8');
  expect(html).toContain('<!-- OCA capture | job: JOB_1_A | step: FAILED-Select Support Services');
  expect(html).toMatch(/id="qty"[^>]*value="2"/);
  expect(html).toMatch(/id="secret"[^>]*value="\*\*\*"/);
  expect(html).not.toContain('pa55');
  expect(html).toMatch(/id="ack"[^>]*checked=""/);
  expect(html).toMatch(/<option selected="">36<\/option>/);
  expect(html).toMatch(/id="collapsed"[^>]*data-oca-hidden="true"/);
  expect(html).not.toMatch(/id="inside"[^>]*data-oca-hidden/);
  expect(html).toMatch(/id="ghost"[^>]*data-oca-hidden="true"/);
  expect(html).not.toMatch(/id="shown"[^>]*data-oca-hidden/);
  expect(html).not.toContain('do-not-save');
});

test('saves iframes and respects the capture mode', async ({ page }) => {
  await page.setContent('<h1>Main</h1><iframe srcdoc="<button>Frame OK</button>"></iframe>');
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'Frame OK' })).toBeVisible();

  const directory = outputDirectory();
  const failureOnly = new HtmlCapture(directory, 'failure');
  failureOnly.startJob('J-1');
  expect(await failureOnly.step(page, 'Open OCA')).toBe('');

  const steps = new HtmlCapture(directory, 'steps');
  steps.startJob('J-1');
  const file = await steps.step(page, 'Open OCA');
  expect(fs.readFileSync(file, 'utf8')).toContain('<h1>Main</h1>');
  expect(fs.readFileSync(file.replace(/\.html$/, '.frame1.html'), 'utf8')).toContain('Frame OK');
  expect(path.basename(await steps.step(page, 'Search model'))).toBe('02-Search_model.html');

  const off = new HtmlCapture(directory, 'off');
  expect(await off.failure(page, 'Open OCA')).toBe('');
});
