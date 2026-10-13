import { test, expect } from '@playwright/test';
import { resolveConfigurationErrors } from '../../src/automation/configuration-errors';
import { ComponentEngine } from '../../src/automation/component-engine';

test('resolves every marked section, including errors revealed by earlier selections', async ({ page }) => {
  await page.setContent('<div id="section_header_memory">Memory<span title="Error">!</span></div>');
  const resolved: string[] = [];
  await resolveConfigurationErrors(page, {
    satisfyRequiredSection: async (name) => {
      resolved.push(name);
      await page.locator('[title="Error"], .dqe-status-icon-14').evaluateAll((icons) => icons.forEach((icon) => icon.remove()));
      if (name === 'Memory') {
        await page.locator('body').evaluate((body) => body.insertAdjacentHTML('beforeend',
          '<div id="section_header_power">Power Supplies<span class="img-alert dqe-status-icon-14">!</span></div>'));
      }
    },
    satisfyVisibleRequiredControl: async () => false,
  });
  expect(resolved).toEqual(['Memory', 'Power Supplies']);
});

test('resolves a required dropdown outside component headers', async ({ page }) => {
  await page.setContent(`<span aria-label="Error">!</span><select onchange="document.querySelector('span').remove()">
    <option value="">Please make a selection</option><option value="required">Required choice</option></select>`);
  await resolveConfigurationErrors(page, new ComponentEngine(page));
  await expect(page.locator('select')).toHaveValue('required');
});

test('blocks progress when an error outside a header has no resolvable control', async ({ page }) => {
  await page.setContent('<span title="Error">!</span>');
  await expect(resolveConfigurationErrors(page, {
    satisfyRequiredSection: async () => undefined,
    satisfyVisibleRequiredControl: async () => false,
  })).rejects.toThrow('Cannot continue to Services while OCA error icons remain');
});

test('blocks progress when repeated repairs leave the error visible', async ({ page }) => {
  await page.setContent('<div id="section_header_power">Power Supplies<i title="Error">!</i></div>');
  let attempts = 0;
  await expect(resolveConfigurationErrors(page, {
    satisfyRequiredSection: async () => { attempts += 1; },
    satisfyVisibleRequiredControl: async () => false,
  })).rejects.toThrow('Power Supplies');
  expect(attempts).toBe(12);
});

test('accepts a repair that clears the error on the final allowed attempt', async ({ page }) => {
  await page.setContent('<div id="section_header_power">Power Supplies<i title="Error">!</i></div>');
  let attempts = 0;
  await resolveConfigurationErrors(page, {
    satisfyRequiredSection: async () => {
      if (++attempts === 12) await page.locator('i').evaluate((icon) => icon.remove());
    },
    satisfyVisibleRequiredControl: async () => false,
  });
  expect(attempts).toBe(12);
});

test('continues past OCA warnings and hidden alert icons', async ({ page }) => {
  // Markup from JOB-001 run 3: eight sections showed only Warning icons, and the run stopped on them.
  await page.setContent(`
    <table><tr class="section_header" id="section_header_ProcessorSection"><td><div class="section_header_div">
      <i class="img-warning dqe-status-icon-14" title="Warning"></i> Processor</div></td></tr>
    <tr class="section_header" id="section_header_temperatureSection"><td><div class="section_header_div">
      <i class="img-alert dqe-status-icon-14" style="visibility: hidden; pointer-events: none;"></i> Temperature</div></td></tr>
    <tr><td><i class="img-info dqe-status-icon-14">i</i></td></tr></table>`);
  const repaired: string[] = [];
  await resolveConfigurationErrors(page, {
    satisfyRequiredSection: async (name) => { repaired.push(name); },
    satisfyVisibleRequiredControl: async () => false,
  });
  expect(repaired).toEqual([]);
});
