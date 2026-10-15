import * as XLSX from 'xlsx';
import { parseModelType, routeFromModelType, type OcaJob } from '../models/job';
import { isSelectionType, type ComponentInstruction, type SelectionType } from '../models/component-instruction';
import { ExcelValidator } from './excel-validator';

type Cell = string | number | boolean | Date | null | undefined;
type Row = Record<string, Cell>;

export interface JobReadOptions {
  startRow?: number;
  jobId?: string;
}

const text = (value: Cell): string => String(value ?? '').trim();
const bool = (value: Cell, defaultValue: boolean): boolean => {
  const normalized = text(value).toLowerCase();
  if (!normalized) return defaultValue;
  return ['true', 'yes', 'y', '1', 'enabled'].includes(normalized);
};
const normalizedHeader = (value: string): string => value.replace(/\s+/g, '').toLowerCase();
const cellByHeader = (row: Row, ...headers: string[]): Cell => {
  const accepted = new Set(headers.map(normalizedHeader));
  const entries = Object.entries(row).filter(([header]) => accepted.has(normalizedHeader(header)));
  return entries.find(([, value]) => text(value))?.[1] ?? entries[0]?.[1];
};
const solutionFlag = (row: Row): boolean => {
  const explicit = cellByHeader(row, 'Solution', 'Solutions');
  if (bool(explicit, false) || /solution\s*wizard/i.test(text(explicit))) return true;
  const description = cellByHeader(
    row, 'Model Description', 'Configured Model Description', 'Solution Name', 'Product or Solution Description',
  );
  return /solution\s*wizard/i.test(text(description));
};
/** "Model Type" (Server / Solution / Storage / Nutanix) sets the route; without it the old Solution and Storage columns do. */
const routeOf = (row: Row) => routeFromModelType(parseModelType(text(cellByHeader(row, 'Model Type'))), {
  isSolution: solutionFlag(row), isStorage: bool(cellByHeader(row, 'Storage'), false),
});

export class ExcelReader {
  constructor(private readonly validator = new ExcelValidator()) {}

  read(filePath: string, options: JobReadOptions = {}): OcaJob[] {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const modelsSheet = workbook.Sheets.Models;
    const componentsSheet = workbook.Sheets.Components;
    if (!modelsSheet) throw new Error('Input workbook must contain a Models sheet');

    if (!componentsSheet) {
      const jobs = this.readFlatModels(modelsSheet);
      this.validator.validate(jobs);
      return this.applyFilters(jobs, options);
    }

    const componentRows = XLSX.utils.sheet_to_json<Row>(componentsSheet, { defval: '' });
    const byJob = new Map<string, ComponentInstruction[]>();
    componentRows.forEach((row, index) => {
      const jobId = text(cellByHeader(row, 'Job ID'));
      if (!jobId) return;
      const rawType = text(cellByHeader(row, 'Selection Type')).toLowerCase();
      const selectionType: SelectionType = isSelectionType(rawType) ? rawType : (rawType as SelectionType);
      const quantityText = text(cellByHeader(row, 'Quantity'));
      const sequenceText = text(cellByHeader(row, 'Sequence'));
      const instruction: ComponentInstruction = {
        jobId,
        section: text(cellByHeader(row, 'Section')),
        productNumber: text(cellByHeader(row, 'Product Number')) || undefined,
        description: text(cellByHeader(row, 'Description')) || undefined,
        quantity: quantityText ? Number(quantityText) : undefined,
        selectionType,
        configurationText: text(cellByHeader(row, 'Configuration Text')) || undefined,
        sequence: sequenceText ? Number(sequenceText) : index + 1,
      };
      byJob.set(jobId, [...(byJob.get(jobId) ?? []), instruction]);
    });

    const modelRows = XLSX.utils.sheet_to_json<Row>(modelsSheet, { defval: '' });
    const jobs = modelRows.map((row, index): OcaJob => {
      const jobId = text(cellByHeader(row, 'Job ID'));
      return {
        jobId,
        modelNumber: text(cellByHeader(row, 'Model Number')),
        modelDescription: text(cellByHeader(row, 'Model Description', 'Configured Model Description')) || undefined,
        integrationRackPartNumber: text(cellByHeader(row, 'Integration Rack Part number', 'Integration Rack Part Number')) || undefined,
        server: text(cellByHeader(row, 'Server')) || undefined,
        solutionName: text(cellByHeader(row, 'Solution Name', 'Product or Solution Description')) || undefined,
        ...routeOf(row),
        customerAccount: text(cellByHeader(row, 'Customer Account')) || undefined,
        quotationMode: 'aaS',
        serviceType: text(cellByHeader(row, 'Service Type')) || 'Default',
        generateEndBom: bool(cellByHeader(row, 'Generate End BOM'), true),
        enabled: bool(cellByHeader(row, 'Enabled'), true),
        source: {
          kind: 'detailed-excel',
          // A model with no Components rows gets the same random selections as in the dashboard.
          instructions: byJob.get(jobId)?.sort((a, b) => a.sequence - b.sequence) ?? defaultComponentInstructions(jobId),
        },
        inputRow: index + 2,
      };
    });
    this.validator.validate(jobs);
    return this.applyFilters(jobs, options);
  }

  private readFlatModels(sheet: XLSX.WorkSheet): OcaJob[] {
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' });
    return rows.map((row, index): OcaJob => {
      const inputRow = index + 2;
      const jobId = text(cellByHeader(row, 'Job ID')) || `ROW-${inputRow}`;
      const modelNumber = text(cellByHeader(row, 'Model Number')) || text(cellByHeader(row, 'Model'));
      const quotation = text(cellByHeader(row, 'Quotation Mode')) || 'aaS';
      if (!/^aaS$/i.test(quotation)) {
        throw new Error(`Models row ${inputRow}: Quotation Mode must be aaS`);
      }
      return {
        jobId,
        modelNumber,
        modelDescription: text(cellByHeader(row, 'Model Description', 'Configured Model Description')) || undefined,
        integrationRackPartNumber: text(cellByHeader(row, 'Integration Rack Part number', 'Integration Rack Part Number')) || undefined,
        server: text(cellByHeader(row, 'Server')) || undefined,
        solutionName: text(cellByHeader(row, 'Solution Name', 'Product or Solution Description')) || undefined,
        ...routeOf(row),
        customerAccount: text(cellByHeader(row, 'Customer Account')) || undefined,
        quotationMode: 'aaS',
        serviceType: text(cellByHeader(row, 'Service Type')) || text(cellByHeader(row, 'Service')) || 'Random',
        generateEndBom: bool(cellByHeader(row, 'Generate End BOM', 'End BOM Required'), true),
        enabled: bool(cellByHeader(row, 'Enabled'), true),
        source: { kind: 'detailed-excel', instructions: this.flatInstructions(row, jobId) },
        inputRow,
      };
    });
  }

  flatInstructions(row: Row, jobId: string): ComponentInstruction[] {
    const instructions: ComponentInstruction[] = [];
    let sequence = 10;
    const addProduct = (section: string, productCell: Cell, quantityCell: Cell) => {
      const product = text(productCell);
      const normalized = product.toLowerCase();
      if (!product || normalized === 'random') {
        instructions.push({ jobId, section, selectionType: 'random', sequence });
      } else if (normalized === 'default' || normalized === 'automatic') {
        // "Automatic" (older workbooks, e.g. Smart Chassis Product) means OCA manages the choice: keep it.
        instructions.push({ jobId, section, selectionType: 'default', sequence });
      } else {
        const quantityText = text(quantityCell);
        instructions.push({
          jobId,
          section,
          productNumber: product,
          quantity: quantityText ? Number(quantityText) : 1,
          selectionType: 'quantity',
          sequence,
        });
      }
      sequence += 10;
    };

    addProduct('Processor', cellByHeader(row, 'Processor'), cellByHeader(row, 'Processor Qty'));
    addProduct('Memory', cellByHeader(row, 'Memory'), cellByHeader(row, 'Memory Qty'));
    addProduct('Smart Chassis', cellByHeader(row, 'Smart Chassis Product'), cellByHeader(row, 'Smart Chassis Qty'));

    const chassisConfig = text(cellByHeader(row, 'Chassis Config'));
    if (chassisConfig && !/^(random|default)$/i.test(chassisConfig)) {
      instructions.push({
        jobId,
        section: 'Smart Chassis',
        selectionType: 'configuration',
        configurationText: chassisConfig,
        sequence,
      });
      sequence += 10;
    }

    addProduct('Power Supplies', cellByHeader(row, 'Power Supply'), cellByHeader(row, 'Power Qty'));
    return instructions;
  }

  private applyFilters(jobs: OcaJob[], options: JobReadOptions): OcaJob[] {
    let filtered = jobs;
    if (options.startRow) filtered = filtered.filter((job) => job.inputRow >= options.startRow!);
    if (options.jobId) filtered = filtered.filter((job) => job.jobId === options.jobId);
    return filtered;
  }
}

/** Instructions for a model with no component columns: random Processor, Memory, Smart Chassis, and Power Supplies. */
export function defaultComponentInstructions(jobId: string): ComponentInstruction[] {
  return new ExcelReader().flatInstructions({}, jobId);
}
