/**
 * Which installed browser the automation drives. Office laptops always have Microsoft Edge, so it is
 * tried first; Google Chrome is the fallback, and Playwright's own Chromium (downloaded with
 * `npx playwright install chromium`) is the last resort. OCA_BROWSER picks one browser instead:
 * `edge`, `chrome` or `chromium` (`auto`, the default, tries them in that order).
 */
export type BrowserChannel = 'msedge' | 'chrome' | 'chromium';

export const BROWSER_NAMES: Record<BrowserChannel, string> = {
  msedge: 'Microsoft Edge',
  chrome: 'Google Chrome',
  chromium: 'Playwright Chromium',
};

const AUTO_ORDER: BrowserChannel[] = ['msedge', 'chrome', 'chromium'];

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
  if (!order) throw new Error(`OCA_BROWSER "${setting}" is not supported; use auto, edge, chrome or chromium`);
  return [...order];
}

/** True when Playwright could not launch a browser because it is not installed on this computer. */
export function isMissingBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /distribution '[^']+' is not found|Executable doesn't exist|is not installed/i.test(message);
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
