import { test, expect } from '@playwright/test';
import { ComponentEngine } from '../../src/automation/component-engine';
import { SupportServices } from '../../src/automation/support-services';
import { MandatorySelectionError } from '../../src/core/errors';
import { menuSection } from './oca-menu-fixture';

// Requirement (project lead, 2026-10-15): Processor, Memory, and Support Services are mandatory;
// without them the configuration must not be saved and no End BOM made.
const menu = (processorQuantity: number) =>
  menuSection({ key: 'cpu', title: 'Processor', choices: [
    { id: 'cpu_main', title: 'Processor', rows: [{ pid: 'CPU-A', quantity: processorQuantity, select: [0, 1, 2] }] },
  ] })
  + menuSection({ key: 'mem', title: 'Memory', collapsed: true, choices: [
    { id: 'mem_main', title: 'Memory', rows: [{ pid: 'DIMM-A', quantity: 2, select: [0, 2, 4] }] },
  ] });

test('returns the selected Processor and Memory', async ({ page }) => {
  await page.setContent(menu(1));
  const engine = new ComponentEngine(page);
  expect(await engine.mandatorySelection('Processor')).toMatchObject({ productNumber: 'CPU-A', quantity: 1 });
  expect(await engine.mandatorySelection('Memory')).toMatchObject({ productNumber: 'DIMM-A', quantity: 2 });
});

test('fails before Save when no Processor is selected', async ({ page }) => {
  await page.setContent(menu(0));
  const error = await new ComponentEngine(page).mandatorySelection('Processor').catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MandatorySelectionError);
  expect(String(error)).toContain('Processor is mandatory, but nothing is selected');
});

test('fails before Save when the model has no Memory section', async ({ page }) => {
  await page.setContent(menuSection({ key: 'cpu', title: 'Processor', choices: [
    { id: 'cpu_main', title: 'Processor', rows: [{ pid: 'CPU-A', quantity: 1, select: [0, 1] }] },
  ] }));
  await expect(new ComponentEngine(page).mandatorySelection('Memory')).rejects.toThrow(/Memory is mandatory, but the Memory section was not found/);
});

// The Services tab structure SupportServices already relies on (#experience-and-term, option groups).
const group = (id: string, values: string[]) => `<div id="${id}">${values.map((value) => `<div class="option-wrapper">
  <input type="radio" name="${id}" id="${id}-${value}" value="${value}"><label class="option-label" for="${id}-${value}">${value}</label></div>`).join('')}</div>`;
const servicesPage = (clearExperienceOnTerm: boolean) => `<a href="#services" role="link">Services</a>
  <div id="experience-and-term"><h3>Support Services</h3>
    ${group('service-experience', ['Standard'])}${group('term', ['3', '5'])}${group('data-privacy-service', ['No', 'Yes'])}</div>
  <script>${clearExperienceOnTerm
    ? `document.querySelectorAll('#term input').forEach((input) => input.addEventListener('change', () => {
        document.querySelectorAll('#service-experience input').forEach((other) => { other.checked = false; }); }));`
    : ''}</script>`;

test('Support Services pass when experience, term, and data privacy stay selected', async ({ page }) => {
  await page.setContent(servicesPage(false));
  expect(await new SupportServices(page).select()).toMatchObject({ serviceExperience: 'Standard' });
});

test('fails before Save when OCA clears a Support Services choice', async ({ page }) => {
  await page.setContent(servicesPage(true));
  const error = await new SupportServices(page).select().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MandatorySelectionError);
  expect(String(error)).toContain('Service experience is not selected');
});
