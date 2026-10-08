import { expect, type Locator, type Page } from '@playwright/test';
import type { ComponentInstruction } from '../models/component-instruction';
import { waitForBlockingOverlay } from '../core/waits';
import { QuantityHandler } from '../components/quantity-handler';

export async function openDhciDriveEnclosure(page: Page): Promise<void> {
  const header = page.locator('#section_header_driveEnclosureSection, [id*="section_header" i][id*="driveEnclosure" i]')
    .filter({ visible: true }).first();
  const fallback = page.getByText(/Drive Enclosure/i).filter({ visible: true }).first();
  const section = await header.isVisible({ timeout: 3_000 }).catch(() => false) ? header : fallback;
  await expect(section, 'Drive Enclosure section required by the selected controller chassis')
    .toBeVisible({ timeout: 30_000 });
  await section.scrollIntoViewIfNeeded();
  if (await section.getAttribute('aria-expanded') !== 'true') {
    console.log('[STEP] Opening dHCI Drive Enclosure section to apply its dependent defaults');
    await section.click({ force: true });
    await waitForBlockingOverlay(page);
  }
}

export interface SolutionWizardSelection {
  label: string;
  value: string;
  text: string;
}

interface WizardChoice {
  label: RegExp;
  aliases?: RegExp;
  occurrence?: number;
  preferred?: ComponentInstruction;
  allowedRandomText?: RegExp;
  optional?: boolean;
}

const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Configures solution/bundle models whose choices are rendered in the Solution Wizard tab. */
export class SolutionWizard {
  private readonly quantities: QuantityHandler;

  constructor(private readonly page: Page) { this.quantities = new QuantityHandler(page); }

  async configure(instructions: ComponentInstruction[], server?: string): Promise<SolutionWizardSelection[]> {
    console.log('[STEP] Opening Solution Wizard tab');
    const tab = this.page.locator('a[href="#extended_overview_solutionWizard"]')
      .or(this.page.getByRole('link', { name: /Solution Wizard/i })).filter({ visible: true }).first();
    await expect(tab, 'Solution Wizard tab').toBeVisible({ timeout: 60_000 });
    await this.scrollToSelection(tab, 'Solution Wizard tab');
    await tab.click({ force: true });
    await waitForBlockingOverlay(this.page);
    await this.acknowledgeRequirementsIfPresent();

    if (await this.page.locator('#dhci_type_options').count()) {
      return this.configureDhciSolution(server);
    }

    const instruction = (section: RegExp) => instructions.find((item) => section.test(item.section.trim()));
    const memory = instruction(/^memory$/i);
    const memoryQuantity = instruction(/^memory\s*(?:qty|quantity)$/i) ?? (memory?.quantity == null ? undefined : {
      ...memory,
      productNumber: undefined,
      configurationText: undefined,
      quantity: memory.quantity,
    });
    const choices: WizardChoice[] = [
      { label: /^Processor$/i, preferred: instruction(/^processor$/i) },
      { label: /^Memory$/i, preferred: memory },
      { label: /^Memory Qty$/i, aliases: /memory.*qty|memqty/i, preferred: memoryQuantity, allowedRandomText: /^(?:[1-8])$/ },
      { label: /^Data Controller$/i, aliases: /datactrl|data.*controller/i },
      { label: /^Storage Drives$/i, aliases: /storage.*drive|stodrive/i },
      { label: /^Drive Qty$/i, aliases: /stoqty|drive.*qty/i },
      { label: /^Controllers Accessories$/i, aliases: /controller.*accessor/i },
      { label: /^Power Supply$/i, aliases: /power.*supply/i },
      { label: /^(?:Select )?OCP Network Adapter$/i, aliases: /ocp.*(?:network)?.*adapter/i, occurrence: 0 },
      { label: /^(?:Select )?OCP Network Adapter$/i, aliases: /ocp.*(?:network)?.*adapter/i, occurrence: 1, optional: true },
      { label: /^Select Network Adapter$/i, aliases: /network.*adapter/i, occurrence: 0 },
      { label: /^Select Network Adapter$/i, aliases: /network.*adapter/i, occurrence: 1, optional: true },
    ];

    const selected: SolutionWizardSelection[] = [];
    for (const choice of choices) {
      const result = await this.selectChoice(choice);
      if (result) selected.push(result);
    }
    return selected;
  }

  private async configureDhciSolution(requestedServer?: string): Promise<SolutionWizardSelection[]> {
    console.log('[STEP] dHCI Solution Wizard detected; configuring its dependent selections');
    const selected: SolutionWizardSelection[] = [];

    const solutionType = this.page.locator('#dhci_type_options input[type="radio"]:not([disabled])');
    await expect(solutionType.first(), 'dHCI Solution type options').toBeAttached({ timeout: 30_000 });
    let type = this.page.locator('#dhci_type_options input[type="radio"]:checked:not([disabled])').first();
    if (!(await type.count())) type = solutionType.nth(Math.floor(Math.random() * await solutionType.count()));
    await this.scrollToSelection(type, 'dHCI Solution Type');
    if (!(await type.isChecked().catch(() => false))) {
      const id = await type.getAttribute('id');
      await this.page.locator(`label[for="${id}"]`).click({ force: true });
      await waitForBlockingOverlay(this.page);
    }
    await expect(type, 'dHCI Solution type').toBeChecked({ timeout: 10_000 });
    const typeText = normalized(await this.page.locator(`label[for="${await type.getAttribute('id')}"]`).innerText());
    selected.push({ label: 'Solution Type', value: await type.inputValue(), text: typeText });
    console.log(`[STEP] dHCI Solution Type: ${typeText}`);

    selected.push(await this.selectDhciOption('#dhci_DLFilter_model', 'Server', requestedServer));
    selected.push(await this.selectDhciOption('#dhci_cto_base_model', 'Server Model'));

    const serverQuantity = this.randomInteger(1, 16);
    const quantity = this.page.locator('#dhci_server_qty');
    await expect(quantity, 'dHCI Server quantity').toBeEnabled({ timeout: 30_000 });
    await this.scrollToSelection(quantity, 'dHCI Server quantity');
    await quantity.fill(String(serverQuantity));
    await quantity.press('Tab');
    await waitForBlockingOverlay(this.page);
    await expect(quantity).toHaveValue(String(serverQuantity));
    selected.push({ label: 'Server Qty', value: String(serverQuantity), text: String(serverQuantity) });
    console.log(`[STEP] Random dHCI Server Qty: ${serverQuantity}`);

    selected.push(await this.selectDhciOption('#dhci_base_flexLom', 'Server Ethernet FlexibleLOM/OCP3 Adapter'));
    const switchFamily = this.page.locator('select:has(option[value="arubaswitch_ProStack"])').first();
    await expect(switchFamily, 'dHCI Switches dropdown containing Aruba Base Model').toBeAttached({ timeout: 30_000 });
    selected.push(await this.selectDhciLocator(switchFamily, 'Switches', 'arubaswitch_ProStack', 'Fixed'));
    const switchModel = this.page.locator('select:has(option[value^="Nimble_"])').first();
    if (await switchModel.count()) selected.push(await this.selectDhciLocator(switchModel, 'Switch Block Type'));

    await this.configureDhciMenuIfPresent(selected);
    return selected;
  }

  private async selectDhciOption(selector: string, label: string, requested?: string): Promise<SolutionWizardSelection> {
    const select = this.page.locator(selector).first();
    await expect(select, label).toBeAttached({ timeout: 30_000 });
    return this.selectDhciLocator(select, label, requested);
  }

  private async selectDhciLocator(
    select: Locator, label: string, requested?: string, requestedSource = 'Excel',
  ): Promise<SolutionWizardSelection> {
    await expect.poll(() => select.locator('option:not([disabled])').count(), {
      timeout: 60_000, message: `${label} selectable options`,
    }).toBeGreaterThan(1);
    await this.scrollToSelection(select, `dHCI ${label}`);
    const options = await select.locator('option:not([disabled])').evaluateAll((nodes) => nodes.map((node) => ({
      value: (node as HTMLOptionElement).value,
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })).filter((option) => option.value && option.value !== 'none_item' && !/^none\.?$/i.test(option.text)));
    const wanted = normalized(requested ?? '');
    const picked = wanted
      ? options.find((option) => option.value.toLowerCase() === wanted.toLowerCase()
        || option.text.toLowerCase() === wanted.toLowerCase()
        || option.text.toLowerCase().includes(wanted.toLowerCase()))
      : options[Math.floor(Math.random() * options.length)];
    if (!picked) throw new Error(`Excel Server value '${requested}' is unavailable in ${label}`);
    await select.selectOption(picked.value, { force: true });
    await waitForBlockingOverlay(this.page);
    await expect(select).toHaveValue(picked.value);
    console.log(`[STEP] ${wanted ? requestedSource : 'Random'} dHCI ${label}: ${picked.text}`);
    return { label, value: picked.value, text: picked.text };
  }

  private async configureDhciMenuIfPresent(selected: SolutionWizardSelection[]): Promise<void> {
    const menu = this.page.locator('a[href="#extended_overview_menu"]')
      .or(this.page.getByRole('link', { name: /^Menu$/i })).filter({ visible: true }).first();
    if (!(await menu.isVisible({ timeout: 3_000 }).catch(() => false))) {
      console.log('[INFO] Menu tab is not available for this dHCI solution; continuing');
      return;
    }
    console.log('[STEP] Opening Menu tab for dHCI solution components');
    await this.scrollToSelection(menu, 'Menu tab');
    await menu.click({ force: true });
    await waitForBlockingOverlay(this.page);

    const nodeCombination = Math.random() < 0.5
      ? { chassis: 2, nodes: 4 }
      : { chassis: 1, nodes: 2 };
    console.log(`[STEP] dHCI Controller Node combination: Node Chassis ${nodeCombination.chassis}, Node ${nodeCombination.nodes}`);
    selected.push(await this.selectRandomMenuRow(
      'nodechassisSection_nodeschassisChoice', 'Controller Node Chassis', nodeCombination.chassis, nodeCombination.chassis,
    ));
    selected.push(await this.selectRandomMenuRow(
      'nodechassisSection_nodesChoice', 'Controller Node', nodeCombination.nodes, nodeCombination.nodes,
    ));
    // Controller chassis selections reveal a required Drive Enclosure dependency.
    // The proven S3V83A flow opens this section before choosing Capacity, allowing
    // OCA to calculate and apply the enclosure defaults.
    await openDhciDriveEnclosure(this.page);
    await this.disableRecommendedOnlyIfEnabled();
    selected.push(await this.selectRandomMenuRow('hardDriveSection_NVMeSFFFESSDsChoice', 'Capacity', 16, 48));
    selected.push(await this.selectRandomMenuRow('daccableSection_dacHostCablesChoice', 'DAC Cables', 8, 100));
  }

  private async selectRandomMenuRow(
    elementId: string, label: string, minimum: number, maximum: number,
  ): Promise<SolutionWizardSelection> {
    const sectionKey = elementId.split('_')[0];
    const rows = this.page.locator(`tr.item_tr[data-elementid="${elementId}"]`).filter({ visible: true });
    const header = this.page.locator(`[id*="section_header" i][id*="${sectionKey}" i]`).filter({ visible: true }).first();
    if (!(await rows.first().isVisible({ timeout: 1_000 }).catch(() => false))
      && await header.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await this.scrollToSelection(header, `${label} section`);
      await header.click({ force: true });
      await waitForBlockingOverlay(this.page);
    }
    await expect(rows.first(), `${label} product rows`).toBeVisible({ timeout: 60_000 });
    const row = rows.nth(Math.floor(Math.random() * await rows.count()));
    await this.scrollToSelection(row, `${label} product`);
    const productNumber = normalized(await row.locator('._pid').first().innerText());
    const description = normalized(await row.locator('.item_desc').first().innerText().catch(() => productNumber));
    // The lower bounds are known-valid business quantities (Capacity 16, DAC 8).
    // Do not assume every integer in a permitted range is exposed by OCA's custom
    // quantity dropdown (for example, 26 may not be an available menu option).
    const quantity = minimum;
    console.log(`[STEP] dHCI ${label}: ${description} (${productNumber}) x${quantity} (allowed ${minimum}-${maximum})`);
    await this.quantities.set(row, productNumber, quantity, false);
    return { label, value: productNumber, text: `${description} x${quantity}` };
  }

  private async disableRecommendedOnlyIfEnabled(): Promise<void> {
    const toggle = this.page.locator('#menu_cust_cmn_toggle').first();
    const label = this.page.locator('label[for="menu_cust_cmn_toggle"]').first();
    if (!(await toggle.count()) && !(await label.isVisible({ timeout: 2_000 }).catch(() => false))) return;
    const enabled = await toggle.isChecked().catch(async () => /active|checked|on/i.test(await label.getAttribute('class') ?? ''));
    if (!enabled) return;
    console.log('[STEP] Disabling HPE Recommended only for dHCI Capacity and DAC choices');
    await this.scrollToSelection(label, 'HPE Recommended only toggle');
    if (await label.isVisible().catch(() => false)) await label.click({ force: true });
    else await toggle.click({ force: true });
    const dialog = this.page.locator('.ui-dialog:visible, [role="dialog"]:visible').last();
    const dialogVisible = await dialog.isVisible({ timeout: 10_000 }).catch(() => false);
    const confirmRoot = dialogVisible ? dialog : this.page.locator('body');
    const confirm = confirmRoot.getByRole('button', { name: /^Yes$/i })
      .or(confirmRoot.locator('button, input[type="button"], input[type="submit"], .s-btn')
        .filter({ visible: true, hasText: /^Yes$/i })).first();
    await expect(confirm, 'HPE Recommended only confirmation Yes button').toBeVisible({ timeout: 15_000 });
    console.log('[STEP] Confirming HPE Recommended only change');
    await this.scrollToSelection(confirm, 'HPE Recommended confirmation');
    await confirm.click({ force: true });
    if (dialogVisible) await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
    await expect(this.page.locator('.blockUI.blockOverlay:visible'), 'Blocking overlay after HPE Recommended change')
      .toHaveCount(0, { timeout: 90_000 });
    await expect.poll(() => toggle.isChecked().catch(() => false), {
      timeout: 30_000, message: 'HPE Recommended only toggle should be disabled',
    }).toBe(false);
  }

  private randomInteger(minimum: number, maximum: number): number {
    return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  }

  private async scrollToSelection(target: Locator, label: string): Promise<void> {
    await expect(target, label).toBeAttached({ timeout: 30_000 });
    let visibleTarget = target;
    if (!(await visibleTarget.isVisible().catch(() => false))) {
      const id = await target.getAttribute('id');
      const associatedLabel = id ? this.page.locator(`label[for="${id}"]`).filter({ visible: true }).first() : undefined;
      const customSelect = target.locator(
        'xpath=following-sibling::*[contains(concat(" ", normalize-space(@class), " "), " selecter ")][1]',
      ).filter({ visible: true }).first();
      const field = target.locator(
        'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " form-container-border ") or contains(concat(" ", normalize-space(@class), " "), " wizard_radio ") or contains(concat(" ", normalize-space(@class), " "), " wizard_checkbox ")][1]',
      ).filter({ visible: true }).first();
      if (associatedLabel && await associatedLabel.isVisible().catch(() => false)) visibleTarget = associatedLabel;
      else if (await customSelect.isVisible().catch(() => false)) visibleTarget = customSelect;
      else if (await field.isVisible().catch(() => false)) visibleTarget = field;
      else throw new Error(`${label} is attached but has no visible control, label, or field to scroll to`);
    }
    await visibleTarget.scrollIntoViewIfNeeded();
    await visibleTarget.evaluate((element) => element.scrollIntoView({
      block: 'center', inline: 'nearest', behavior: 'instant',
    }));
    await this.page.waitForTimeout(300);
    console.log(`[INFO] Scrolled to ${label}`);
  }

  private async acknowledgeRequirementsIfPresent(): Promise<void> {
    const panel = this.page.locator('#extended_overview_solutionWizard').filter({ visible: true }).first();
    const root = await panel.count() ? panel : this.page.locator('body');
    const disabled = root.locator('.wizard_checkbox input[type="checkbox"]:disabled');
    if (await disabled.count()) {
      const disabledIds = await disabled.evaluateAll((nodes) => nodes.map((node) => node.id || '<unnamed>').join(', '));
      console.log(`[INFO] Ignoring disabled Solution Wizard checkbox(es): ${disabledIds}`);
    }
    const checkboxes = root.locator([
      '.wizard_checkbox input[type="checkbox"]:not(:disabled)',
      'input#dhciarcus_acknowledge_checkbox:not(:disabled)',
    ].join(', '));
    const count = await checkboxes.count();
    if (!count) {
      console.log('[INFO] Solution Wizard acknowledgement checkbox is not present; continuing');
      return;
    }

    for (let index = 0; index < count; index += 1) {
      const checkbox = checkboxes.nth(index);
      if (await checkbox.isChecked().catch(() => false)) continue;
      const id = await checkbox.getAttribute('id');
      const label = id
        ? root.locator(`label[for="${id}"]`).first()
        : checkbox.locator('xpath=following-sibling::label[1]');
      await expect(label, 'Solution Wizard acknowledgement checkbox label').toBeVisible({ timeout: 10_000 });
      await this.scrollToSelection(label, 'Solution Wizard acknowledgement');
      const acknowledgement = ((await checkbox.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " wizard_checkbox ")][1]')
        .innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      console.log(`[STEP] Enabling Solution Wizard acknowledgement${acknowledgement ? `: ${acknowledgement}` : ''}`);
      await label.click({ force: true });
      await waitForBlockingOverlay(this.page);
      await expect(checkbox, 'Solution Wizard acknowledgement must remain checked').toBeChecked({ timeout: 10_000 });
    }
  }

  private async selectChoice(choice: WizardChoice): Promise<SolutionWizardSelection | undefined> {
    const select = await this.findSelect(choice);
    if (!select) {
      if (choice.optional) {
        console.log(`[INFO] Optional Solution Wizard choice ${choice.label} is not present; continuing`);
        return undefined;
      }
      throw new Error(`Solution Wizard choice was not found: ${choice.label}`);
    }

    // OCA lazy-loads/recalculates wizard controls as the user moves down the page.
    // Bring the owning field into the viewport before reading or changing options.
    await select.evaluate((element) => {
      const field = element.closest('.wizard_dropdown, .form-container-border, .sub-col') ?? element;
      field.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    });
    await this.page.waitForTimeout(250);

    await expect.poll(() => select.locator('option').count(), {
      timeout: 60_000,
      message: `Options for Solution Wizard choice ${choice.label}`,
    }).toBeGreaterThan(1);
    const options = await select.locator('option').evaluateAll((nodes) => nodes.map((node) => ({
      value: (node as HTMLOptionElement).value,
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
      disabled: (node as HTMLOptionElement).disabled,
    })));
    let candidates = options.filter((option) => !option.disabled && option.value !== 'none_item' && option.text
      && !/please make a selection|^none\.?$/i.test(option.text));
    if (choice.allowedRandomText) candidates = candidates.filter((option) => choice.allowedRandomText!.test(option.text));

    const requested = this.requestedValue(choice.preferred);
    const picked = requested
      ? candidates.find((option) => option.value.toLowerCase() === requested.toLowerCase()
          || option.text.toLowerCase() === requested.toLowerCase()
          || option.text.toLowerCase().includes(requested.toLowerCase()))
      : candidates[Math.floor(Math.random() * candidates.length)];
    if (!picked) {
      if (choice.optional && !requested) return undefined;
      throw new Error(requested
        ? `Excel value '${requested}' is unavailable for Solution Wizard choice ${choice.label}`
        : `No selectable values are available for Solution Wizard choice ${choice.label}`);
    }

    console.log(`[STEP] ${requested ? 'Excel' : 'Random'} Solution Wizard ${choice.label}: ${picked.text}`);
    await select.selectOption(picked.value, { force: true });
    await waitForBlockingOverlay(this.page);
    const current = normalized(await select.locator('option:checked').textContent().catch(() => '') ?? '');
    if (!current || /please make a selection/i.test(current)) {
      throw new Error(`Solution Wizard choice ${choice.label} did not retain ${picked.text}`);
    }
    return { label: choice.label.source.replace(/\^|\$/g, ''), value: picked.value, text: current };
  }

  private requestedValue(instruction?: ComponentInstruction): string | undefined {
    if (!instruction || /^(random|default)$/i.test(instruction.selectionType)) return undefined;
    const value = instruction.productNumber ?? instruction.configurationText
      ?? (instruction.quantity == null ? undefined : String(instruction.quantity));
    return value ? normalized(value) : undefined;
  }

  private async findSelect(choice: WizardChoice): Promise<Locator | undefined> {
    const panel = this.page.locator('#extended_overview_solutionWizard').filter({ visible: true }).first();
    const root = await panel.count() ? panel : this.page.locator('body');
    // Start at the label itself so nested wizard/form containers cannot return the
    // same select more than once when two adapter controls share an identical label.
    const labelled = root.locator('span').filter({ hasText: choice.label })
      .locator('xpath=following-sibling::select[1]');
    const labelledCount = await labelled.count();
    if (labelledCount > (choice.occurrence ?? 0)) return labelled.nth(choice.occurrence ?? 0);

    if (choice.aliases) {
      const selects = root.locator('select');
      const matches: Locator[] = [];
      for (let index = 0; index < await selects.count(); index += 1) {
        const candidate = selects.nth(index);
        const identity = `${await candidate.getAttribute('id') ?? ''} ${await candidate.getAttribute('name') ?? ''}`;
        if (choice.aliases.test(identity)) matches.push(candidate);
      }
      if (matches.length > (choice.occurrence ?? 0)) return matches[choice.occurrence ?? 0];
    }
    return undefined;
  }
}
