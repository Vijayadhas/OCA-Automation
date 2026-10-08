import { expect, test } from '@playwright/test';
import { openDhciDriveEnclosure } from '../../src/automation/solution-wizard';

test('opens Drive Enclosure so OCA can apply controller-chassis dependencies', async ({ page }) => {
  await page.setContent(`<button id="section_header_driveEnclosureSection" aria-expanded="false"
    onclick="this.setAttribute('aria-expanded','true'); this.querySelector('[title=Error]').remove()">
    Drive Enclosure <i title="Error">!</i>
  </button>`);

  await openDhciDriveEnclosure(page);

  await expect(page.locator('#section_header_driveEnclosureSection')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[title="Error"]')).toHaveCount(0);
});

test('does not collapse an already-open Drive Enclosure section', async ({ page }) => {
  await page.setContent(`<button id="section_header_driveEnclosureSection" aria-expanded="true"
    onclick="this.setAttribute('aria-expanded','false')">Drive Enclosure</button>`);

  await openDhciDriveEnclosure(page);

  await expect(page.locator('#section_header_driveEnclosureSection')).toHaveAttribute('aria-expanded', 'true');
});
