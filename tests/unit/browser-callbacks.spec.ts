import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { transformSync } from 'esbuild';

// `npm run oca` / `npm run ui` run through tsx, which compiles with esbuild's keepNames: a named
// helper function inside code sent to the browser becomes __name(...), which the page lacks
// ("ReferenceError: __name is not defined", P72176-B21 Set Customer Account, 2026-10-16).
// The unit tests compile differently and never see it, so this compiles src as tsx does.
const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });

/** The argument list of each evaluate/evaluateAll/waitForFunction/evaluateHandle call. */
const browserCalls = (code: string): string[] => {
  const calls: string[] = [];
  const pattern = /\.(?:evaluate|evaluateAll|evaluateHandle|waitForFunction)\(/g;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let end = start;
    for (; end < code.length; end += 1) {
      if (code[end] === '(') depth += 1;
      else if (code[end] === ')' && --depth === 0) break;
    }
    calls.push(code.slice(start, end + 1));
  }
  return calls;
};

test('code sent to the browser has no named helper functions (tsx __name)', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(path.resolve(__dirname, '../../src'))) {
    const { code } = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', keepNames: true, format: 'esm' });
    for (const call of browserCalls(code).filter((body) => body.includes('__name('))) {
      offenders.push(`${path.relative(process.cwd(), file)}: ${call.slice(0, 120).replace(/\s+/g, ' ')}`);
    }
  }
  expect(offenders).toEqual([]);
});
