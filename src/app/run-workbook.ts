import * as XLSX from 'xlsx';
import { defaultComponentInstructions } from '../excel/excel-reader';
import type { ConfigurationSource, OcaJob } from '../models/job';

/**
 * Normalizes jobs posted by the dashboard. A job without component instructions
 * receives the same random selections as a blank Models-sheet row, so its
 * behavior does not change when another job in the run has detailed components.
 */
export function prepareRunJobs(jobs: OcaJob[]): OcaJob[] {
  return jobs.map((job, index): OcaJob => {
    const source: ConfigurationSource = job.source ?? { kind: 'detailed-excel', instructions: [] };
    return {
      ...job,
      isSolution: Boolean(job.isSolution),
      isStorage: Boolean(job.isStorage),
      quotationMode: 'aaS',
      inputRow: index + 2,
      source: source.kind === 'detailed-excel' && !source.instructions?.length
        ? { kind: 'detailed-excel', instructions: defaultComponentInstructions(job.jobId) }
        : source,
    };
  });
}

export function writeRunWorkbook(jobs: OcaJob[], target: string): void {
  const modelRows = jobs.map((job) => ({
    'Job ID': job.jobId, 'Model Number': job.modelNumber, 'Model Description': job.modelDescription ?? '',
    Solution: job.isSolution ? 'Yes' : 'No', 'Solution Name': job.solutionName ?? '',
    Storage: job.isStorage ? 'Yes' : 'No',
    'Integration Rack Part number': job.integrationRackPartNumber ?? '', Server: job.server ?? '',
    'Quotation Mode': 'aaS', 'Service Type': job.serviceType,
    'Generate End BOM': job.generateEndBom ? 'Yes' : 'No', Enabled: job.enabled ? 'Yes' : 'No',
  }));
  const componentRows = jobs.flatMap((job) => job.source.kind === 'detailed-excel'
    ? job.source.instructions.map((item) => ({
      'Job ID': job.jobId, Section: item.section, 'Product Number': item.productNumber ?? '',
      Description: item.description ?? '', Quantity: item.quantity ?? '', 'Selection Type': item.selectionType,
      'Configuration Text': item.configurationText ?? '', Sequence: item.sequence,
    })) : []);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(modelRows), 'Models');
  if (componentRows.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(componentRows), 'Components');
  XLSX.writeFile(workbook, target);
}
