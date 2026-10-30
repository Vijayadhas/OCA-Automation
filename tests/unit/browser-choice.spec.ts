import { test, expect } from '@playwright/test';
import { browserOrder, isMissingBrowserError, profileFor } from '../../src/automation/browser-choice';

test('tries Edge, then Chrome, then Playwright Chromium by default', () => {
  expect(browserOrder(undefined)).toEqual(['msedge', 'chrome', 'chromium']);
  expect(browserOrder('')).toEqual(['msedge', 'chrome', 'chromium']);
  expect(browserOrder(' Auto ')).toEqual(['msedge', 'chrome', 'chromium']);
});

test('OCA_BROWSER picks one browser', () => {
  expect(browserOrder('edge')).toEqual(['msedge']);
  expect(browserOrder('MSEDGE')).toEqual(['msedge']);
  expect(browserOrder('chrome')).toEqual(['chrome']);
  expect(browserOrder('chromium')).toEqual(['chromium']);
  expect(() => browserOrder('firefox')).toThrow(/auto, edge, chrome or chromium/);
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
