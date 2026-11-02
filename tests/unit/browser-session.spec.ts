import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { BrowserSession } from '../../src/automation/browser-session';

// These tests are about signals and closing, not which browser is installed: they use Playwright Chromium
// (installed for the tests), so an installed Chrome or Edge starting slowly cannot make them fail at random.

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`browser stays usable while the runner handles ${signal}`, async () => {
    const testInfo = test.info();
    // Isolate signal listeners from the Playwright test runner. Emit the Node
    // event to exercise browser signal handling without signalling the terminal.
    const script = `
      const { BrowserSession } = require(${JSON.stringify(path.resolve('src/automation/browser-session.ts'))});
      (async () => {
        const session = new BrowserSession({
          profilePath: ${JSON.stringify(testInfo.outputPath('profile'))},
          headed: false, trace: false, actionTimeoutMs: 5000, navigationTimeoutMs: 5000, browser: 'chromium'
        });
        let stopped = false;
        process.on('${signal}', () => { stopped = true; });
        try {
          const page = await session.page();
          await page.setContent('<button>Finish current job</button>');
          process.emit('${signal}');
          await new Promise(resolve => setTimeout(resolve, 300));
          await page.getByRole('button').click();
          if (!stopped) throw new Error('Runner did not receive signal');
          console.log('CURRENT_JOB_FINISHED');
        } finally { await session.close(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--require', 'tsx/cjs', '-e', script], { timeout: 30_000 });
    expect(stdout).toContain('CURRENT_JOB_FINISHED');
    expect(stdout).toContain('Browser context closed (runner cleanup)');
    expect(stdout).not.toContain('unexpected');
  });
}

test('records unexpected context closure', async () => {
  const testInfo = test.info();
  const messages: string[] = [];
  const session = new BrowserSession({
    profilePath: testInfo.outputPath('profile'), headed: false, trace: false,
    actionTimeoutMs: 5000, navigationTimeoutMs: 5000, browser: 'chromium',
  }, (message) => messages.push(message));
  try {
    const context = await session.start();
    await context.close();
    expect(messages).toContain('[ERROR] Browser context closed (unexpected)');
  } finally { await session.close(); }
});
