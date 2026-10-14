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

/**
 * Closes OCA's modal message dialogs and returns their text. On DL320 Gen12 (P75218-B21) a "Message"
 * dialog ("PCI Card Placement: Unable to calculate proper PCI Card placements during placement of
 * P26259-B21") and "(OCA) has encountered a problem" stayed open over the Menu, and every later
 * click failed. Message dialogs close with their OK button; the problem dialog with its title-bar
 * close button. Other dialogs (Save, End BOM) are left alone.
 */
export async function dismissOcaMessageDialogs(page: Page): Promise<string[]> {
  const closed: string[] = [];
  for (let round = 0; round < 5; round += 1) {
    const dialog = page.locator('.ui-dialog[role="dialog"]')
      .filter({ has: page.locator('.ui-dialog-title', { hasText: /^\s*Message\s*$|has encountered a problem/i }) })
      .filter({ visible: true }).first();
    if (!await dialog.isVisible().catch(() => false)) break;
    const title = ((await dialog.locator('.ui-dialog-title').first().textContent().catch(() => '')) ?? '').trim();
    const message = /has encountered a problem/i.test(title)
      ? `${title}: ${await ocaProblemMessage(page)}`
      : ((await dialog.locator('.ui-dialog-content').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
    const ok = dialog.locator('.ui-dialog-buttonset button').filter({ visible: true }).first();
    const button = /has encountered a problem/i.test(title) || !await ok.isVisible().catch(() => false)
      ? dialog.locator('.ui-dialog-titlebar-close').first() : ok;
    await button.click({ timeout: 5_000 }).catch(() => undefined);
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
    console.log(`[WARN] Closed OCA dialog: ${message}`);
    closed.push(message);
  }
  return closed;
}

/** The exception line of a Java stack trace, without the "com.hp...(Window.java:659)" frames. */
export function firstErrorLine(trace: string): string {
  const text = trace.replace(/\s+/g, ' ').trim();
  const frame = text.search(/\s(?:com|java|javax|jakarta|weblogic|org|sun)\.[\w.$]+\([\w.]*(?::\d+)?\)/);
  const line = frame > 0 ? text.slice(0, frame) : text;
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}
