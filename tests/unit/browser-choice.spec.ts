import { test, expect } from '@playwright/test';
import { browserArgs, browserOrder, isMissingBrowserError, profileFor } from '../../src/automation/browser-choice';

test('installed Edge and Chrome hide the unsupported command-line flag bar', () => {
  expect(browserArgs('msedge')).toContain('--test-type');
  expect(browserArgs('chrome')).toContain('--test-type');
  expect(browserArgs('chromium')).not.toContain('--test-type');
  for (const channel of ['msedge', 'chrome', 'chromium'] as const) {
    expect(browserArgs(channel)).toEqual(expect.arrayContaining(['--ignore-certificate-errors', '--disable-web-security']));
  }
});

test('tries Chrome, then Edge, then Playwright Chromium by default', () => {
  expect(browserOrder(undefined)).toEqual(['chrome', 'msedge', 'chromium']);
  expect(browserOrder('')).toEqual(['chrome', 'msedge', 'chromium']);
  expect(browserOrder(' Auto ')).toEqual(['chrome', 'msedge', 'chromium']);
});

test('OCA_BROWSER picks one browser', () => {
  expect(browserOrder('edge')).toEqual(['msedge']);
  expect(browserOrder('MSEDGE')).toEqual(['msedge']);
  expect(browserOrder('chrome')).toEqual(['chrome']);
  expect(browserOrder('chromium')).toEqual(['chromium']);
  expect(() => browserOrder('firefox')).toThrow(/auto, chrome, edge or chromium/);
});

test('only a browser that is not installed moves on to the next one', () => {
  expect(isMissingBrowserError(new Error(
    "browserType.launchPersistentContext: Chromium distribution 'msedge' is not found at C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\nRun \"npx playwright install msedge\"",
  ))).toBe(true);
  expect(isMissingBrowserError(new Error(
    "browserType.launchPersistentContext: Executable doesn't exist at C:\\Users\\a\\AppData\\Local\\ms-playwright\\chromium-1140\\chrome-win\\chrome.exe",
  ))).toBe(true);
  // A profile already open in another window is a real problem, not a missing browser.
  expect(isMissingBrowserError(new Error('browserType.launchPersistentContext: Target page, context or browser has been closed'))).toBe(false);
});

test('each browser keeps its own sign-in profile', () => {
  expect(profileFor('C:\\oca\\.oca-profile', 'chromium')).toBe('C:\\oca\\.oca-profile');
  expect(profileFor('C:\\oca\\.oca-profile', 'msedge')).toBe('C:\\oca\\.oca-profile-msedge');
  expect(profileFor('/data/profile/', 'chrome')).toBe('/data/profile-chrome');
});
