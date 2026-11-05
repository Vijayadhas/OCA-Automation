import { resolveConfigurationErrors, type ResolveOptions } from './configuration-errors';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { countryFor, customerAccountFor, isFrameSolution, searchDescriptionFor, serviceTypeFor, type OcaJob } from '../models/job';
import { CustomerAccount } from './customer-account';
import { Country } from './country';
import type { AutomationResult } from '../models/automation-result';
import { createPendingResult } from '../models/automation-result';
import { waitForBlockingOverlay } from '../core/waits';
import { safeClick } from '../core/interactions';
import { ModelSearch } from './model-search';
import { CONFIGURE_TO_ORDER, ComponentEngine, type ExecutionOutcome } from './component-engine';
import { isBrowserClosedError, MandatorySelectionError } from '../core/errors';
import { ConfigurationNavigation, partOfKey } from './configuration-navigation';
import { getErrorMessage } from '../core/excel';
import type { ComponentInstruction } from '../models/component-instruction';
import { BillingTier } from './billing-tier';
import { SaveFlow, SaveRecoveryRequiredError } from './save-flow';
import { EndBom } from './end-bom';
import { SupportServices } from './support-services';
import { SolutionWizard } from './solution-wizard';
import { StorageFlow } from './storage-flow';
import { selectAasModeWithReload } from './quotation-mode';
import type { HtmlCapture } from '../reporting/html-capture';

export interface OcaEngineOptions { baseUrl: string; authWaitMs: number; expectedPageText: string; html?: HtmlCapture; }

export async function recoverRequiredMenuSelections(
  page: Page,
  components: Pick<ComponentEngine, 'satisfyRequiredSection' | 'satisfyVisibleRequiredControl'>,
  options: ResolveOptions = {},
): Promise<void> {
  const menu = page.locator('a[href="#extended_overview_menu"]')
    .or(page.getByRole('link', { name: /^Menu$/i }))
    .or(page.getByRole('link', { name: /^Components$/i }))
    .filter({ visible: true }).first();
  await expect(menu, 'Menu or Components tab for Save recovery').toBeVisible({ timeout: 30_000 });
  console.log('[STEP] Returning to Menu to resolve selections that disabled Save');
  await safeClick(menu);
  await waitForBlockingOverlay(page);
  await resolveConfigurationErrors(page, components, options);
}

/**
 * Menu sections every server configuration must have a selection in before Save. Only their
 * error icons are repaired; OCA's other error icons are logged and left as they are.
 */
const MANDATORY_SECTIONS = ['Processor', 'Memory'];
const MANDATORY_ONLY: ResolveOptions = { mandatorySections: MANDATORY_SECTIONS };

/** A multi-frame solution's description or level names frames ("HPE Synergy 4 Frame Solution"). */
const FRAME = /\bframe\b/i;

/**
 * The frames of a multi-frame solution other than frame 1, in tree order. Captured on P06011-B21 (4 Frame,
 * 2026-11-05): under "Addons for Synergy 4 Frame #1 Group" each frame is keyed by the solution's own part number
 * (|…|instance_2_GROUP|P06011-B21_1, _5, _7, _3: Master 1, Master 2, Satellite 1, Satellite 2) and described
 * "(HPE Synergy 12000 Configure-to-order Frame with 10x Fans)"; each frame's parts ("4-port Frame Link Module #1")
 * sit below it and are not frames. Frame 1 is the frame above the server already configured.
 */
export function otherFrames<T extends { key: string; label: string; description: string }>(
  entries: T[], modelNumber: string, solutionLevel: string, frameOneServers: string[],
): T[] {
  const model = modelNumber.trim().toUpperCase();
  return entries.filter((entry) => (partOfKey(entry.key) === model
      || (CONFIGURE_TO_ORDER.test(entry.description) && FRAME.test(entry.description)))
    && entry.label !== solutionLevel && !frameOneServers.includes(entry.key)
    && !frameOneServers.some((key) => entry.key && key.startsWith(`${entry.key}|`)));
}

/**
 * The components set on frame 1's server, as instructions that set the same products and quantities on
 * another frame's server. A component left to OCA (default, configuration text) is kept as it was.
 */
export function copyOfSelections(executed: ComponentInstruction[]): ComponentInstruction[] {
  return executed.map((instruction) => instruction.productNumber && instruction.quantity != null
    && ['random', 'quantity', 'radio', 'automatic'].includes(instruction.selectionType)
    ? { ...instruction, selectionType: 'quantity' as const }
    : { ...instruction });
}

export class OcaEngine {
  private page?: Page;
  components!: ComponentEngine;
  currentStep = 'Initialize';
  private resolveOptions: ResolveOptions = MANDATORY_ONLY;
  private authenticated = false;

  constructor(private context: BrowserContext, private readonly options: OcaEngineOptions) {}

  /** Continues in a relaunched browser after the previous one closed or crashed. */
  useContext(context: BrowserContext): void {
    if (context === this.context) return;
    this.context = context;
    this.page = undefined;
    this.authenticated = false;
  }

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
    // Customer Account stays set in OCA between models, so each model sets its own or clears it.
    // Country: the Excel value, else the Model Type preset's (Arcus EMEA: Saudi Arabia), else OCA's default, United States.
    this.currentStep = 'Set Country';
    await this.measure('Set Country', () => new Country(this.activePage).apply(countryFor(job)));
    this.currentStep = 'Set Customer Account';
    await this.measure('Set Customer Account', () => new CustomerAccount(this.activePage).apply(customerAccountFor(job)));
    this.currentStep = 'Search model';
    const basicRoute = job.isStorage ? 'Storage' : job.isSolution ? 'Solution' : 'Server';
    const route = job.modelType && job.modelType !== basicRoute ? `${job.modelType} (${basicRoute} route)` : basicRoute;
    const description = searchDescriptionFor(job);
    console.log(`[INFO] Excel model selection: model type=${job.modelType ? route : `<blank>, treated as ${route}`}; description=${description ?? '<blank>'}; customer account=${customerAccountFor(job) || '<none>'}; country=${countryFor(job) ?? '<blank>, OCA default'}; integration rack=${job.integrationRackPartNumber ?? '<blank>'}`);
    const model = await this.measure('Search and open model', () =>
      new ModelSearch(this.context).searchAndOpen(this.activePage, {
        modelNumber: job.modelNumber,
        description,
        isSolution: job.isSolution,
        integrationRackPartNumber: job.integrationRackPartNumber,
      }));
    this.page = model.page;
    await this.options.html?.step(this.page, 'Configuration workspace opened');
    this.components = new ComponentEngine(this.activePage, (label) => this.snapshot(label));
    this.currentStep = 'Verify Quotation Mode';
    console.log('[STEP] Verifying aaS quotation mode');
    result.quotationMode = await this.measure('Verify quotation mode', () => this.verifyQuotationMode());
    if (job.source.kind !== 'detailed-excel') throw new Error(`Unsupported configuration source: ${job.source.referenceType}`);
    // Copies: random picks are written onto each instruction, and a rule-conflict retry must
    // start again from the Excel rows, not from the previous attempt's picks.
    const instructions = job.source.instructions.map((instruction) => ({ ...instruction }));
    const useSolutionWizard = await this.shouldUseSolutionWizard(job);
    const useStorageFlow = job.isStorage && await this.shouldUseStorageFlow(job);
    let frameSolution = false;
    if (useStorageFlow) {
      // As recorded for S1F24A (2026-10-28): all products are shown before Capacity is picked.
      this.currentStep = 'Show all component products';
      await this.measure('Show all component products', () => this.components.showAllProducts());
      this.currentStep = 'Configure Storage model';
      const selections = await this.measure('Configure Storage model', () => new StorageFlow(this.activePage).configure());
      result.selectedComponents = selections.map((item) =>
        `${item.label}: ${item.productNumber || item.description} x${item.quantity}`).join('; ');
      // User, 2026-11-02: a storage model (not a wizard) with a Storage Devices section gets an HDD and an SSD
      // before Services and End BOM.
      this.currentStep = 'Storage Devices';
      const drives = await this.measure('Storage Devices', () => this.components.selectStorageDrives());
      if (drives.length) {
        result.selectedComponents += `; ${drives.map((item) => `Storage Devices ${item.kind}: ${item.productNumber} x${item.quantity}`).join('; ')}`;
        await this.options.html?.step(this.activePage, 'Storage Devices');
      }
    } else if (useSolutionWizard) {
      this.currentStep = 'Configure Solution Wizard';
      const selections = await this.measure('Configure Solution Wizard', () =>
        new SolutionWizard(this.activePage).configure(instructions, job.server));
      result.selectedComponents = selections.map((item) => `${item.label}: ${item.text}`).join('; ');
      await this.options.html?.step(this.activePage, 'Solution Wizard configured');
      // dHCI solutions (S3V83A) hold their servers as separate configurations; Processor and Memory are set there.
      const serverModel = selections.find((item) => /^Server Model$/i.test(item.label));
      if (serverModel) {
        const servers = await this.configureSolutionServers(job, instructions, serverModel.text);
        result.selectedComponents += `${result.selectedComponents ? '; ' : ''}${servers}`;
      }
    } else if (isFrameSolution(job) || await this.looksLikeFrameSolution(job)) {
      frameSolution = true;
      result.selectedComponents = await this.configureFrameSolution(job, instructions);
    } else {
      result.selectedComponents = await this.configureMenuComponents(job, instructions);
    }

    this.currentStep = 'Resolve required configuration errors';
    // Storage has no Processor or Memory; its required sections (Capacity) are all repaired.
    this.resolveOptions = useStorageFlow ? {} : MANDATORY_ONLY;
    await this.measure('Resolve required configuration errors', () => resolveConfigurationErrors(this.activePage, this.components, this.resolveOptions));
    if (!useStorageFlow && !useSolutionWizard) {
      // Processor and Memory are mandatory: without them the configuration is not saved and no End BOM is made.
      this.currentStep = 'Check mandatory Processor and Memory';
      for (const section of MANDATORY_SECTIONS) await this.components.mandatorySelection(section);
    }
    this.currentStep = 'Select Support Services';
    const support = await this.measure('Select Support Services', () => new SupportServices(this.activePage).select(serviceTypeFor(frameSolution ? { ...job, modelType: job.modelType || 'Synergy Frame' } : job)));
    result.serviceExperience = support.serviceExperience;
    result.serviceTerm = support.term;
    result.dataPrivacy = support.dataPrivacy;
    result.selectedComponents += `${result.selectedComponents ? '; ' : ''}Support Services: ${support.serviceExperience}; Term: ${support.term}; Data Privacy: ${support.dataPrivacy}`;
    this.currentStep = 'Open BOM and Billing Tier Setup';
    console.log('[STEP] Opening BOM tab');
    await this.measure('Billing Tier Setup', () => new BillingTier(this.activePage, (label) => this.snapshot(label)).run());
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
      result.bomTiers = endBom.tiers;
    }
    result.executionStatus = 'Success';
    result.endTime = new Date().toISOString();
    result.duration = Date.parse(result.endTime) - Date.parse(result.startTime);
    console.log(`[TIME] Job ${job.jobId} (${job.modelNumber}) completed in ${this.formatDuration(Date.now() - jobStartedAt)}`);
    return result;
  }

  /**
   * Sets the Menu components of the configuration on screen (a server, or a server inside a
   * solution) and returns the summary for Selected Components.
   */
  private async configureMenuComponents(
    job: OcaJob, instructions: ComponentInstruction[], executedInstructions: ComponentInstruction[] = [],
  ): Promise<string> {
    // Components that could not be set as asked, reported with the results.
    const substitutions: string[] = [];
    this.currentStep = 'Load Menu sections';
    await this.measure('Load Menu sections', () => this.components.ensureMenuLoaded());
    this.currentStep = 'Show all component products';
    await this.measure('Show all component products', () => this.components.showAllProducts());
    for (const instruction of instructions) {
      this.currentStep = `Component ${instruction.sequence}: ${instruction.productNumber ?? instruction.section}`;
      console.log(`[STEP] ${this.currentStep}`);
      let outcome: ExecutionOutcome;
      try {
        outcome = await this.measure(this.currentStep, () => this.components.executeGeneric(instruction));
      } catch (error) {
        if (isBrowserClosedError(error)) throw error;
        if (!await this.recoverComponent(instruction, error, substitutions)) continue;
        outcome = 'done';
      }
      if (outcome === 'skipped') {
        const ignored = instruction.selectionType === 'random' || instruction.selectionType === 'default'
          ? '' : `; ${instruction.selectionType} ${instruction.productNumber ?? instruction.configurationText ?? ''} was not applied`;
        console.log(`[SKIP] ${instruction.section} section is not offered for ${job.modelNumber}${ignored}`);
        continue;
      }
      executedInstructions.push(instruction);
    }
    let summary = executedInstructions.map((item) =>
      `${item.productNumber ?? item.configurationText ?? item.section}${item.quantity == null ? '' : ` x${item.quantity}`}`).join('; ');
    if (substitutions.length) summary += `; Changed: ${substitutions.join('; ')}`;
    return summary;
  }

  /**
   * A multi-frame solution (HPE Synergy 2/3/4 Frame Solution, 2026-11-05 recording): each frame is a
   * configuration whose Menu offers servers (Configure-to-order compute modules); a server added there
   * becomes its own configuration, listed in OCA's navigation ("Synergy 480 Gen12 #1"), where its
   * Processor, Memory and Drive Cage are set. Frame 1 is the solution itself: it gets the Excel Server
   * (else a random Configure-to-order product) with random or Excel components. Every other frame in
   * the navigation (its name says Frame) gets the same server, with the same products and quantities.
   */
  private async configureFrameSolution(job: OcaJob, instructions: ComponentInstruction[]): Promise<string> {
    const navigation = new ConfigurationNavigation(this.activePage, (label) => this.snapshot(label));
    const solutionLevel = await navigation.currentLevel();
    this.currentStep = 'Load Menu sections';
    await this.measure('Load Menu sections', () => this.components.ensureMenuLoaded());
    this.currentStep = 'Show all component products';
    await this.measure('Show all component products', () => this.components.showAllProducts());
    this.currentStep = `Add a server to ${solutionLevel || 'frame 1'}`;
    const server = await this.measure(this.currentStep, () => this.components.addConfigureToOrderProduct(job.server));
    await this.options.html?.step(this.activePage, 'Frame 1 server added');

    // Each server's own configuration, once configured, is not configured again.
    const configured = new Set<string>();
    // By the part number in OCA's tree key; else by the server's description, which the tree shows in brackets.
    const newServers = async () => {
      const byPart = (await navigation.entriesForPart(server.productNumber)).filter((entry) => !configured.has(entry.key));
      if (byPart.length) return byPart;
      const wanted = server.description.replace(/\s+/g, ' ').trim().toLowerCase();
      return (await navigation.entries()).filter((entry) => !configured.has(entry.key) && wanted
        && entry.description.replace(/\s+/g, ' ').toLowerCase().includes(wanted));
    };
    // Frame 1's server: Excel components or random picks, plus a Drive Cage, as recorded.
    const firstInstructions = instructions.map((instruction) => ({ ...instruction }));
    if (!firstInstructions.some((instruction) => /^drive cage$/i.test(instruction.section.trim()))) {
      const sequence = Math.max(0, ...firstInstructions.map((instruction) => instruction.sequence)) + 10;
      firstInstructions.push({ jobId: job.jobId, section: 'Drive Cage', selectionType: 'random', sequence });
    }
    // Asserted so TypeScript keeps the union: it is assigned inside configureServers.
    let copy = null as ComponentInstruction[] | null;
    const summaries: string[] = [`${solutionLevel || 'Frame 1'}: ${server.productNumber} x${server.quantity}`];
    const configureServers = async (frame: string) => {
      this.currentStep = `Find the server added to ${frame}`;
      const entries = await this.measure(this.currentStep, () => newServers());
      if (!entries.length) {
        throw new MandatorySelectionError(`Server ${server.productNumber} was added to ${frame}, but its configuration was not found in OCA's `
          + 'navigation; Processor and Memory could not be set and the configuration was not saved');
      }
      for (const entry of entries) {
        this.currentStep = `Open ${entry.label}`;
        await this.measure(this.currentStep, () => navigation.open(entry));
        await this.showMenuTab();
        const executed: ComponentInstruction[] = [];
        const summary = await this.configureMenuComponents(job, (copy ?? firstInstructions).map((instruction) => ({ ...instruction })), executed);
        this.currentStep = `Resolve required configuration errors in ${entry.label}`;
        await this.measure(this.currentStep, () => resolveConfigurationErrors(this.activePage, this.components, MANDATORY_ONLY));
        this.currentStep = `Check mandatory Processor and Memory in ${entry.label}`;
        for (const section of MANDATORY_SECTIONS) await this.components.mandatorySelection(section);
        configured.add(entry.key);
        // Frame 1's picks, by product and quantity, are what every other frame's server gets.
        copy ??= copyOfSelections(executed);
        summaries.push(`${entry.label}: ${summary}`);
      }
    };
    await configureServers(solutionLevel || 'frame 1');
    this.currentStep = `Return to ${solutionLevel || 'the solution'}`;
    await this.measure(this.currentStep, () => navigation.returnTo(solutionLevel));

    this.currentStep = 'Find the other frames';
    // OCA's tree keys are paths ("|…|frame|server_1"): frame 1 is every entry above its own server.
    const frameOneServers = [...configured];
    const frames = otherFrames(await navigation.entries(), job.modelNumber, solutionLevel, frameOneServers);
    console.log(`[STEP] Other frames (${frames.length}): ${frames.map((entry) => entry.label).join(', ') || 'none'}`);
    if (copy) console.log(`[INFO] Each frame gets ${server.productNumber} x${server.quantity} with ${copy.map((item) =>
      `${item.section} ${item.productNumber ?? item.configurationText ?? ''}${item.quantity == null ? '' : ` x${item.quantity}`}`).join(', ')}`);
    for (const frame of frames) {
      this.currentStep = `Open ${frame.label}`;
      await this.measure(this.currentStep, () => navigation.open(frame));
      if (await navigation.currentLevel() === solutionLevel) {
        console.log(`[SKIP] ${frame.label} is the solution itself (frame 1)`);
        continue;
      }
      await this.showMenuTab();
      await this.components.ensureMenuLoaded();
      if (!await this.components.findSection(server.sectionTitle)) {
        console.log(`[SKIP] ${frame.label} offers no ${server.sectionTitle} section; no server added there`);
        await navigation.returnTo(solutionLevel);
        continue;
      }
      this.currentStep = `Add ${server.productNumber} to ${frame.label}`;
      await this.measure(this.currentStep, () => this.components.addProductInSection(server.sectionTitle, server.productNumber, server.quantity));
      summaries.push(`${frame.label}: ${server.productNumber} x${server.quantity}`);
      await configureServers(frame.label);
      this.currentStep = `Return to ${solutionLevel || 'the solution'}`;
      await this.measure(this.currentStep, () => navigation.returnTo(solutionLevel));
    }
    // Services and BOM at the top level, as recorded (frame 1 is one level below it).
    this.currentStep = 'Open the top level';
    await this.measure(this.currentStep, () => navigation.openTop());
    await this.showMenuTab();
    return summaries.join('; ');
  }

  /**
   * Model Type left blank (run of 2026-11-05: "HPE Synergy 2 Frame Solution" then went the Server route and
   * failed at Billing Tier with no servers added). A frame solution is recognised when its Menu has no
   * Processor section, offers Configure-to-order products, and the description or the open level says Frame.
   */
  private async looksLikeFrameSolution(job: OcaJob): Promise<boolean> {
    if (job.modelType) return false;
    const level = await new ConfigurationNavigation(this.activePage).currentLevel();
    if (!FRAME.test(`${searchDescriptionFor(job) ?? ''} ${level}`)) return false;
    if (await this.components.findSection('Processor').catch(() => null)) return false;
    const descriptions = await this.activePage.locator('tr.item_tr .item_desc').allTextContents().catch(() => [] as string[]);
    if (!descriptions.some((text) => CONFIGURE_TO_ORDER.test(text))) return false;
    console.log(`[INFO] Model Type is blank, but ${job.modelNumber} (${level}) is a frame solution: no Processor section, `
      + 'Configure-to-order servers offered; using the Synergy Frame route (set Model Type to Synergy Frame)');
    return true;
  }

  /** Shows the Menu tab of the open configuration (a frame or server opened from the navigation can show Summary). */
  private async showMenuTab(): Promise<void> {
    const menu = this.activePage.locator('a[href="#extended_overview_menu"]').or(this.activePage.getByRole('link', { name: /^Menu$/i }))
      .filter({ visible: true }).first();
    if (!await menu.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const components = this.activePage.getByRole('link', { name: /^Components$/i }).filter({ visible: true }).first();
      if (!await components.isVisible({ timeout: 2_000 }).catch(() => false)) return;
      await safeClick(components);
      await waitForBlockingOverlay(this.activePage);
      if (!await menu.isVisible({ timeout: 5_000 }).catch(() => false)) return;
    }
    await safeClick(menu);
    await waitForBlockingOverlay(this.activePage);
  }

  /**
   * A dHCI solution (S3V83A) puts each server picked in its Solution Wizard ("(P54202-B21)HPE DL325
   * Gen11 GPU CTO Svr") into its own configuration, listed in OCA's full navigation as "HPE DL325 Gen11
   * GPU CTO Svr #1". Processor and Memory are mandatory and live there, so each one is opened and
   * configured like a single server, checked, and the solution level is opened again.
   */
  private async configureSolutionServers(job: OcaJob, instructions: ComponentInstruction[], serverModel: string): Promise<string> {
    const navigation = new ConfigurationNavigation(this.activePage, (label) => this.snapshot(label));
    const solutionLevel = await navigation.currentLevel();
    // "(P53921-B21#GTA) HPE DL385 Gen11 8SFF CTO Svr": the part number names the server in OCA's tree.
    const partNumber = serverModel.match(/^\s*\(([^)]+)\)/)?.[1]?.trim() ?? '';
    this.currentStep = 'Find servers inside the solution';
    const entries = partNumber ? await this.measure(this.currentStep, () => navigation.entriesForPart(partNumber)) : [];
    if (!entries.length) {
      throw new MandatorySelectionError(`Processor and Memory are mandatory, but the server picked in the Solution Wizard (${serverModel}) `
        + 'was not found in the solution\'s navigation; the configuration was not saved');
    }
    console.log(`[STEP] Servers inside the solution (${entries.length}): ${entries.map((entry) => entry.label).join(', ')}`);
    const summaries: string[] = [];
    for (const entry of entries) {
      this.currentStep = `Open ${entry.label}`;
      await this.measure(this.currentStep, () => navigation.open(entry));
      // Fresh copies: random picks are written onto each instruction.
      const summary = await this.configureMenuComponents(job, instructions.map((instruction) => ({ ...instruction })));
      this.currentStep = `Resolve required configuration errors in ${entry.label}`;
      await this.measure(this.currentStep, () => resolveConfigurationErrors(this.activePage, this.components, MANDATORY_ONLY));
      this.currentStep = `Check mandatory Processor and Memory in ${entry.label}`;
      for (const section of MANDATORY_SECTIONS) await this.components.mandatorySelection(section);
      summaries.push(`${entry.label}: ${summary}`);
      this.currentStep = `Return to ${solutionLevel || 'the solution'}`;
      await this.measure(this.currentStep, () => navigation.returnTo(solutionLevel));
    }
    return summaries.join('; ');
  }

  private async saveWithRequiredSelectionRecovery() {
    try {
      return await this.measure('Save OCA configuration', () => new SaveFlow(this.activePage).save());
    } catch (error) {
      if (!(error instanceof SaveRecoveryRequiredError)) throw error;
      console.log(`[WARN] ${error.message}`);
      this.currentStep = 'Recover required Menu selections before Save';
      await this.measure('Recover required Menu selections before Save', () =>
        recoverRequiredMenuSelections(this.activePage, this.components, this.resolveOptions));
      this.currentStep = 'Refresh Billing Tier Setup after Menu recovery';
      console.log('[STEP] Reopening BOM after required Menu selections were repaired');
      await this.measure('Refresh Billing Tier Setup after Menu recovery', () => new BillingTier(this.activePage, (label) => this.snapshot(label)).run());
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
      console.log(job.modelType
        ? `[WARN] Model Type is ${job.modelType}, but OCA opened a Solution Wizard-only workspace; using Solution Wizard (set Model Type to Solution)`
        : '[INFO] Model Type is blank and OCA opened a Solution Wizard-only workspace; using Solution Wizard');
      return true;
    }
    return false;
  }

  /**
   * A Storage model's Menu starts with Cloud Connectivity. S2U63A (DL380 Gen11 Data Solutions) was entered
   * as Storage but OCA opened a server Menu (Processors, Memory Kits, Storage, …) with no Cloud
   * Connectivity, so the storage flow failed after 30 s. Such a model takes the Server route instead.
   */
  private async shouldUseStorageFlow(job: OcaJob): Promise<boolean> {
    const cloudConnectivity = this.activePage.getByText(/Cloud Connectivity/i).filter({ visible: true }).first();
    if (await cloudConnectivity.isVisible({ timeout: 10_000 }).catch(() => false)) return true;
    if (!await this.components.findSection('Processor').catch(() => null)) return true;
    console.log(`[WARN] Model Type is Storage, but OCA opened a server Menu for ${job.modelNumber} (Processor section, no Cloud Connectivity); `
      + 'using the Server route (set Model Type to Server)');
    return false;
  }

  /** Mid-step diagnostic capture of the active page (no-op when HTML capture is off). */
  private async snapshot(label: string): Promise<void> {
    await this.options.html?.diagnostic(this.page, label);
  }

  /**
   * A component that could not be set does not fail the model. A product given in Excel is
   * replaced by another option of its section; otherwise the component is left to OCA, whose
   * error checks (resolveConfigurationErrors) still fill or reject a required section.
   * Returns true when another option was selected.
   */
  private async recoverComponent(instruction: ComponentInstruction, error: unknown, substitutions: string[]): Promise<boolean> {
    const reason = getErrorMessage(error).split('\n')[0];
    const asked = instruction.productNumber ?? instruction.configurationText ?? instruction.selectionType;
    // Close a menu or dialog the failed attempt may have left open.
    await this.activePage.keyboard.press('Escape').catch(() => undefined);
    await waitForBlockingOverlay(this.activePage);
    if (instruction.selectionType === 'quantity' || instruction.selectionType === 'radio') {
      console.log(`[WARN] ${instruction.section} ${asked} could not be selected (${reason}); trying another ${instruction.section} option`);
      try {
        const selected = await this.components.selectRandom(instruction.section);
        substitutions.push(`${instruction.section} ${selected.productNumber} x${selected.quantity} instead of ${asked}`);
        instruction.productNumber = selected.productNumber;
        instruction.quantity = selected.quantity;
        instruction.description = selected.description || instruction.description;
        return true;
      } catch (fallbackError) {
        if (isBrowserClosedError(fallbackError)) throw fallbackError;
        await this.activePage.keyboard.press('Escape').catch(() => undefined);
        await waitForBlockingOverlay(this.activePage);
        console.log(`[WARN] No other ${instruction.section} option could be selected: ${getErrorMessage(fallbackError).split('\n')[0]}`);
      }
    }
    console.log(`[WARN] Leaving ${instruction.section} (${asked}) to OCA: ${reason}`);
    substitutions.push(`${instruction.section} not set (${asked}: ${reason})`);
    return false;
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
    await selectAasModeWithReload(this.activePage, { landingWaitMs: this.options.authWaitMs });
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
