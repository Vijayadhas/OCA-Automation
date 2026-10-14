import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { installOcaShim } from '../core/shim';

export interface BrowserSessionOptions {
  profilePath: string;
  headed: boolean;
  trace: boolean;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
}

export class BrowserSession {
  private context?: BrowserContext;
  private closing = false;

  constructor(
    private readonly options: BrowserSessionOptions,
    private readonly report: (message: string) => void = console.log,
  ) {}

  async start(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.closing = false;
    this.context = await chromium.launchPersistentContext(path.resolve(this.options.profilePath), {
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
