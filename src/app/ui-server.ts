import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { ExcelReader } from '../excel/excel-reader';
import { ExcelValidator } from '../excel/excel-validator';
import type { OcaJob } from '../models/job';
import { prepareRunJobs, writeRunWorkbook } from './run-workbook';

type RunState = {
  id: string;
  status: 'queued' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled';
  currentModel: string;
  currentJob: number;
  totalJobs: number;
  completedJobs: number;
  successfulJobs: number;
  failedJobs: number;
  message: string;
  startedAt: string;
  finishedAt?: string;
  resultPath?: string;
  logs: string[];
  process?: ChildProcess;
  clients: Set<express.Response>;
};

const app = express();
const port = Number(process.env.OCA_UI_PORT ?? 4173);
const root = path.resolve(__dirname, '../..');
const dataRoot = path.join(root, '.oca-ui', 'runs');
const publicRoot = path.join(root, 'src', 'ui', 'public');
const runs = new Map<string, RunState>();
fs.mkdirSync(dataRoot, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(publicRoot));

const serializable = (run: RunState) => ({
  id: run.id, status: run.status, currentModel: run.currentModel, currentJob: run.currentJob,
  totalJobs: run.totalJobs, completedJobs: run.completedJobs, successfulJobs: run.successfulJobs,
  failedJobs: run.failedJobs, message: run.message, startedAt: run.startedAt,
  finishedAt: run.finishedAt, hasResults: Boolean(run.resultPath && fs.existsSync(run.resultPath)), logs: run.logs,
});

const publish = (run: RunState) => {
  const payload = `data: ${JSON.stringify(serializable(run))}\n\n`;
  for (const client of run.clients) client.write(payload);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, done) => done(null, /\.xlsx?$/i.test(file.originalname)),
});

app.post('/api/import', upload.single('workbook'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an .xlsx workbook.' });
  const tempPath = path.join(dataRoot, `import-${crypto.randomUUID()}.xlsx`);
  try {
    fs.writeFileSync(tempPath, req.file.buffer);
    const jobs = new ExcelReader().read(tempPath);
    return res.json({ fileName: req.file.originalname, jobs });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
});

const activeRun = () => [...runs.values()].find((run) => run.process);

app.post('/api/runs', (req, res) => {
  const active = activeRun();
  if (active) {
    return res.status(409).json({
      error: `A run is already in progress${active.currentModel ? ` (${active.currentModel})` : ''}. Wait for it to finish or stop it first.`,
    });
  }
  const posted = req.body.jobs as OcaJob[];
  if (!Array.isArray(posted) || !posted.length) return res.status(400).json({ error: 'Add at least one job.' });
  let jobs: OcaJob[];
  try { jobs = prepareRunJobs(posted); new ExcelValidator().validate(jobs); }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }

  const id = crypto.randomUUID();
  const runDir = path.join(dataRoot, id);
  const inputPath = path.join(runDir, 'input.xlsx');
  const outputDir = path.join(runDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  writeRunWorkbook(jobs, inputPath);
  const settings = req.body.settings ?? {};
  // Run Node directly with the tsx loader. Windows Node refuses to spawn npm.cmd
  // without a shell (EINVAL), and a single process can receive the IPC stop request.
  const args = ['--import', 'tsx', path.join(root, 'src', 'main.ts'), '--input', inputPath, '--output', outputDir,
    settings.headless ? '--headless' : '--headed'];
  if (settings.trace) args.push('--trace');
  const run: RunState = {
    id, status: 'queued', currentModel: '', currentJob: 0, totalJobs: jobs.length, completedJobs: 0,
    successfulJobs: 0, failedJobs: 0, message: 'Preparing automation', startedAt: new Date().toISOString(),
    logs: [], clients: new Set(),
  };

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  } catch (error) {
    return res.status(500).json({ error: `Could not start the automation runner: ${error instanceof Error ? error.message : String(error)}` });
  }
  runs.set(id, run);
  res.status(202).json({ id });
  run.process = child; run.status = 'running'; run.message = 'Opening browser session'; publish(run);
  const consume = (chunk: Buffer) => {
    for (const raw of chunk.toString().split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      run.logs.push(line); if (run.logs.length > 250) run.logs.shift();
      const started = line.match(/^\[(\d+)\/(\d+)] (.+?) - Running$/);
      const ended = line.match(/^\[(\d+)\/(\d+)] (.+?) - (Success|Failed|Unsupported|Skipped)(?:\s-\s(.*))?$/);
      if (started) {
        run.currentJob = Number(started[1]); run.totalJobs = Number(started[2]);
        run.currentModel = started[3]; run.message = 'Configuring model';
      } else if (ended) {
        run.currentJob = Number(ended[1]); run.completedJobs += 1; run.currentModel = ended[3];
        if (ended[4] === 'Success') run.successfulJobs += 1; else if (ended[4] !== 'Skipped') run.failedJobs += 1;
        run.message = ended[4] === 'Success' ? `Completed${ended[5] ? ` · ${ended[5]}` : ''}` : `${ended[4]}${ended[5] ? ` · ${ended[5]}` : ''}`;
      } else if (line.includes('Complete manual authentication')) run.message = 'Waiting for OCA sign-in';
      publish(run);
    }
  };
  child.stdout?.on('data', consume); child.stderr?.on('data', consume);
  child.on('error', (error) => {
    // 'close' is not guaranteed after a spawn error; release the active-run slot here.
    run.process = undefined; run.status = 'failed'; run.message = error.message; run.finishedAt = new Date().toISOString(); publish(run);
  });
  child.on('close', (code, signal) => {
    run.process = undefined; run.finishedAt = new Date().toISOString();
    run.resultPath = path.join(outputDir, 'input-results.xlsx');
    if (run.status === 'stopping' || signal) { run.status = 'cancelled'; run.message = 'Run stopped'; }
    else if (code === 0) { run.status = 'completed'; run.message = 'All jobs completed'; }
    else { run.status = 'failed'; run.message = `Automation finished with exit code ${code ?? 'unknown'}`; }
    publish(run);
  });
});

app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id); if (!run) return res.status(404).json({ error: 'Run not found.' });
  return res.json(serializable(run));
});

app.get('/api/runs/:id/events', (req, res) => {
  const run = runs.get(req.params.id); if (!run) return res.status(404).end();
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive'); res.flushHeaders(); run.clients.add(res); publish(run);
  req.on('close', () => run.clients.delete(res));
});

app.post('/api/runs/:id/stop', (req, res) => {
  const run = runs.get(req.params.id); if (!run) return res.status(404).json({ error: 'Run not found.' });
  if (!run.process) return res.status(409).json({ error: 'Run is not active.' });
  run.status = 'stopping'; run.message = 'Finishing current job, then stopping';
  // Signals cannot be delivered gracefully on Windows (kill terminates at once), so
  // ask the runner over IPC; it finishes the current job and closes the browser.
  if (run.process.connected) run.process.send({ type: 'stop' });
  else run.process.kill();
  publish(run);
  return res.json(serializable(run));
});

const resultRows = (filePath: string) => {
  const workbook = XLSX.readFile(filePath); const sheet = workbook.Sheets.Results;
  return sheet ? XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: '' }) : [];
};

app.get('/api/runs/:id/results', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run?.resultPath || !fs.existsSync(run.resultPath)) return res.json({ results: [] });
  return res.json({ results: resultRows(run.resultPath) });
});

app.get('/api/runs/:id/download', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run?.resultPath || !fs.existsSync(run.resultPath)) return res.status(404).json({ error: 'Results are not available yet.' });
  return res.download(run.resultPath, `oca-results-${run.id.slice(0, 8)}.xlsx`);
});

app.listen(port, () => console.log(`OCA Control Center: http://localhost:${port}`));
