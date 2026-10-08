import path from 'node:path';

export interface CliOptions {
  input: string;
  output: string;
  headed: boolean;
  profile: string;
  startRow?: number;
  jobId?: string;
  retryFailed: boolean;
  trace: boolean;
  captureHtml: boolean;
}

const valueAfter = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

export function parseCliArgs(args: string[]): CliOptions {
  if (args.includes('--help') || args.includes('-h')) {
    throw new Error('HELP');
  }
  const input = valueAfter(args, '--input');
  if (!input) throw new Error('--input is required');
  const startRowText = valueAfter(args, '--start-row');
  const startRow = startRowText ? Number(startRowText) : undefined;
  if (startRow !== undefined && (!Number.isInteger(startRow) || startRow < 2)) throw new Error('--start-row must be an integer >= 2');
  return {
    input: path.resolve(input),
    output: path.resolve(valueAfter(args, '--output') ?? './output'),
    headed: args.includes('--headed') || !args.includes('--headless'),
    profile: path.resolve(valueAfter(args, '--profile') ?? process.env.OCA_PROFILE_DIR ?? './.oca-profile'),
    startRow,
    jobId: valueAfter(args, '--job-id'),
    retryFailed: args.includes('--retry-failed'),
    trace: args.includes('--trace'),
    captureHtml: args.includes('--capture-html'),
  };
}

export const CLI_HELP = `Usage: npm run oca -- --input ./input/models.xlsx --output ./output

Options:
  --headed              Run Chromium headed (default)
  --headless            Run Chromium headless (future/CI use)
  --profile <path>      Persistent Chromium profile directory
  --start-row <number>  Begin at a Models worksheet row (header is row 1)
  --job-id <id>         Process one Job ID
  --retry-failed        Process only failed/unsupported prior results
  --trace               Capture Playwright traces for failed jobs
  --capture-html        Save page HTML after every step (failed jobs are always saved)
`;
