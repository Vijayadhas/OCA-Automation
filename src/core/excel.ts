import { type Page } from '@playwright/test';
import { waitForBlockingOverlay } from './waits';

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error).split('\n')[0];
}

const normalizePageText = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function extractBomUcid(text: string | null | undefined, labelText: string): string {
  const normalized = normalizePageText(text);
  const match = normalized.match(new RegExp(`${escapeRegex(labelText)}\\s*[:#-]?\\s*([A-Za-z0-9_-]+)`, 'i'));
  const candidate = match?.[1] ?? '';
  return candidate.toLowerCase() === labelText.split(/\s+/).at(-1)?.toLowerCase() ? '' : candidate;
}

export async function readBomUcid(page: Page, labelText: string) {
  await waitForBlockingOverlay(page);

  // Keep all parsing in Node. Functions declared inside page.evaluate are decorated by
  // tsx/esbuild with __name, which does not exist in Chromium's isolated page context.
  let value = extractBomUcid(await page.locator('body').textContent(), labelText);
  if (!value) {
    const labels = page.getByText(labelText, { exact: false }).filter({ visible: true });
    const labelCount = await labels.count();
    for (let index = 0; index < labelCount && !value; index += 1) {
      const label = labels.nth(index);
      value = extractBomUcid(await label.textContent().catch(() => ''), labelText);
      if (value) break;

      const row = label.locator('xpath=ancestor::tr[1]');
      if (await row.count()) {
        const cells = (await row.locator('td, th').allTextContents()).map(normalizePageText);
        const labelIndex = cells.findIndex((cell) => cell.toLowerCase().includes(labelText.toLowerCase()));
        value = cells.slice(labelIndex + 1).find((cell) => /^[A-Za-z0-9_-]{4,}$/.test(cell)) ?? '';
      }
      if (value) break;

      const siblings = label.locator('xpath=following-sibling::*');
      for (const siblingText of await siblings.allTextContents()) {
        const candidate = normalizePageText(siblingText);
        if (/^[A-Za-z0-9_-]{4,}$/.test(candidate)) {
          value = candidate;
          break;
        }
      }
    }
  }
  if (!value) {
    console.log(`[INFO] ${labelText} was not found on the End BOM page`);
  }
  return value;
}
