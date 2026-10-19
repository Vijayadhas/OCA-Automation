import { expect, test } from '@playwright/test';
import { SaveFlow, SaveRecoveryRequiredError, savedUcid } from '../../src/automation/save-flow';

test('uses a real label click and confirms Save from the End BOM action', async ({ page }) => {
  await page.setContent(`<button id="save_icon" onclick="document.querySelector('#save-item').style.display='block'">Save</button>
    <button id="save-item" style="display:none" onclick="document.querySelector('#dialog').style.display='block'">Save OCA Config 2</button>
    <div id="dialog" class="ui-dialog" style="display:none">
      <label for="clicStatus_flag">CLIC Status is Unbuildable</label>
      <input id="clicStatus_flag" type="checkbox" style="display:none">
      <label for="ack_flag">Errors before Saving as Action-Required</label>
      <input id="ack_flag" type="checkbox" style="display:none">
      <button id="save_btn" onclick="if(clicStatus_flag.checked && ack_flag.checked){dialog.style.display='none';endbom.style.display='block'}">Save</button>
    </div>
    <button id="endbom" style="display:none">End BOM</button>`);

  const result = await new SaveFlow(page).save();
  expect(result).toEqual({ ucid: '', status: 'Saved' });
  await expect(page.locator('#clicStatus_flag')).toBeChecked();
  await expect(page.locator('#ack_flag')).toBeChecked();
  await expect(page.locator('#endbom')).toBeVisible();
});

test('does not report Saved when the dialog closes without post-save evidence', async ({ page }) => {
  await page.setContent(`<button id="save_icon" onclick="document.querySelector('#save-item').style.display='block'">Save</button>
    <button id="save-item" style="display:none" onclick="document.querySelector('#dialog').style.display='block'">Save OCA Config 2</button>
    <div id="dialog" class="ui-dialog" style="display:none"><button id="save_btn" onclick="dialog.style.display='none'">Save</button></div>`);
  await expect(new SaveFlow(page, { confirmationTimeoutMs: 250 }).save())
    .rejects.toThrow('OCA shows no saved UCID (still TempUCID) and no End BOM action');
});

test('closes a disabled Save dialog and requests Menu recovery', async ({ page }) => {
  await page.setContent(`<button id="save_icon" onclick="document.querySelector('#save-item').style.display='block'">Save</button>
    <button id="save-item" style="display:none" onclick="document.querySelector('#dialog').style.display='block'">Save OCA Config 2</button>
    <div id="dialog" class="ui-dialog" style="display:none">
      <button class="ui-dialog-titlebar-close" onclick="dialog.style.display='none'">Close</button>
      <button id="save_btn" disabled>Save</button>
    </div>`);

  await expect(new SaveFlow(page).save()).rejects.toBeInstanceOf(SaveRecoveryRequiredError);
  await expect(page.locator('#dialog')).toBeHidden();
});

// P73282-B21 (DL380 Gen12, 2026-10-18): the header read "UCID TempUCID", which was taken for a saved UCID.
test('TempUCID is not a saved UCID', () => {
  expect(savedUcid('Config Status Warning UCID TempUCID Solution Type Single')).toBe('');
  expect(savedUcid('Config Status Warning UCID 5157328606-01 Solution Type Single')).toBe('5157328606-01');
});

test('runs Save once more when the dialog closed but OCA still shows TempUCID', async ({ page }) => {
  await page.setContent(`<div id="header">UCID TempUCID</div>
    <button id="save_icon" onclick="document.querySelector('#save-item').style.display='block'">Save</button>
    <button id="save-item" style="display:none" onclick="document.querySelector('#dialog').style.display='block'">Save OCA Config 2</button>
    <div id="dialog" class="ui-dialog" style="display:none"><button id="save_btn" onclick="dialog.style.display='none';
      if (window.saved) header.textContent = 'UCID 5157328606-01'; window.saved = true;">Save</button></div>`);
  expect(await new SaveFlow(page, { confirmationTimeoutMs: 500 }).save()).toEqual({ ucid: '5157328606-01', status: 'Saved' });
});
