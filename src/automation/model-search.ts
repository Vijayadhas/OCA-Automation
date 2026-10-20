import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { ModelNotFoundError } from '../core/errors';
import { safeClick } from '../core/interactions';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';

export interface ModelSearchResult {
  page: Page;
  description: string;
}

export interface ModelSearchRequest {
  modelNumber: string;
  description?: string;
  isSolution: boolean;
  integrationRackPartNumber?: string;
}

export class ModelSearch {
  constructor(private readonly context: BrowserContext) {}

  async searchAndOpen(page: Page, request: ModelSearchRequest): Promise<ModelSearchResult> {
    const { modelNumber } = request;
    console.log(`[STEP] Searching for exact CTO model ${modelNumber}`);
    const search = page.getByRole('textbox', { name: /Search to open UCID or create|Search config/i })
      .or(page.locator('#search-config')).first();
    await expect(search).toBeVisible({ timeout: 60_000 });
    // Clear jQuery UI's result announcement so a "No search results." read later is for this search.
    await this.searchStatus(page).evaluateAll((nodes) => nodes.forEach((node) => { node.textContent = ''; })).catch(() => undefined);
    await search.fill(modelNumber);
    const option = await this.findSearchOption(page, request);
    await safeClick(option);
    await page.locator('#dqe_cards_container').waitFor({ state: 'visible', timeout: 60_000 });
    const cardSummaries = await page.locator('#dqe_cards_container').evaluate((container) => Array.from(
      container.querySelectorAll<HTMLElement>('button, .dqe-customize-btn'),
    ).filter((element) => /Customize|Build|Configure/i.test(element.innerText || element.getAttribute('title') || ''))
      .map((element) => {
        const owner = element.closest<HTMLElement>('.dqe-card') ?? element.parentElement?.parentElement;
        return (owner?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
      }).filter(Boolean));
    console.log(`[INFO] Configurable card candidates (${cardSummaries.length}): ${cardSummaries.join(' || ') || '<none>'}`);
    const card = await this.findExactCard(page, modelNumber, request.isSolution);
    await expect(card, `Exact configurable card for ${modelNumber} should be visible`).toBeVisible({ timeout: 60_000 });
    const cardText = (await card.innerText()).replace(/\s+/g, ' ');
    if (!request.isSolution && !new RegExp(`\\b${escapeRegex(modelNumber)}\\b`, 'i').test(cardText)) {
      // The autocomplete option is already constrained to the exact model. Some
      // result-card templates show only the chosen description and omit its SKU.
      console.log(`[WARN] Configurable card omitted model number ${modelNumber}; continuing from the exact selected dropdown option`);
    }
    if (!request.isSolution) await this.selectIntegrationRack(page, card, request.integrationRackPartNumber);
    console.log(`[STEP] Exact ${/\bCTO\b/i.test(cardText) ? 'CTO ' : ''}configurable card found for ${modelNumber}; clicking Customize`);
    const popup = this.context.waitForEvent('page', { timeout: 20_000 }).catch(() => null);
    const customize = card.getByRole('button', { name: /Customize|Build|Configure/i })
      .or(card.locator('button.dqe-customize-btn, .dqe-customize-btn')).filter({ visible: true }).first();
    await safeClick(customize);
    const configPage = (await popup) ?? page;
    await configPage.waitForLoadState('domcontentloaded').catch(() => undefined);
    await waitForBlockingOverlay(configPage);
    await this.waitForConfigWorkspace(configPage);
    console.log(`[STEP] OCA configuration workspace is ready for ${modelNumber}`);
    return { page: configPage, description: cardText };
  }

  /** jQuery UI autocomplete's live region: "No search results." or "N results are available…". */
  private searchStatus(page: Page): Locator {
    return page.locator('[role="status"].ui-helper-hidden-accessible');
  }

  private async findSearchOption(page: Page, request: ModelSearchRequest): Promise<Locator> {
    const { modelNumber, description, isSolution } = request;
    // A search word ("Private" for the Arcus solution, 2026-10-20) lists entries that need not contain it
    // ("S3V83A HPE GreenLake for PC3000 with Alletra Storage MP (Block) Wizard"); the description finds those.
    const modelPattern = new RegExp(`\\b${escapeRegex(modelNumber)}\\b${description ? `|${escapeRegex(description)}` : ''}`, 'i');
    const options = page.locator('ul.ui-autocomplete:not([style*="display: none"]) li.ui-menu-item, [role="option"]')
      .filter({ hasText: modelPattern }).filter({ visible: true });
    let outcome = '';
    await expect.poll(async () => {
      if (await options.first().isVisible().catch(() => false)) return (outcome = 'options');
      const announced = (await this.searchStatus(page).allTextContents().catch(() => [] as string[])).join(' ');
      return (outcome = /no search results/i.test(announced) ? 'none' : '');
    }, { timeout: 60_000, message: `Search dropdown option for ${modelNumber}` }).not.toBe('');
    if (outcome === 'none' && !await options.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      throw new ModelNotFoundError(`OCA returned no search results for ${modelNumber} in aaS mode. Check the model number, `
        + 'or search for it manually in OCA with aaS selected to confirm it is offered.');
    }
    const optionTexts = await options.evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '')
      .replace(/\s+/g, ' ').trim()).filter(Boolean));
    console.log(`[INFO] ${modelNumber} matching search dropdown options (${optionTexts.length}): ${optionTexts.join(' || ')}`);

    if (description) {
      const described = options.filter({ hasText: new RegExp(escapeRegex(description), 'i') }).first();
      if (await described.isVisible().catch(() => false)) {
        console.log(`[STEP] Selecting ${modelNumber} search result matching Excel Model Description: ${description}`);
        return described;
      }
      throw new Error(`No ${modelNumber} search dropdown option matched Excel Model Description '${description}'`);
    }
    if (isSolution) {
      const wizard = options.filter({ hasText: /Solution\s*Wizard|Wizard/i }).first();
      if (await wizard.isVisible().catch(() => false)) {
        console.log(`[STEP] Selecting Solution Wizard search result for ${modelNumber}`);
        return wizard;
      }
    } else {
      const normal = options.filter({ hasNotText: /Solution\s*Wizard|Wizard/i }).first();
      if (await normal.isVisible().catch(() => false)) return normal;
    }
    console.log(`[STEP] Selecting default search result for ${modelNumber}`);
    return options.first();
  }

  private async selectIntegrationRack(page: Page, card: Locator, requestedValue?: string): Promise<void> {
    const selector = card.locator('.selecter').filter({ hasText: /Integrate in|Standalone|Standard/i }).first();
    if (!(await selector.isVisible({ timeout: 2_000 }).catch(() => false))) {
      console.log('[INFO] Integration Rack selector is not available on this model card; continuing');
      return;
    }
    const trigger = selector.locator('.selecter-selected, .selected, .selecter-label').filter({ visible: true }).first();
    await safeClick((await trigger.isVisible().catch(() => false)) ? trigger : selector);
    const options = page.locator('.selecter-options:visible .selecter-item').filter({ visible: true });
    await expect(options.first(), 'Integration Rack options').toBeVisible({ timeout: 10_000 });

    const requested = (requestedValue ?? '').trim();
    let choice: Locator;
    if (!requested) {
      choice = page.locator('.selecter-options:visible .selecter-item[data-value="standalone"]')
        .or(options.filter({ hasText: /^\s*Stand(?:ard|alone)\s*$/i })).first();
    } else if (/^yes$/i.test(requested)) {
      choice = options.filter({ hasNotText: /^\s*(?:Integrate in|Stand(?:ard|alone))\s*$/i }).first();
    } else {
      choice = options.filter({ hasText: new RegExp(`^\\s*${escapeRegex(requested)}\\b`, 'i') }).first();
    }
    await expect(choice, requested ? `Integration Rack option ${requested}` : 'Standard/Standalone Integration Rack option')
      .toBeVisible({ timeout: 10_000 });
    const selectedText = ((await choice.innerText()).replace(/\s+/g, ' ')).trim();
    await safeClick(choice);
    console.log(`[STEP] Integration Rack: ${requested || 'Standard'} -> ${selectedText}`);
  }

  private async findExactCard(page: Page, modelNumber: string, isSolution = false): Promise<Locator> {
    const container = page.locator('#dqe_cards_container');
    const modelPattern = new RegExp(`\\b${escapeRegex(modelNumber)}\\b`, 'i');
    const action = page.getByRole('button', { name: /Customize|Build|Configure/i })
      .or(page.locator('button.dqe-customize-btn, .dqe-customize-btn'));
    const allCardContainers = container.locator('.dqe-card, div').filter({ visible: true });

    // Preserve the proven base-model lookup first. Older DQE pages use plain divs
    // rather than dqe-card, and their title can be "Pxxxxx — CTO".
    const exactCtoTitle = allCardContainers
      .filter({ hasText: new RegExp(`["“]?${escapeRegex(modelNumber)}["”]?\\s*[—-]\\s*CTO\\b`, 'i') })
      .filter({ hasNotText: /Smart CTO/i }).first();
    if (await exactCtoTitle.isVisible().catch(() => false)) return exactCtoTitle;

    const exactCto = allCardContainers.filter({ hasText: modelPattern })
      .filter({ hasText: /CTO Base Model|CTO Compute/i })
      .filter({ hasNotText: /Smart CTO/i }).first();
    if (await exactCto.isVisible().catch(() => false)) return exactCto;

    // Solution and bundle identifiers (often S-prefixed) may not be labelled CTO.
    // Accept them only when the exact model text and a configuration action coexist
    // in the same result card. Solution Template cards (data-type="st") are pre-built configurations: a
    // search word such as "Private" (Arcus model, 2026-10-20: '"Private" — Wizard') can match them too.
    const cards = container.locator('.dqe-card:not([data-type="st"])').filter({ visible: true, hasText: modelPattern });
    // A solution is built in its Wizard ("Build from scratch"), when one of the matching cards is one.
    const wizardCard = cards.filter({ has: action, hasText: /\bWizard\b/i }).first();
    if (isSolution && await wizardCard.isVisible().catch(() => false)) return wizardCard;
    const configurableCard = cards.filter({ has: action }).first();
    if (await configurableCard.isVisible().catch(() => false)) return configurableCard;

    // A Wizard card names its product by an internal id ("arcusDhciSol" — Wizard); the model number
    // is only in its product dropdown: <option value="arcusDhciSol" data-displayid="S3V83A">.
    const byDisplayId = container.locator('.dqe-card').filter({ visible: true, has: action })
      .filter({ has: page.locator(`select.dqe-products option[data-displayid=${JSON.stringify(modelNumber)} i]`) }).first();
    if (await byDisplayId.isVisible().catch(() => false)) {
      console.log(`[INFO] ${modelNumber} card found by its product dropdown: ${(await byDisplayId.locator('.category').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}`);
      return byDisplayId;
    }

    // Older DQE markup has no dqe-card class. Select the nearest visible action
    // container carrying the exact model number rather than a broad ancestor.
    const legacy = container.locator('div').filter({ visible: true, hasText: modelPattern, has: action }).last();
    if (await legacy.isVisible().catch(() => false)) return legacy;

    // Once an exact autocomplete entry has been selected, some solution cards omit
    // the model number from their rendered body. Accept a single unambiguous card.
    // Solution Template cards (data-type="st", e.g. "PC3000 - Promo") are pre-built configurations,
    // not the model to build from scratch, so they do not count.
    const configurableCards = container.locator('.dqe-card:not([data-type="st"])').filter({ visible: true, has: action });
    if (await configurableCards.count() === 1) return configurableCards.first();
    const wizards = configurableCards.filter({ hasText: /\bWizard\b/i });
    if (isSolution && await wizards.count() === 1) return wizards.first();
    return legacy;
  }

  private async waitForConfigWorkspace(page: Page): Promise<void> {
    const controls = [
      page.locator('[id^="section_header_"]').filter({ visible: true }).first(),
      page.getByRole('link', { name: 'Services', exact: true }).filter({ visible: true }).first(),
      page.locator('input[placeholder*="Search config" i], input[aria-label*="Search config" i]').filter({ visible: true }).first(),
      page.locator('#save_icon, [title="Save"]').filter({ visible: true }).first(),
      page.locator('a[href="#extended_overview_solutionWizard"]').filter({ visible: true }).first(),
    ];
    await expect.poll(async () => {
      for (const control of controls) {
        if (await control.isVisible({ timeout: 500 }).catch(() => false)) return true;
      }
      return false;
    }, { timeout: 90_000, message: 'OCA configuration workspace controls after Customize' }).toBe(true);
  }
}
