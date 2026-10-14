import { expect, type Locator, type Page } from '@playwright/test';
import { waitForBlockingOverlay } from '../core/waits';
import { revealForViewer } from '../core/interactions';
import { MandatorySelectionError } from '../core/errors';

export interface SupportServiceSelection {
  serviceExperience: string;
  term: string;
  dataPrivacy: string;
}

export const ALLOWED_SERVICE_EXPERIENCE_VALUES = ['MBYS', 'Entry', 'Standard', 'Custom'] as const;

export class SupportServices {
  constructor(private readonly page: Page) {}

  async select(preferredExperience?: string): Promise<SupportServiceSelection> {
    console.log('[STEP] Opening Services tab');
    const services = this.page.getByRole('link', { name: 'Services', exact: true }).filter({ visible: true }).first();
    await expect(services).toBeVisible({ timeout: 60_000 });
    await services.click({ force: true });
    await waitForBlockingOverlay(this.page);

    const support = this.page.locator('#experience-and-term').filter({ visible: true }).first();
    await expect(support.getByText('Support Services', { exact: true })).toBeVisible({ timeout: 60_000 });

    const requestedExperience = preferredExperience && !/^(random|default)$/i.test(preferredExperience)
      ? preferredExperience.trim()
      : undefined;
    const serviceExperience = await this.selectEnabledOption(
      support.locator('#service-experience'),
      'Service experience',
      (value) => (ALLOWED_SERVICE_EXPERIENCE_VALUES as readonly string[]).includes(value),
      requestedExperience,
    );
    await waitForBlockingOverlay(this.page);

    const term = await this.selectEnabledOption(support.locator('#term'), 'Term');
    await waitForBlockingOverlay(this.page);

    const dataPrivacy = await this.selectEnabledOption(
      support.locator('#data-privacy-service'),
      'Data Privacy',
    );
    await waitForBlockingOverlay(this.page);

    // Support Services are mandatory: a later choice can make OCA clear an earlier one, so all
    // three must still be selected before the configuration is saved.
    for (const [id, label] of [['service-experience', 'Service experience'], ['term', 'Term'], ['data-privacy-service', 'Data Privacy']]) {
      if (!await support.locator(`#${id} input[type="radio"]:checked`).count()) {
        throw new MandatorySelectionError(`Support Services are mandatory, but ${label} is not selected; the configuration was not saved`);
      }
    }
    return { serviceExperience, term, dataPrivacy };
  }

  private async selectEnabledOption(
    group: Locator,
    label: string,
    accepts: (value: string) => boolean = () => true,
    preferred?: string,
  ): Promise<string> {
    await expect(group, `${label} selection group`).toBeVisible({ timeout: 60_000 });
    const wrappers = group.locator('.option-wrapper').filter({ visible: true });
    const candidates: Array<{ input: Locator; optionLabel: Locator; value: string; text: string }> = [];

    await expect.poll(async () => {
      candidates.length = 0;
      const count = await wrappers.count();
      for (let index = 0; index < count; index += 1) {
        const wrapper = wrappers.nth(index);
        const input = wrapper.locator('input[type="radio"]:not([disabled])').first();
        if (!(await input.count())) continue;
        const value = (await input.getAttribute('value') ?? '').trim();
        if (!value || !accepts(value)) continue;
        const optionLabel = wrapper.locator('label.option-label').first();
        const text = ((await optionLabel.innerText().catch(() => value)) || value).replace(/\s+/g, ' ').trim();
        candidates.push({ input, optionLabel, value, text });
      }
      return candidates.length;
    }, { timeout: 60_000, message: `Enabled ${label} options after service recalculation` }).toBeGreaterThan(0);

    const selected = preferred
      ? candidates.find((candidate) => candidate.value.toLowerCase() === preferred.toLowerCase()
        || candidate.text.toLowerCase() === preferred.toLowerCase())
      : candidates[Math.floor(Math.random() * candidates.length)];
    if (!selected) throw new Error(`${label} value from Excel is unavailable: ${preferred}`);
    console.log(`[STEP] ${preferred ? 'Excel' : 'Random'} ${label} selected: ${selected.text}`);
    await revealForViewer(selected.optionLabel);
    if (await selected.optionLabel.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await selected.optionLabel.click({ force: true });
    } else {
      await selected.input.check({ force: true });
    }
    await expect(selected.input).toBeChecked({ timeout: 30_000 });
    return selected.text;
  }
}
