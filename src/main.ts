import fs from 'node:fs';
import { parseCliArgs, CLI_HELP } from './app/cli';
import { env } from './config/env';
import { ExcelReader } from './excel/excel-reader';
import { ExcelWriter } from './excel/excel-writer';
import { BrowserSession } from './automation/browser-session';
import { OcaEngine } from './automation/oca-engine';
import { UnsupportedComponentError } from './automation/component-engine';
import { ConfigurationRuleError, OcaPageLoadError } from './automation/configuration-errors';
import { createPendingResult, type AutomationResult } from './models/automation-result';
import { Logger } from './reporting/logger';
import { ScreenshotManager } from './reporting/screenshot-manager';
import { TraceManager } from './reporting/trace-manager';
import { HtmlCapture } from './reporting/html-capture';
import { getErrorMessage } from './core/excel';
import { isBrowserClosedError, ModelNotFoundError } from './core/errors';
import { codeVersion } from './core/code-version';
import { ocaProblemMessage } from './core/oca-problem';

export async function run(argv = process.argv.slice(2)): Promise<number> {
  let options;
  try { options = parseCliArgs(argv); }
  catch (error) {
    if (getErrorMessage(error) !== 'HELP') console.error(`[ERROR] ${getErrorMessage(error)}`);
    console.log(CLI_HELP); return getErrorMessage(error) === 'HELP' ? 0 : 2;
  }
  if (!fs.existsSync(options.input)) { console.error(`[ERROR] Input file not found: ${options.input}`); return 2; }

  const jobs = new ExcelReader().read(options.input, { startRow: options.startRow, jobId: options.jobId });
  const writer = new ExcelWriter(options.output, options.input);
  const logger = new Logger(options.output);
  const screenshots = new ScreenshotManager(options.output);
  const html = new HtmlCapture(options.output, options.captureHtml ? 'steps' : 'failure');
  const session = new BrowserSession({
    profilePath: options.profile, headed: options.headed, trace: options.trace,
    actionTimeoutMs: Number(process.env.OCA_ACTION_TIMEOUT_MS ?? 30_000),
    navigationTimeoutMs: Number(process.env.OCA_NAVIGATION_TIMEOUT_MS ?? 90_000),
  }, (message) => {
    console.log(message);
    logger.info('Browser lifecycle', { message });
  });
  const traces = new TraceManager(session, options.output, options.trace);
  let stopRequested = false;
  const stop = (signal: string) => {
    stopRequested = true;
    console.log(`[INFO] Graceful stop requested by ${signal}; finishing the current job (pid=${process.pid}, parent=${process.ppid})`);
    logger.info('Stop signal received', { signal, pid: process.pid, parentPid: process.ppid });
  };
  const onSigint = () => stop('SIGINT');
  const onSigterm = () => stop('SIGTERM');
  // The dashboard requests a stop over IPC because Windows cannot deliver SIGINT to a child.
  const onMessage = (message: unknown) => {
    if ((message as { type?: unknown } | null)?.type === 'stop') stop('dashboard');
  };
  process.on('SIGINT', onSigint); process.on('SIGTERM', onSigterm); process.on('message', onMessage);
  let failures = 0;
  // A result that cannot be written (e.g. the results workbook is open in Excel) must not stop the batch.
  const saveResult = async (result: AutomationResult): Promise<void> => {
    for (let tries = 1; ; tries += 1) {
      try { await writer.writeResult(result); return; } catch (error) {
        if (tries >= 3) {
          console.log(`[ERROR] Could not write the result of ${result.jobId} to ${writer.outputPath}: ${getErrorMessage(error)}; continuing with the next model`);
          logger.error('Result not written', { jobId: result.jobId, error: getErrorMessage(error) });
          return;
        }
        console.log(`[WARN] Writing results failed (${getErrorMessage(error).split('\n')[0]}); close the results workbook if it is open in Excel. Trying again in 10 s`);
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    }
  };
  console.log(`[INFO] Code version: ${codeVersion()}`);
  // Attempts per model before it is reported as failed (OCA_MODEL_ATTEMPTS, formerly OCA_RULE_CONFLICT_ATTEMPTS; default 3).
  const modelAttempts = Math.max(1, Number(process.env.OCA_MODEL_ATTEMPTS ?? process.env.OCA_RULE_CONFLICT_ATTEMPTS ?? 3) || 3);

  try {
    const context = await session.start();
    const engine = new OcaEngine(context, {
      baseUrl: env.baseUrl, authWaitMs: env.authWaitMs, expectedPageText: env.expectedPageText, html,
    });

    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (stopRequested) break;
      const existing = writer.getExisting(job.jobId);
      const retryEligible = existing?.executionStatus === 'Failed' || existing?.executionStatus === 'Unsupported';
      if (options.retryFailed && !retryEligible) continue;
      if (!job.enabled) {
        const skipped = createPendingResult(job.jobId, job.modelNumber); skipped.executionStatus = 'Skipped';
        skipped.errorMessage = 'Job is disabled'; skipped.endTime = new Date().toISOString();
        await saveResult(skipped);
        console.log(`[${index + 1}/${jobs.length}] ${job.modelNumber} - Skipped - Job is disabled`);
        continue;
      }
      const retryCount = existing ? existing.retryCount + 1 : 0;
      console.log(`[${index + 1}/${jobs.length}] ${job.modelNumber} - Running`);
      logger.info('Job started', { jobId: job.jobId, modelNumber: job.modelNumber, retryCount });
      html.startJob(job.jobId);
      await traces.start(job.jobId).catch(() => undefined);
      try {
        const result = await (async () => {
          for (let attempt = 1; ; attempt += 1) {
            try {
              // Launches the browser again when it was closed or crashed during an earlier attempt or job.
              engine.useContext(await session.start());
              return await engine.processJob(job, retryCount);
            } catch (error) {
              // Any failure starts the model again with fresh random picks, except a model OCA does
              // not offer (a retry cannot help) or a requested stop.
              if (error instanceof ModelNotFoundError || attempt >= modelAttempts || stopRequested) throw error;
              let attemptPage: typeof engine.activePage | undefined;
              try { attemptPage = engine.activePage; } catch { attemptPage = undefined; }
              await html.failure(attemptPage, `${engine.currentStep} attempt ${attempt}`).catch(() => '');
              const message = getErrorMessage(error);
              const next = isBrowserClosedError(error) ? 'restarting the browser and the model'
                : error instanceof OcaPageLoadError ? 'opening OCA again'
                  : error instanceof ConfigurationRuleError ? 'starting again with new random picks'
                    : 'starting the model again';
              const detail = error instanceof ConfigurationRuleError
                ? message.split('. OCA messages:')[1]?.trim() ?? message : message.split('\n')[0];
              console.log(`[RETRY] ${job.modelNumber}: attempt ${attempt}/${modelAttempts} failed at "${engine.currentStep}"; ${next}. ${detail}`);
              logger.info('Job retried', { jobId: job.jobId, attempt, step: engine.currentStep, error: message });
            }
          }
        })();
        result.tracePath = await traces.finish(job.jobId, false).catch(() => '');
        await saveResult(result);
        console.log(`[${index + 1}/${jobs.length}] ${job.modelNumber} - Success${result.ucid ? ` - ${result.ucid}` : ''}`);
        logger.info('Job succeeded', { jobId: job.jobId, ucid: result.ucid });
      } catch (error) {
        failures += 1;
        const result = createPendingResult(job.jobId, job.modelNumber, retryCount);
        result.executionStatus = error instanceof UnsupportedComponentError ? 'Unsupported' : 'Failed';
        result.errorStep = engine.currentStep; result.errorMessage = getErrorMessage(error);
        let failedPage: typeof engine.activePage | undefined;
        try { failedPage = engine.activePage; } catch { failedPage = undefined; }
        // OCA's own error dialog explains failures it causes (e.g. a click it intercepted).
        const problem = failedPage ? await ocaProblemMessage(failedPage).catch(() => '') : '';
        if (problem && !result.errorMessage.includes(problem)) result.errorMessage += ` | OCA error dialog: ${problem}`;
        await html.failure(failedPage, engine.currentStep).catch(() => '');
        result.screenshotPath = failedPage ? await screenshots.capture(failedPage, job.jobId).catch(() => '') : '';
        result.tracePath = await traces.finish(job.jobId, true).catch(() => '');
        result.endTime = new Date().toISOString(); result.duration = Date.parse(result.endTime) - Date.parse(result.startTime);
        await saveResult(result);
        console.log(`[${index + 1}/${jobs.length}] ${job.modelNumber} - ${result.executionStatus} - ${result.errorMessage}`);
        logger.error('Job failed', { jobId: job.jobId, step: result.errorStep, error: result.errorMessage });
      }
    }
  } finally {
    await session.close();
    process.removeListener('SIGINT', onSigint); process.removeListener('SIGTERM', onSigterm);
    process.removeListener('message', onMessage);
  }
  console.log(`[INFO] Results written to ${writer.outputPath}`);
  return failures ? 1 : 0;
}

if (require.main === module) {
  // An open IPC channel to the dashboard would keep this process alive after the run.
  void run().then((code) => { process.exitCode = code; })
    .finally(() => { if (process.connected) process.disconnect?.(); });
}
