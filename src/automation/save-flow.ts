import { expect, type Locator, type Page } from '@playwright/test';
import { waitForBlockingOverlay } from '../core/waits';

export interface SaveOutcome { ucid: string; status: string; }
export interface SaveFlowOptions { confirmationTimeoutMs?: number; }
export class SaveRecoveryRequiredError extends Error {
  constructor(message: string) { super(message); this.name = 'SaveRecoveryRequiredError'; }
}

export class SaveFlow {
  constructor(private readonly page: Page, private readonly options: SaveFlowOptions = {}) {}

  async save(): Promise<SaveOutcome> {
    await waitForBlockingOverlay(this.page);
    console.log('[STEP] Opening Save menu');
    const saveMenu = this.page.getByText('Save', { exact: true }).filter({ visible: true }).first();
    if (await saveMenu.isVisible({ timeout: 5_000 }).catch(() => false)) await saveMenu.click({ force: true });
    else await this.page.locator('#save #save_icon, [title="Save"] #save_icon, #save_icon').filter({ visible: true }).first().click({ force: true });

    const saveConfig = this.page.getByText(/^Save OCA Config(?:uration)?(?:\s*2)?$/i)
      .filter({ visible: true }).first();
    await expect(saveConfig, 'Save OCA Config 2 menu item').toBeVisible({ timeout: 60_000 });
    console.log('[STEP] Selecting Save OCA Config 2');
    await saveConfig.click({ force: true });
    await waitForBlockingOverlay(this.page);

    const dialog = this.page.locator('.ui-dialog, [role="dialog"]')
      .filter({ visible: true, hasText: /Save|CLIC Status|Acknowledge/i }).last();
    await expect(dialog, 'Save OCA Config 2 dialog').toBeVisible({ timeout: 60_000 });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      console.log(`[STEP] Save acknowledgement attempt ${attempt}/5`);
      await this.ensureAcknowledgements(dialog);
      const saveButton = dialog.locator('#save_btn').or(dialog.getByRole('button', { name: 'Save', exact: true }))
        .filter({ visible: true }).last();
      await expect(saveButton).toBeVisible({ timeout: 60_000 });
      if (await this.isDisabled(saveButton)) {
        await this.closeDialogForRecovery(dialog);
        throw new SaveRecoveryRequiredError(
          'Save is disabled after acknowledgements; OCA requires additional component selections',
        );
      }
      // OCA can retain a disabled-looking CSS class after the real acknowledgement
      // is checked. Attempt the proven coordinate click and use dialog closure as truth.
      const saveBox = await saveButton.boundingBox();
      if (saveBox) await this.page.mouse.click(saveBox.x + saveBox.width / 2, saveBox.y + saveBox.height / 2);
      else await saveButton.click({ force: true });

      await Promise.race([
        dialog.waitFor({ state: 'hidden', timeout: 25_000 }).catch(() => undefined),
        this.page.locator('#obw_endbom_bot').filter({ visible: true }).waitFor({ state: 'visible', timeout: 25_000 }).catch(() => undefined),
        this.page.getByText(/\(OCA\) has encountered a problem/).waitFor({ state: 'visible', timeout: 25_000 }).catch(() => undefined),
      ]);
      if (await this.page.getByText(/\(OCA\) has encountered a problem/).isVisible({ timeout: 500 }).catch(() => false)) {
        throw new Error('OCA reported an application error after Save');
      }
      if (!(await dialog.isVisible({ timeout: 1_000 }).catch(() => false))) {
        await waitForBlockingOverlay(this.page);
        return await this.verifySaved();
      }
      console.log('[WARN] Save dialog remains open; acknowledgements will be retried');
      if (attempt >= 2) {
        await this.closeDialogForRecovery(dialog);
        throw new SaveRecoveryRequiredError(
          'Save dialog remained open after two enabled Save attempts; checking Menu requirements before retrying',
        );
      }
    }
    throw new Error('Save dialog remained open after 5 acknowledgement and Save attempts');
  }

  private async ensureAcknowledgements(dialog: Locator): Promise<void> {
    await this.ensureOptionalAcknowledgement(
      dialog,
      'CLIC Status is Unbuildable',
      ['#clicStatus_flag', 'input[type="checkbox"][id*="clicStatus" i]', 'input[type="checkbox"][name*="clicStatus" i]'],
      '#clicStatus_checkbox',
      'label[for="clicStatus_flag"]',
    );
    await this.ensureOptionalAcknowledgement(
      dialog,
      'Errors before Saving as Action-Required',
      ['#ack_flag', 'input[type="checkbox"][id*="ack" i]', 'input[type="checkbox"][name*="ack" i]'],
      '#ack_checkbox',
      'label[for="ack_flag"]',
    );

    // Some OCA models expose one acknowledgement and others expose both. Synchronize
    // every real checkbox input present in the active Save dialog.
    const allInputs = dialog.locator([
      '#ack_flag',
      'input[type="checkbox"][id*="ack" i]',
      'input[type="checkbox"][name*="ack" i]',
      'input[type="checkbox"][id*="clicStatus" i]',
      'input[type="checkbox"][name*="clicStatus" i]',
    ].join(', '));
    const inputCount = await allInputs.count();
    for (let index = 0; index < inputCount; index += 1) {
      const input = allInputs.nth(index);
      if (!(await input.isChecked().catch(() => false))) {
        await input.check({ force: true }).catch(() => undefined);
        await input.dispatchEvent('input').catch(() => undefined);
        await input.dispatchEvent('change').catch(() => undefined);
      }
    }
    console.log(`[INFO] Save dialog acknowledgement checkbox count: ${inputCount}`);
  }

  private async ensureOptionalAcknowledgement(
    dialog: Locator,
    name: string,
    inputSelectors: string[],
    iconSelector: string,
    labelSelector: string,
  ): Promise<void> {
    const inputs = dialog.locator(inputSelectors.join(', '));
    const icon = dialog.locator(iconSelector).filter({ visible: true }).first();
    const label = dialog.locator(labelSelector).filter({ visible: true }).first();
    const iconVisible = await icon.isVisible({ timeout: 500 }).catch(() => false);
    const labelVisible = await label.isVisible({ timeout: 500 }).catch(() => false);
    // A visible #clicStatus_checkbox can be the red Unbuildable status icon shown
    // beside the text, not an acknowledgement control. Require real inputs/labels as
    // actionable; do not click a standalone status icon.
    if (!labelVisible && await inputs.count() === 0) {
      console.log(`[INFO] ${name} checkbox is not available; continuing`);
      return;
    }

    if (iconVisible && await this.hasActiveCheckboxState(icon)) {
      console.log(`[INFO] Acknowledged ${name}`);
      return;
    }

    // OCA's handlers require a trusted pointer event. dispatchEvent('click') changes
    // some DOM state but does not enable Save for the CLIC acknowledgement.
    if (labelVisible) {
      await label.scrollIntoViewIfNeeded();
      await label.click({ force: true }).catch(async () => {
        const box = await label.boundingBox();
        if (box) await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      });
    }
    if (iconVisible && !(await this.hasActiveCheckboxState(icon))) {
      await icon.dispatchEvent('mousedown').catch(() => undefined);
      await icon.dispatchEvent('mouseup').catch(() => undefined);
      await icon.dispatchEvent('click').catch(() => undefined);
    }
    await this.page.waitForTimeout(500);

    if (iconVisible && !(await this.hasActiveCheckboxState(icon))) {
      const box = await icon.boundingBox();
      if (box) await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.waitForTimeout(500);
    }

    // Synchronize every duplicate hidden input only after the real visual click.
    for (let index = 0; index < await inputs.count(); index += 1) {
      const input = inputs.nth(index);
      if (!(await input.isChecked().catch(() => false))) {
        await input.check({ force: true }).catch(() => undefined);
        await input.dispatchEvent('change').catch(() => undefined);
      }
    }

    const selected = (iconVisible && await this.hasActiveCheckboxState(icon))
      || await inputs.first().isChecked().catch(() => false);
    if (selected) console.log(`[INFO] Acknowledged ${name}`);
    else console.log(`[WARN] ${name} did not expose a confirmed checked state; Save-button state will decide whether another attempt is needed`);
  }

  private async hasActiveCheckboxState(icon: Locator): Promise<boolean> {
    const state = [
      await icon.getAttribute('class').catch(() => ''),
      await icon.getAttribute('aria-checked').catch(() => ''),
      await icon.getAttribute('data-checked').catch(() => ''),
    ].join(' ');
    return /checkbox_active|\bactive\b|\bchecked\b|\bselected\b|\btrue\b/i.test(state);
  }

  private async readUcid(): Promise<string> {
    const body = (await this.page.locator('body').innerText()).replace(/\s+/g, ' ');
    return body.match(/\bUCID\s*[:#-]?\s*([A-Za-z0-9_-]{4,})/i)?.[1] ?? '';
  }

  private async isDisabled(button: Locator): Promise<boolean> {
    if (await button.isDisabled().catch(() => false)) return true;
    const state = [
      await button.getAttribute('class').catch(() => ''),
      await button.getAttribute('aria-disabled').catch(() => ''),
      await button.getAttribute('data-disabled').catch(() => ''),
    ].join(' ');
    return /(?:^|\s)(?:disabled|ui-state-disabled)(?:\s|$)|\btrue\b/i.test(state);
  }

  private async closeDialogForRecovery(dialog: Locator): Promise<void> {
    console.log('[STEP] Closing Save dialog to repair required Menu selections');
    const close = dialog.locator(
      '.ui-dialog-titlebar-close, [aria-label*="close" i], [title*="close" i], button.close',
    ).filter({ visible: true }).first();
    if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await this.page.keyboard.press('Escape');
    }
    await expect(dialog, 'Save dialog should close before Menu recovery').toBeHidden({ timeout: 15_000 });
    await waitForBlockingOverlay(this.page);
  }

  private async verifySaved(): Promise<SaveOutcome> {
    let ucid = '';
    const endBomEntry = this.page.locator([
      '#obw_endbom_bot',
      '[id*="endbom" i]',
      '[data-action*="endbom" i]',
    ].join(', ')).or(this.page.getByRole('button', { name: /End BOM/i }))
      .or(this.page.getByRole('link', { name: /End BOM/i }))
      .or(this.page.getByText(/^End BOM$/i)).filter({ visible: true }).first();

    await expect.poll(async () => {
      ucid = await this.readUcid();
      return Boolean(ucid) || await endBomEntry.isVisible({ timeout: 500 }).catch(() => false);
    }, {
      timeout: this.options.confirmationTimeoutMs ?? 60_000,
      message: 'Saved OCA configuration confirmation (UCID or End BOM action)',
    }).toBe(true);

    console.log(`[INFO] OCA configuration save confirmed${ucid ? ` with UCID ${ucid}` : ' by the available End BOM action'}`);
    return { ucid, status: 'Saved' };
  }
}
