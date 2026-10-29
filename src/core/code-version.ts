import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../..');

/**
 * The commit stamped into VERSION by GitHub's "Download ZIP" (`export-subst` in .gitattributes), as
 * `<hash> <YYYY-MM-DD HH:MM>`; null in a clone, where the file still holds the `$Format:` placeholder.
 */
export function zipVersion(root = projectRoot): string | null {
  let text: string;
  try { text = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim(); } catch { return null; }
  const match = /^([0-9a-f]{7,40}) (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(text);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : null;
}

/**
 * Which code a run used, logged at start so a pasted log can be matched to a commit. A GitHub zip
 * download has no .git but carries the commit in VERSION; a clone uses Git. Without either, it
 * reports the newest source file's modified time (zip downloads keep the commit time on every file).
 */
export function codeVersion(root = projectRoot): string {
  const fromZip = zipVersion(root);
  if (fromZip) return `commit ${fromZip} (GitHub zip)`;
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
