import { test, expect } from '@playwright/test';
import { ALLOWED_SERVICE_EXPERIENCE_VALUES, SupportServices } from '../../src/automation/support-services';

test('restricts random Support Service experience to approved values', () => {
  expect([...ALLOWED_SERVICE_EXPERIENCE_VALUES]).toEqual(['MBYS', 'Entry', 'Standard', 'Custom']);
});

// Services as OCA shows them (#experience-and-term, radio .option-wrapper groups); "Enable only lite" as recorded
// for HPE Synergy frames (a label with a span; its checkbox markup is not captured yet).
const services = `<a href="#" role="link">Services</a><div id="experience-and-term"><h3>Support Services</h3>
  ${[['service-experience', ['Lite', 'MBYS', 'Standard']], ['term', ['5 Years']], ['data-privacy-service', ['None/Manual']]]
    .map(([id, values]) => `<div id="${id}">${(values as string[]).map((value) => `<div class="option-wrapper">
      <input type="radio" name="${id}" id="${id}_${value}" value="${value}"><label class="option-label" for="${id}_${value}">${value}</label></div>`).join('')}</div>`).join('')}
  <label><input type="checkbox" id="onlyLite"><span>Enable only lite</span></label></div>`;

test('Excel Service Type Lite selects Lite and ticks "Enable only lite"', async ({ page }) => {
  await page.setContent(services);
  const selection = await new SupportServices(page).select('Lite');
  expect(selection.serviceExperience).toBe('Lite');
  await expect(page.locator('#service-experience_Lite')).toBeChecked();
  await expect(page.locator('#onlyLite')).toBeChecked();
});

test('a random Service experience is never Lite and leaves "Enable only lite" alone', async ({ page }) => {
  await page.setContent(services);
  const selection = await new SupportServices(page).select('Random');
  expect(['MBYS', 'Standard']).toContain(selection.serviceExperience);
  await expect(page.locator('#onlyLite')).not.toBeChecked();
});
