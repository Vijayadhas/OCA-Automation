import type { Locator, Page } from '@playwright/test';
import type { ComponentEngine } from './component-engine';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';

/** OCA still flags configuration errors that recovery could not resolve (often a rule triggered by a random pick). */
export class ConfigurationRuleError extends Error {
  constructor(message: string) { super(message); this.name = 'ConfigurationRuleError'; }
}

/**
 * OCA did not load a page it should have (landing page stuck on "Loading...", or a Menu tab
 * with no sections after a server error). Opening OCA again usually works, so it is retried.
 */
export class OcaPageLoadError extends Error {
  constructor(message: string) { super(message); this.name = 'OcaPageLoadError'; }
}

/** Options for resolveConfigurationErrors. */
export interface ResolveOptions {
  /**
   * Only these Menu sections are repaired and block Services (Processor and Memory on servers).
   * Error icons elsewhere are logged and left to OCA. Omitted: every error icon is repaired.
   */
  mandatorySections?: readonly string[];
}

const sectionPattern = (name: string) => new RegExp(`^${escapeRegex(name)}\\b`, 'i');

/** Name of the Menu section an error icon belongs to, or '' outside the Menu sections. */
async function sectionNameOf(icon: Locator): Promise<string> {
  let header = icon.locator('xpath=ancestor::*[contains(@id,"section_header") or contains(concat(" ", normalize-space(@class), " "), " section_header ")][1]');
  // A choice's own status icon (visible once its section is open) belongs to the section header above it.
  if (!await header.count()) {
    header = icon.locator('xpath=ancestor::tr[contains(concat(" ", normalize-space(@class), " "), " choice_header ")][1]'
      + '/preceding::*[starts-with(@id, "section_header_")][1]');
  }
  if (!await header.count()) return '';
  return header.first().evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('i, [title="Error" i], [aria-label="Error" i], .dqe-status-icon-14, .section_counter, .section_toggle').forEach((node) => node.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

export async function resolveConfigurationErrors(
  page: Page,
  components: Pick<ComponentEngine, 'satisfyRequiredSection' | 'satisfyVisibleRequiredControl'>,
  options: ResolveOptions = {},
): Promise<void> {
  const errorIcons = page.locator([
    '[title="Error" i]',
    '[aria-label="Error" i]',
    // OCA puts dqe-status-icon-14 on every status icon; only img-alert is an error
    // (img-warning and img-info are advisory and must not block Services).
    '.img-alert.dqe-status-icon-14',
  ].join(', ')).filter({ visible: true });
  const mandatory = options.mandatorySections?.map(sectionPattern);
  const isMandatory = (name: string) => !mandatory || mandatory.some((pattern) => pattern.test(name));
  /** The first error icon to repair and its section; null when none is left to repair. */
  const nextError = async (): Promise<{ sectionName: string } | null> => {
    const count = await errorIcons.count();
    if (!mandatory) return count ? { sectionName: await sectionNameOf(errorIcons.first()) } : null;
    const ignored = new Set<string>();
    for (let index = 0; index < count; index += 1) {
      const icon = errorIcons.nth(index);
      const sectionName = await sectionNameOf(icon);
      if (sectionName && isMandatory(sectionName)) return { sectionName };
      ignored.add(sectionName || 'outside the Menu sections');
    }
    if (ignored.size) {
      console.log(`[WARN] OCA error icons left as they are (only ${options.mandatorySections!.join(', ')} are mandatory): ${[...ignored].join('; ')}`);
    }
    return null;
  };

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await waitForBlockingOverlay(page);
    const next = await nextError();
    if (!next) {
      console.log(mandatory
        ? `[STEP] Configuration validation passed: no error icons remain in ${options.mandatorySections!.join(', ')}`
        : '[STEP] Configuration validation passed: no error icons remain');
      return;
    }
    if (next.sectionName) {
      console.log(`[WARN] Required selection is missing in ${next.sectionName}; resolving it before Services`);
      await components.satisfyRequiredSection(next.sectionName);
    } else {
      console.log('[WARN] Required selection is missing outside a Menu section; resolving the visible control');
      if (!await components.satisfyVisibleRequiredControl()) break;
    }
  }

  await waitForBlockingOverlay(page);
  const remaining = await nextError();
  if (!remaining) return;
  const unresolved = mandatory ? [remaining.sectionName] : await errorIcons.evaluateAll((icons) => [...new Set(icons.map((icon) => {
    const header = icon.closest<HTMLElement>('[id*="section_header"], .section_header');
    if (!header) return icon.getAttribute('title') || 'Unknown section';
    const copy = header.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('i, .section_counter, .section_toggle').forEach((node) => node.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim() || 'Unknown section';
  }))]);
  // A rule that spans sections (for example CPU power + heatsink + OCP card) is not fixed
  // by re-selecting one section; OCA's own error text says what it needs.
  const messages = await page.locator('.choice_messages.error_bgd .error_message').evaluateAll((nodes) => [...new Set(nodes
    .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 5)
    .map((text) => (text.length > 400 ? `${text.slice(0, 400)}…` : text)));
  throw new ConfigurationRuleError(`Cannot continue to Services while OCA error icons remain: ${unresolved.join('; ')}`
    + (messages.length ? `. OCA messages: ${messages.join(' || ')}` : ''));
}

