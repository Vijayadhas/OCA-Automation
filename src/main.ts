import fs from 'node:fs';
import { parseCliArgs, CLI_HELP } from './app/cli';
import { env } from './config/env';
import { ExcelReader } from './excel/excel-reader';
import { ExcelWriter } from './excel/excel-writer';
import { BrowserSession } from './automation/browser-session';
import { OcaEngine } from './automation/oca-engine';
import { ExceptionRegistry } from './exceptions/exception-registry';
import { P72221SmartChassisHandler } from './exceptions/p72221-smart-chassis-handler';
import { P74787AutomaticDependencyHandler } from './exceptions/p74787-automatic-dependency-handler';
import { UnsupportedComponentError } from './automation/component-engine';
import { createPendingResult } from './models/automation-result';
import { Logger } from './reporting/logger';
import { ScreenshotManager } from './reporting/screenshot-manager';
import { TraceManager } from './reporting/trace-manager';
import { getErrorMessage } from './core/excel';

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

  try {
    const context = await session.start();
    const engine = new OcaEngine(context, new ExceptionRegistry([
      new P74787AutomaticDependencyHandler(), new P72221SmartChassisHandler(),
    ]), { baseUrl: env.baseUrl, authWaitMs: env.authWaitMs, expectedPageText: env.expectedPageText });

    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (stopRequested) break;
      const existing = writer.getExisting(job.jobId);
      const retryEligible = existing?.executionStatus === 'Failed' || existing?.executionStatus === 'Unsupported';
      if (options.retryFailed && !retryEligible) continue;
      if (!job.enabled) {
        const skipped = createPendingResult(job.jobId, job.modelNumber); skipped.executionStatus = 'Skipped';
        skipped.errorMessage = 'Job is disabled'; skipped.endTime = new Date().toISOString();
        await writer.writeResult(skipped);
        console.log(`[${index + 1}/${jobs.length}] ${job.modelNumber} - Skipped - Job is disabled`);
        continue;
      }
      const retryCount = existing ? existing.retryCount + 1 : 0;
      console.log(`[${index + 1}/${jobs.length}] ${job.modelNumber} - Running`);
      logger.info('Job started', { jobId: job.jobId, modelNumber: job.modelNumber, retryCount });
      await traces.start(job.jobId);
      try {
        const result = await engine.processJob(job, retryCount);
        result.tracePath = await traces.finish(job.jobId, false);
        await writer.writeResult(result);
        console.log(`[${index + 1}/${jobs.length}] ${job.modelNumber} - Success${result.ucid ? ` - ${result.ucid}` : ''}`);
        logger.info('Job succeeded', { jobId: job.jobId, ucid: result.ucid });
      } catch (error) {
        failures += 1;
        const result = createPendingResult(job.jobId, job.modelNumber, retryCount);
        result.executionStatus = error instanceof UnsupportedComponentError ? 'Unsupported' : 'Failed';
        result.errorStep = engine.currentStep; result.errorMessage = getErrorMessage(error);
        result.screenshotPath = await screenshots.capture(engine.activePage, job.jobId).catch(() => '');
        result.tracePath = await traces.finish(job.jobId, true);
        result.endTime = new Date().toISOString(); result.duration = Date.parse(result.endTime) - Date.parse(result.startTime);
        await writer.writeResult(result);
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
