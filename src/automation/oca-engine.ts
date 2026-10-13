import { resolveConfigurationErrors } from './configuration-errors';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { OcaJob } from '../models/job';
import type { AutomationResult } from '../models/automation-result';
import { createPendingResult } from '../models/automation-result';
import { waitForBlockingOverlay } from '../core/waits';
import { safeClick } from '../core/interactions';
import { ModelSearch } from './model-search';
import { ComponentEngine } from './component-engine';
import { BillingTier } from './billing-tier';
import { SaveFlow, SaveRecoveryRequiredError } from './save-flow';
import { EndBom } from './end-bom';
import { SupportServices } from './support-services';
import { ExceptionRegistry } from '../exceptions/exception-registry';
import type { ServerGeneration } from './model-search';
import { SolutionWizard } from './solution-wizard';
import { StorageFlow } from './storage-flow';
import { selectAasMode } from './quotation-mode';
import type { HtmlCapture } from '../reporting/html-capture';

export interface OcaEngineOptions { baseUrl: string; authWaitMs: number; expectedPageText: string; html?: HtmlCapture; }

export async function recoverRequiredMenuSelections(
  page: Page,
  components: Pick<ComponentEngine, 'satisfyRequiredSection' | 'satisfyVisibleRequiredControl'>,
): Promise<void> {
  const menu = page.locator('a[href="#extended_overview_menu"]')
    .or(page.getByRole('link', { name: /^Menu$/i }))
    .or(page.getByRole('link', { name: /^Components$/i }))
    .filter({ visible: true }).first();
  await expect(menu, 'Menu or Components tab for Save recovery').toBeVisible({ timeout: 30_000 });
  console.log('[STEP] Returning to Menu to resolve selections that disabled Save');
  await safeClick(menu);
  await waitForBlockingOverlay(page);
  await resolveConfigurationErrors(page, components);
}

/**
 * Some models have no Smart Chassis section (P83540-B21, DL580 Gen12). Its header id
 * starts with section_header_smartChassis on the models that have one.
 */
export async function hasSmartChassisSection(page: Page): Promise<boolean> {
  return await page.locator('[id^="section_header_smartChassis" i]').count() > 0;
}

export class OcaEngine {
  private page?: Page;
  components!: ComponentEngine;
  currentStep = 'Initialize';
  private authenticated = false;

  constructor(private readonly context: BrowserContext, private readonly exceptions: ExceptionRegistry, private readonly options: OcaEngineOptions) {}

  get activePage(): Page {
    if (!this.page) throw new Error('OCA page is not initialized');
    return this.page;
  }

  async processJob(job: OcaJob, retryCount = 0): Promise<AutomationResult> {
    const jobStartedAt = Date.now();
    const result = createPendingResult(job.jobId, job.modelNumber, retryCount);
    this.currentStep = 'Open OCA';
    await this.measure('Open OCA', () => this.openOca());
    this.currentStep = 'Select aaS';
    await this.measure('Select aaS and verify landing', () => this.selectAasAndVerifyLanding());
    this.currentStep = 'Search model';
    console.log(`[INFO] Excel model selection: description=${job.modelDescription ?? job.solutionName ?? '<blank>'}; solution=${job.isSolution ? 'Yes' : 'No'}; integration rack=${job.integrationRackPartNumber ?? '<blank>'}`);
    const model = await this.measure('Search and open model', () =>
      new ModelSearch(this.context).searchAndOpen(this.activePage, {
        modelNumber: job.modelNumber,
        description: job.modelDescription ?? job.solutionName,
        isSolution: job.isSolution,
        integrationRackPartNumber: job.integrationRackPartNumber,
      }));
    this.page = model.page;
    await this.options.html?.step(this.page, 'Configuration workspace opened');
    this.components = new ComponentEngine(this.activePage, model.family, (label) => this.snapshot(label));
    this.currentStep = 'Verify Quotation Mode';
    console.log('[STEP] Verifying aaS quotation mode');
    result.quotationMode = await this.measure('Verify quotation mode', () => this.verifyQuotationMode());
    if (job.source.kind !== 'detailed-excel') throw new Error(`Unsupported configuration source: ${job.source.referenceType}`);
    const instructions = job.source.instructions;
    const executedInstructions = [] as typeof instructions;
    const useSolutionWizard = await this.shouldUseSolutionWizard(job);
    if (job.isStorage) {
      this.currentStep = 'Configure Storage model';
      const selections = await this.measure('Configure Storage model', () => new StorageFlow(this.activePage).configure());
      result.selectedComponents = selections.map((item) =>
        `${item.label}: ${item.productNumber || item.description} x${item.quantity}`).join('; ');
    } else if (useSolutionWizard) {
      this.currentStep = 'Configure Solution Wizard';
      const selections = await this.measure('Configure Solution Wizard', () =>
        new SolutionWizard(this.activePage).configure(instructions, job.server));
      result.selectedComponents = selections.map((item) => `${item.label}: ${item.text}`).join('; ');
    } else {
      this.currentStep = 'Show all component products';
      await this.measure('Show all component products', () => this.components.showAllProducts());
      for (const instruction of instructions) {
        const skipReason = await this.smartChassisSkipReason(instruction.section, model.generation);
        if (skipReason) {
          console.log(`[SKIP] Smart Chassis ${skipReason} (${job.modelNumber})`);
          continue;
        }
        this.currentStep = `Component ${instruction.sequence}: ${instruction.productNumber ?? instruction.section}`;
        console.log(`[STEP] ${this.currentStep}`);
        const exception = this.exceptions.find(instruction);
        await this.measure(this.currentStep, async () => {
          if (exception) await exception.execute(this, instruction);
          else await this.components.executeGeneric(instruction);
        });
        executedInstructions.push(instruction);
      }
      result.selectedComponents = executedInstructions.map((item) =>
        `${item.productNumber ?? item.configurationText ?? item.section}${item.quantity == null ? '' : ` x${item.quantity}`}`).join('; ');
    }

    this.currentStep = 'Resolve required configuration errors';
    await this.measure('Resolve required configuration errors', () => resolveConfigurationErrors(this.activePage, this.components));
    this.currentStep = 'Select Support Services';
    const support = await this.measure('Select Support Services', () => new SupportServices(this.activePage).select(job.serviceType));
    result.serviceExperience = support.serviceExperience;
    result.serviceTerm = support.term;
    result.dataPrivacy = support.dataPrivacy;
    result.selectedComponents += `${result.selectedComponents ? '; ' : ''}Support Services: ${support.serviceExperience}; Term: ${support.term}; Data Privacy: ${support.dataPrivacy}`;
    this.currentStep = 'Open BOM and Billing Tier Setup';
    console.log('[STEP] Opening BOM tab');
    await this.measure('Billing Tier Setup', () => new BillingTier(this.activePage).run());
    this.currentStep = 'Save OCA configuration';
    const save = await this.saveWithRequiredSelectionRecovery();
    result.ucid = save.ucid; result.ocaConfigStatus = save.status;
    if (job.generateEndBom) {
      this.currentStep = 'Generate and associate End BOM';
      const endBom = await this.measure('Generate and associate End BOM', () => new EndBom(this.activePage, (label) => this.snapshot(label)).generateAndAssociate());
      result.endBomStatus = endBom.status;
      result.startBomId = endBom.startBomId;
      result.endBomId = endBom.endBomId;
      result.endBomAssociated = endBom.associated ? 'Yes' : 'No';
      result.startBillingTier = endBom.startDetails.billingTier;
      result.startBillingTierCustomName = endBom.startDetails.billingTierCustomName;
      result.startAllocatedMemory = endBom.startDetails.allocatedMemory;
      result.startServerCount = endBom.startDetails.server;
      result.startUsedCpuCore = endBom.startDetails.usedCpuCore;
      result.endBillingTier = endBom.endDetails.billingTier;
      result.endBillingTierCustomName = endBom.endDetails.billingTierCustomName;
      result.endAllocatedMemory = endBom.endDetails.allocatedMemory;
      result.endServerCount = endBom.endDetails.server;
      result.endUsedCpuCore = endBom.endDetails.usedCpuCore;
    }
    result.executionStatus = 'Success';
    result.endTime = new Date().toISOString();
    result.duration = Date.parse(result.endTime) - Date.parse(result.startTime);
    console.log(`[TIME] Job ${job.jobId} (${job.modelNumber}) completed in ${this.formatDuration(Date.now() - jobStartedAt)}`);
    return result;
  }

  /** Why a Smart Chassis instruction does not apply to this model, or '' when it does. */
  private async smartChassisSkipReason(section: string, generation: ServerGeneration): Promise<string> {
    if (!/^smart\s*chassis$/i.test(section.trim())) return '';
    if (generation === 11) return 'is not applicable to Gen11 models';
    if (!await hasSmartChassisSection(this.activePage)) return 'section is not offered for this model';
    return '';
  }

  private async saveWithRequiredSelectionRecovery() {
    try {
      return await this.measure('Save OCA configuration', () => new SaveFlow(this.activePage).save());
    } catch (error) {
      if (!(error instanceof SaveRecoveryRequiredError)) throw error;
      console.log(`[WARN] ${error.message}`);
      this.currentStep = 'Recover required Menu selections before Save';
      await this.measure('Recover required Menu selections before Save', () =>
        recoverRequiredMenuSelections(this.activePage, this.components));
      this.currentStep = 'Refresh Billing Tier Setup after Menu recovery';
      console.log('[STEP] Reopening BOM after required Menu selections were repaired');
      await this.measure('Refresh Billing Tier Setup after Menu recovery', () => new BillingTier(this.activePage).run());
      this.currentStep = 'Retry Save OCA configuration';
      return await this.measure('Retry Save OCA configuration', () => new SaveFlow(this.activePage).save());
    }
  }

  private async shouldUseSolutionWizard(job: OcaJob): Promise<boolean> {
    if (job.isSolution) return true;
    const solutionTab = this.activePage.locator('a[href="#extended_overview_solutionWizard"]')
      .or(this.activePage.getByRole('link', { name: /Solution Wizard/i })).filter({ visible: true }).first();
    const menuSections = this.activePage.locator('[id^="section_header_"]').filter({ visible: true });
    const hasSolutionTab = await solutionTab.isVisible({ timeout: 2_000 }).catch(() => false);
    const hasMenuSections = await menuSections.count() > 0;
    if (hasSolutionTab && !hasMenuSections) {
      console.log('[WARN] Excel Solution flag was not detected, but this is a Solution Wizard-only workspace; using Solution Wizard');
      return true;
    }
    return false;
  }

  /** Mid-step diagnostic capture of the active page (no-op when HTML capture is off). */
  private async snapshot(label: string): Promise<void> {
    await this.options.html?.diagnostic(this.page, label);
  }

  private async measure<T>(label: string, action: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const result = await action().finally(() => {
      console.log(`[TIME] ${label}: ${this.formatDuration(Date.now() - startedAt)}`);
    });
    await this.options.html?.step(this.page, label);
    return result;
  }

  private formatDuration(milliseconds: number): string {
    if (milliseconds < 1_000) return `${milliseconds} ms`;
    const seconds = milliseconds / 1_000;
    if (seconds < 60) return `${seconds.toFixed(1)} s`;
    return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
  }

  private async openOca(): Promise<void> {
    const openPages = this.context.pages().filter((page) => !page.isClosed());
    const candidate = openPages[0] ?? await this.context.newPage();
    // Customize opens each configuration in a new tab. Close the previous job's tabs
    // (its screenshot and trace are already captured) so a batch does not accumulate them.
    const previousTabs = openPages.slice(1);
    if (previousTabs.length) console.log(`[INFO] Closing ${previousTabs.length} tab(s) from the previous job`);
    for (const page of previousTabs) await page.close().catch(() => undefined);
    this.page = candidate;
    await this.page.goto(this.options.baseUrl, { waitUntil: 'domcontentloaded' });
    if (!this.authenticated) {
      console.log(`[INFO] Complete manual authentication if prompted (up to ${this.options.authWaitMs} ms)`);
      this.authenticated = true;
    }
    await waitForBlockingOverlay(this.page);
  }

  private async selectAasAndVerifyLanding(): Promise<void> {
    await selectAasMode(this.activePage, { landingWaitMs: this.options.authWaitMs });
  }

  private async verifyQuotationMode(): Promise<string> {
    await expect.poll(async () => {
      const body = ((await this.activePage.locator('body').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
      if (/Quotation Mode\s*:?\s*Buy\b/i.test(body)) throw new Error('Wrong configuration mode: OCA opened in Buy mode instead of aaS');
      return /Quotation Mode\s*:?\s*aaS(?:\s*\(IQ\))?/i.test(body);
    }, { timeout: 60_000, message: 'Quotation Mode aaS on the OCA configuration workspace' }).toBe(true);
    return 'aaS';
  }

}
