import fs from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';

/** off: never; failure: when a job fails (default); steps: after every engine step and on failure. */
export type HtmlCaptureMode = 'off' | 'failure' | 'steps';

const safeName = (value: string) => value.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
const FRAME_TIMEOUT_MS = 15_000;

/**
 * Serializes the live DOM for offline selector work. Runs in the browser.
 * A plain outerHTML loses state that Playwright locators depend on, so the copy
 * records typed values, checked/selected state, and marks elements that are not
 * rendered with data-oca-hidden="true" (their descendants are hidden as well).
 * Script bodies are removed; password values are masked.
 */
export function serializeDom(): string {
  const source = document.documentElement;
  const copy = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...Array.from(source.querySelectorAll('*'))];
  const copies = [copy, ...Array.from(copy.querySelectorAll('*'))];
  const hidden = new WeakSet<Element>();
  for (let index = 0; index < originals.length; index += 1) {
    const original = originals[index];
    const clone = copies[index];
    if (!clone) break;
    if (original instanceof HTMLInputElement) {
      if (original.type === 'checkbox' || original.type === 'radio') {
        if (original.checked) clone.setAttribute('checked', ''); else clone.removeAttribute('checked');
      } else if (original.type === 'password') {
        clone.setAttribute('value', '***');
      } else {
        clone.setAttribute('value', original.value);
      }
      if (original.disabled) clone.setAttribute('disabled', '');
    } else if (original instanceof HTMLTextAreaElement) {
      clone.textContent = original.value;
    } else if (original instanceof HTMLOptionElement) {
      if (original.selected) clone.setAttribute('selected', ''); else clone.removeAttribute('selected');
    } else if (original instanceof HTMLScriptElement) {
      clone.textContent = '';
    }
    if (!document.body?.contains(original) || original === document.body) continue;
    const parent = original.parentElement;
    if (parent && hidden.has(parent)) { hidden.add(original); continue; }
    const notRendered = original.getClientRects().length === 0;
    const invisible = !notRendered && getComputedStyle(original).visibility === 'hidden';
    if (notRendered || invisible) {
      clone.setAttribute('data-oca-hidden', 'true');
      // display:none hides every descendant; visibility:hidden can be overridden by a child.
      if (notRendered) hidden.add(original);
    }
  }
  return `<!DOCTYPE html>\n${copy.outerHTML}`;
}

const withTimeout = <T>(work: Promise<T>, milliseconds: number): Promise<T | undefined> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), milliseconds); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

export class HtmlCapture {
  private jobId = 'job';
  private sequence = 0;

  constructor(private readonly outputDirectory: string, readonly mode: HtmlCaptureMode = 'failure') {}

  startJob(jobId: string): void {
    this.jobId = safeName(jobId) || 'job';
    this.sequence = 0;
  }

  /** Captures after a successful engine step when every step is being recorded. */
  async step(page: Page | undefined, label: string): Promise<string> {
    return this.mode === 'steps' ? this.capture(page, label) : '';
  }

  /** Captures the page as it was when a job failed. */
  async failure(page: Page | undefined, label: string): Promise<string> {
    return this.mode === 'off' ? '' : this.capture(page, `FAILED-${label}`);
  }

  private async capture(page: Page | undefined, label: string): Promise<string> {
    if (!page || page.isClosed()) return '';
    try {
      const directory = path.join(this.outputDirectory, 'html', this.jobId);
      fs.mkdirSync(directory, { recursive: true });
      this.sequence += 1;
      const base = `${String(this.sequence).padStart(2, '0')}-${safeName(label) || 'page'}`;
      let mainFile = '';
      for (const [index, frame] of page.frames().entries()) {
        // An open alert or a hung page would block evaluate forever.
        const html = await withTimeout(frame.evaluate(serializeDom).catch(() => undefined), FRAME_TIMEOUT_MS);
        if (!html) continue;
        const file = path.join(directory, index === 0 ? `${base}.html` : `${base}.frame${index}.html`);
        fs.writeFileSync(file, `${this.header(frame, label)}\n${html}`, 'utf8');
        if (index === 0) mainFile = file;
      }
      if (mainFile) console.log(`[HTML] ${label}: ${mainFile}`);
      return mainFile;
    } catch (error) {
      console.log(`[WARN] HTML capture failed for ${label}: ${String(error).split('\n')[0]}`);
      return '';
    }
  }

  private header(frame: Frame, label: string): string {
    const clean = (value: string) => value.replace(/--/g, '- -');
    return `<!-- OCA capture | job: ${clean(this.jobId)} | step: ${clean(label)} | frame: ${clean(frame.name() || '(main)')}`
      + ` | url: ${clean(frame.url())} | captured: ${new Date().toISOString()} -->`;
  }
}
