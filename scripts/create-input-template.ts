import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { buildInputTemplate } from '../src/excel/input-template';

const output = path.resolve(process.argv[2] ?? './input/OCA-Input-Template.xlsx');
fs.mkdirSync(path.dirname(output), { recursive: true });
XLSX.writeFile(buildInputTemplate(), output);
console.log(`Input template created: ${output}`);
