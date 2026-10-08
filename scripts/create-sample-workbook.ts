import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const output = path.resolve(process.argv[2] ?? './input/models.sample.xlsx');
fs.mkdirSync(path.dirname(output), { recursive: true });
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
  'Job ID': 'JOB-001',
  'Model Number': 'P72176-B21',
  'Solution Name': 'DL360 Gen12 sample',
  Solution: 'No',
  Storage: 'No',
  'Quotation Mode': 'aaS',
  Processor: 'Random',
  'Processor Qty': '1 or 2',
  Memory: 'Random',
  'Memory Qty': '1 or 2',
  'Smart Chassis Product': 'Random',
  'Smart Chassis Qty': 1,
  'Chassis Config': 'Random',
  'Power Supply': 'Random',
  'Power Qty': '1 or 2',
  Service: 'Default',
  'Generate End BOM': 'Yes',
  Enabled: 'Yes',
}]), 'Models');
XLSX.writeFile(workbook, output);
console.log(`Sample workbook created: ${output}`);
