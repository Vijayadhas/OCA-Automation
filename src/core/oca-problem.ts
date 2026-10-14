import type { Page } from '@playwright/test';

/**
 * The message of OCA's own error dialog, when one is open: a jQuery UI dialog titled
 * "(OCA) has encountered a problem" whose #error_detail_message holds a Java stack trace, e.g.
 * "java.lang.NoSuchMethodException: Widget does not exist on current page: extended_overview:menu"
 * (P72176-B21, when the Menu tab failed to load). Returns '' when no such dialog is visible.
 */
export async function ocaProblemMessage(page: Page): Promise<string> {
  const dialog = page.locator('.ui-dialog')
    .filter({ has: page.locator('.ui-dialog-title', { hasText: /has encountered a problem/i }) })
    .filter({ visible: true }).first();
  if (!await dialog.isVisible().catch(() => false)) return '';
  const detail = await dialog.locator('#error_detail_message').first().textContent({ timeout: 2_000 }).catch(() => '') ?? '';
  return firstErrorLine(detail) || 'OCA has encountered a problem';
}

/** The exception line of a Java stack trace, without the "com.hp...(Window.java:659)" frames. */
export function firstErrorLine(trace: string): string {
  const text = trace.replace(/\s+/g, ' ').trim();
  const frame = text.search(/\s(?:com|java|javax|jakarta|weblogic|org|sun)\.[\w.$]+\([\w.]*(?::\d+)?\)/);
  const line = frame > 0 ? text.slice(0, frame) : text;
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}
