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

// P86628-B21 (DL110 Gen12, 2026-10-18): the processor is part of the base server and OCA shows no
// Processor section, so there is nothing to select or check.
test('a model without a Processor section passes the check with nothing to select', async ({ page }) => {
  await page.setContent(menuSection({ key: 'memory', title: 'Memory', choices: [
    { id: 'memory_main', title: 'Memory', rows: [{ pid: 'DIMM-A', quantity: 1, select: [0, 1] }] },
  ] }));
  const engine = new ComponentEngine(page);
  expect(await engine.mandatorySelection('Processor')).toBeNull();
  expect(await engine.mandatorySelection('Memory')).toMatchObject({ productNumber: 'DIMM-A' });
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

// P72176-B21 (Nutanix, 2026-10-16): OCA preselects "HPE DDR4 DIMM Blank Kit" (P07818-B21) in the Memory
// section's "Memory Blank Kit" choice. A blank kit is not memory and must never satisfy the check,
// even when the Memory choice's rows are not counted (the choice is listed first by title otherwise).
test('a DIMM Blank Kit never counts as the Memory selection', async ({ page }) => {
  await page.setContent(menuSection({ key: 'mem', title: 'Memory', choices: [
    { id: 'mem_blank', title: 'Memory Blank Kit', rows: [{ pid: 'P07818-B21', description: 'HPE DDR4 DIMM Blank Kit', quantity: 1, select: [0, 1] }] },
    { id: 'mem_main', title: 'Memory', rows: [{ pid: 'P69728-F21', description: 'HPE 64GB (1x64GB) Dual Rank x4 DDR5-6400 Memory Kit', select: [0, 8, 16] }] },
  ] }));
  const engine = new ComponentEngine(page);
  expect((await engine.mainChoice({ key: 'mem', title: 'Memory' }))?.id).toBe('mem_main');
  expect(await engine.existingSelection('mem_blank')).toBeNull();
  await expect(engine.mandatorySelection('Memory')).rejects.toThrow('Memory is mandatory, but nothing is selected');
});

// P73285-B21 (DL380 Gen12, 2026-10-18): the first Services click was lost while OCA recalculated.
test('clicks the Services tab again when its panel does not appear', async ({ page }) => {
  await page.setContent(servicesPage(false)
    .replace('<a href="#services" role="link">', `<a href="#services" role="link" onclick="window.clicks = (window.clicks ?? 0) + 1;
      if (window.clicks > 1) document.getElementById('experience-and-term').style.display = 'block'">`)
    .replace('<div id="experience-and-term">', '<div id="experience-and-term" style="display:none">'));
  expect(await new SupportServices(page).select()).toMatchObject({ serviceExperience: 'Standard' });
  expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(2);
});

// S4R64A (DL380 Gen11, 2026-10-19): "(OCA) has encountered a problem" stayed open over the Services tab.
test('closes OCA problem dialog before clicking the Services tab', async ({ page }) => {
  await page.setContent(servicesPage(false)
    .replace('<a href="#services" role="link">', `<a href="#services" role="link" onclick="
      if (getComputedStyle(problem).display === 'none') document.getElementById('experience-and-term').style.display = 'block'">`)
    .replace('<div id="experience-and-term">', `<div id="problem" class="ui-dialog" role="dialog">
      <span class="ui-dialog-title">(OCA) has encountered a problem</span>
      <button class="ui-dialog-titlebar-close" onclick="problem.style.display='none'">x</button></div>
      <div id="experience-and-term" style="display:none">`));
  expect(await new SupportServices(page).select()).toMatchObject({ serviceExperience: 'Standard' });
  await expect(page.locator('#problem')).toBeHidden();
});
