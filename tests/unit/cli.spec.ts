import { test, expect } from '@playwright/test';
import { parseCliArgs } from '../../src/app/cli';

test('parses CLI filters and trace options', () => {
  const options = parseCliArgs([
    '--input', './input.xlsx', '--output', './out', '--start-row', '3', '--job-id', 'J-2',
    '--retry-failed', '--trace', '--headed',
  ]);
  expect(options.startRow).toBe(3);
  expect(options.jobId).toBe('J-2');
  expect(options.retryFailed).toBe(true);
  expect(options.trace).toBe(true);
  expect(options.headed).toBe(true);
  expect(options.captureHtml).toBe(false);
  expect(parseCliArgs(['--input', './input.xlsx', '--capture-html']).captureHtml).toBe(true);
});
