import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { installOcaShim } from '../core/shim';
import { BROWSER_NAMES, browserOrder, isMissingBrowserError, profileFor, type BrowserChannel } from './browser-choice';

export interface BrowserSessionOptions {
  profilePath: string;
  headed: boolean;
  trace: boolean;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
  /** auto (default: Edge, then Chrome, then Playwright Chromium), edge, chrome or chromium; else OCA_BROWSER. */
  browser?: string;
}

export class BrowserSession {
  private context?: BrowserContext;
  private closing = false;
  /** The browser that launched; a restart after a crash uses the same one. */
  private channel?: BrowserChannel;

  constructor(
    private readonly options: BrowserSessionOptions,
    private readonly report: (message: string) => void = console.log,
  ) {}

  /** The browser in use, once started (e.g. "Microsoft Edge"). */
  get browserName(): string | undefined {
    return this.channel ? BROWSER_NAMES[this.channel] : undefined;
  }

  private launch(channel: BrowserChannel): Promise<BrowserContext> {
    return chromium.launchPersistentContext(path.resolve(profileFor(this.options.profilePath, channel)), {
      ...(channel === 'chromium' ? {} : { channel }),
      // The runner owns these signals and finishes the active job before cleanup.
      handleSIGINT: false,
      handleSIGTERM: false,
      headless: !this.options.headed,
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
      args: [
        '--ignore-certificate-errors', '--allow-running-insecure-content', '--disable-web-security',
        '--disable-notifications', '--no-first-run', '--no-default-browser-check',
      ],
    });
  }

  /** Launches the first installed browser of the configured order; a missing one moves to the next. */
  private async launchFirstInstalled(): Promise<BrowserContext> {
    const order = this.channel ? [this.channel] : browserOrder(this.options.browser ?? process.env.OCA_BROWSER);
    const missing: string[] = [];
    for (const channel of order) {
      try {
        const context = await this.launch(channel);
        if (this.channel !== channel) {
          this.report(`[INFO] Browser: ${BROWSER_NAMES[channel]} (profile ${path.resolve(profileFor(this.options.profilePath, channel))})`);
        }
        this.channel = channel;
        return context;
      } catch (error) {
        if (!isMissingBrowserError(error)) throw error;
        missing.push(BROWSER_NAMES[channel]);
        const next = order[order.indexOf(channel) + 1];
        if (next) this.report(`[WARN] ${BROWSER_NAMES[channel]} is not installed on this computer; trying ${BROWSER_NAMES[next]}`);
      }
    }
    throw new Error(`No supported browser is installed (${missing.join(', ')} not found). Install Microsoft Edge or Google Chrome.`);
  }

  async start(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.closing = false;
    this.context = await this.launchFirstInstalled();
    this.context.setDefaultTimeout(this.options.actionTimeoutMs);
    this.context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
    const context = this.context;
    context.on('close', () => {
      this.report(`[${this.closing ? 'INFO' : 'ERROR'}] Browser context closed (${this.closing ? 'runner cleanup' : 'unexpected'})`);
      // A closed or crashed browser is launched again by the next start().
      if (this.context === context) this.context = undefined;
    });
    const observePage = (page: Page) => {
      page.on('crash', () => this.report('[ERROR] Browser page crashed'));
      page.on('close', () => this.report(`[INFO] Browser page closed (${this.closing ? 'runner cleanup' : 'outside runner cleanup'})`));
    };
    for (const page of this.context.pages()) {
      observePage(page);
      await installOcaShim(page);
    }
    this.context.on('page', (page) => {
      observePage(page);
      void installOcaShim(page).catch((error: unknown) => this.report(`[WARN] Page initialization failed: ${String(error)}`));
    });
    return this.context;
  }

  async page(): Promise<Page> {
    const context = await this.start();
    return context.pages()[0] ?? context.newPage();
  }

  async beginTrace(title: string): Promise<void> {
    if (!this.options.trace) return;
    const context = await this.start();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true, title });
  }

  async endTrace(tracePath?: string): Promise<void> {
    if (!this.options.trace) return;
    const context = await this.start();
    await context.tracing.stop(tracePath ? { path: tracePath } : undefined).catch(() => undefined);
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
  }
}
