/**
 * Which installed browser the automation drives. Google Chrome is tried first: on the team's
 * company-managed laptops, OCA loads in Chrome but kept loading in a managed Microsoft Edge
 * (tester, 2026-11-02). Edge is the fallback, and Playwright's own Chromium (downloaded with
 * `npx playwright install chromium`) the last resort. OCA_BROWSER picks one browser instead:
 * `chrome`, `edge` or `chromium` (`auto`, the default, tries them in that order).
 */
export type BrowserChannel = 'msedge' | 'chrome' | 'chromium';

export const BROWSER_NAMES: Record<BrowserChannel, string> = {
  msedge: 'Microsoft Edge',
  chrome: 'Google Chrome',
  chromium: 'Playwright Chromium',
};

const AUTO_ORDER: BrowserChannel[] = ['chrome', 'msedge', 'chromium'];

const ALIASES: Record<string, BrowserChannel[]> = {
  '': AUTO_ORDER,
  auto: AUTO_ORDER,
  edge: ['msedge'],
  msedge: ['msedge'],
  chrome: ['chrome'],
  chromium: ['chromium'],
};

/** The browsers to try, in order, for an OCA_BROWSER setting. */
export function browserOrder(setting: string | undefined = process.env.OCA_BROWSER): BrowserChannel[] {
  const key = (setting ?? '').trim().toLowerCase();
  const order = ALIASES[key];
  if (!order) throw new Error(`OCA_BROWSER "${setting}" is not supported; use auto, chrome, edge or chromium`);
  return [...order];
}

/** True when Playwright could not launch a browser because it is not installed on this computer. */
export function isMissingBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /distribution '[^']+' is not found|Executable doesn't exist|is not installed/i.test(message);
}

/**
 * Command-line switches for the browser. Installed Edge and Chrome show a yellow "You're using an
 * unsupported command-line flag: --no-sandbox" bar (Playwright always passes --no-sandbox, and the
 * switches below are flagged too); --test-type is the switch automation tools use to hide that bar.
 * Playwright Chromium never shows it.
 */
export function browserArgs(channel: BrowserChannel): string[] {
  return [
    '--ignore-certificate-errors', '--allow-running-insecure-content', '--disable-web-security',
    '--disable-notifications', '--no-first-run', '--no-default-browser-check',
    ...(channel === 'chromium' ? [] : ['--test-type']),
  ];
}

/**
 * Each browser keeps its own sign-in profile: a profile written by one browser is not safe to open
 * in another. Playwright Chromium keeps the folder given (so existing sign-ins carry on); Edge and
 * Chrome use a sibling folder named after the browser.
 */
export function profileFor(basePath: string, channel: BrowserChannel): string {
  if (channel === 'chromium') return basePath;
  return `${basePath.replace(/[\\/]+$/, '')}-${channel}`;
}
