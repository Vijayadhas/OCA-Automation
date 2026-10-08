import { expect, test } from '@playwright/test';
import { recoverRequiredMenuSelections } from '../../src/automation/oca-engine';

test('returns to Components and resolves requirements revealed after a disabled Save', async ({ page }) => {
  await page.setContent(`<a href="#components" onclick="document.querySelector('#required').style.display='block'">Components</a>
    <div id="required" style="display:none"><div id="section_header_capacity">Capacity <i title="Error">!</i></div></div>`);
  const repaired: string[] = [];

  await recoverRequiredMenuSelections(page, {
    satisfyRequiredSection: async (section) => {
      repaired.push(section);
      await page.locator('[title="Error"]').evaluate((icon) => icon.remove());
    },
    satisfyVisibleRequiredControl: async () => false,
  });

  expect(repaired).toEqual(['Capacity']);
  await expect(page.locator('[title="Error"]')).toHaveCount(0);
});
