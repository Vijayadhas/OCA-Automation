import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../..');

/**
 * Which code a run used, logged at start so a pasted log can be matched to a commit. Uses Git when
 * the project is a clone; a GitHub zip download has no .git, so it then reports the newest source
 * file's modified time (zip downloads keep the commit time on every file).
 */
export function codeVersion(root = projectRoot): string {
  try {
    const commit = execFileSync('git', ['log', '-1', '--format=%h %cd', '--date=format:%Y-%m-%d %H:%M'], {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
    }).toString().trim();
    if (commit) return `commit ${commit}`;
  } catch { /* not a Git checkout */ }
  let newest: { file: string; time: number } | null = null;
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.ts')) {
        const time = fs.statSync(full).mtimeMs;
        if (!newest || time > newest.time) newest = { file: full, time };
      }
    }
  };
  try { visit(path.join(root, 'src')); } catch { return 'unknown (source folder not readable)'; }
  const found = newest as { file: string; time: number } | null;
  if (!found) return 'unknown (no source files)';
  const stamp = new Date(found.time);
  const pad = (value: number) => String(value).padStart(2, '0');
  const local = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
  return `no Git; newest source file ${path.relative(root, found.file)} modified ${local}`;
}
