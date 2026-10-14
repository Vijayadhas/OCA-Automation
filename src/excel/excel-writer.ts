import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { AutomationResult } from '../models/automation-result';

const RESULT_HEADERS = [
  'Job ID', 'Model Number', 'Execution Status', 'UCID', 'Quotation Mode', 'OCA Config Status',
  'Service Experience', 'Service Term', 'Data Privacy',
  'Start BOM UCID', 'End BOM UCID', 'Associate End BOM', 'End BOM Status',
  'Start Billing Tier', 'Start Billing Tier Custom Name', 'Start Allocated Memory', 'Start Server', 'Start Used CPU Core',
  'End Billing Tier', 'End Billing Tier Custom Name', 'End Allocated Memory', 'End Server', 'End Used CPU Core',
  'Selected Components', 'Start Time', 'End Time', 'Duration',
  'Retry Count', 'Error Step', 'Error Message', 'Screenshot Path', 'Trace Path',
] as const;

const BOM_UCID_HEADERS = [
  'Job ID', 'Model Number', 'Start BOM UCID', 'End BOM UCID', 'End BOM Associated', 'Execution Status', 'Comments',
] as const;

export class ExcelWriter {
  private readonly results = new Map<string, AutomationResult>();
  readonly outputPath: string;

  constructor(outputDirectory: string, inputPath: string) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const stem = path.basename(inputPath, path.extname(inputPath));
    this.outputPath = path.join(outputDirectory, `${stem}-results.xlsx`);
    this.loadExisting();
  }

  getExisting(jobId: string): AutomationResult | undefined {
    return this.results.get(jobId);
  }

  async writeResult(result: AutomationResult): Promise<void> {
    this.results.set(result.jobId, result);
    this.flush();
  }

  private loadExisting(): void {
    if (!fs.existsSync(this.outputPath)) return;
    const workbook = XLSX.readFile(this.outputPath);
    const sheet = workbook.Sheets.Results;
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: '' });
    for (const row of rows) {
      const jobId = String(row['Job ID'] ?? '').trim();
      if (!jobId) continue;
      this.results.set(jobId, {
        jobId,
        modelNumber: String(row['Model Number'] ?? ''),
        executionStatus: String(row['Execution Status']) as AutomationResult['executionStatus'],
        ucid: String(row.UCID ?? ''), quotationMode: String(row['Quotation Mode'] ?? ''),
        serviceExperience: String(row['Service Experience'] ?? ''), serviceTerm: String(row['Service Term'] ?? ''),
        dataPrivacy: String(row['Data Privacy'] ?? ''),
        ocaConfigStatus: String(row['OCA Config Status'] ?? ''), endBomStatus: String(row['End BOM Status'] ?? ''),
        startBomId: String(row['Start BOM UCID'] ?? ''), endBomId: String(row['End BOM UCID'] ?? row['End BOM ID'] ?? ''),
        endBomAssociated: String(row['Associate End BOM'] ?? 'No'),
        startBillingTier: String(row['Start Billing Tier'] ?? ''), startBillingTierCustomName: String(row['Start Billing Tier Custom Name'] ?? ''),
        startAllocatedMemory: String(row['Start Allocated Memory'] ?? ''), startServerCount: String(row['Start Server'] ?? ''),
        startUsedCpuCore: String(row['Start Used CPU Core'] ?? ''), endBillingTier: String(row['End Billing Tier'] ?? ''),
        endBillingTierCustomName: String(row['End Billing Tier Custom Name'] ?? ''), endAllocatedMemory: String(row['End Allocated Memory'] ?? ''),
        endServerCount: String(row['End Server'] ?? ''), endUsedCpuCore: String(row['End Used CPU Core'] ?? ''),
        selectedComponents: String(row['Selected Components'] ?? ''),
        startTime: String(row['Start Time'] ?? ''), endTime: String(row['End Time'] ?? ''),
        duration: Number(row.Duration ?? 0), retryCount: Number(row['Retry Count'] ?? 0),
        errorStep: String(row['Error Step'] ?? ''), errorMessage: String(row['Error Message'] ?? ''),
        screenshotPath: String(row['Screenshot Path'] ?? ''), tracePath: String(row['Trace Path'] ?? ''),
      });
    }
  }

  private flush(): void {
    const values = [...this.results.values()];
    const resultRows = values.map((result) => ({
      'Job ID': result.jobId, 'Model Number': result.modelNumber, 'Execution Status': result.executionStatus,
      UCID: result.ucid, 'Quotation Mode': result.quotationMode, 'OCA Config Status': result.ocaConfigStatus,
      'Service Experience': result.serviceExperience, 'Service Term': result.serviceTerm, 'Data Privacy': result.dataPrivacy,
      'Start BOM UCID': result.startBomId, 'End BOM UCID': result.endBomId, 'Associate End BOM': result.endBomAssociated,
      'End BOM Status': result.endBomStatus,
      'Start Billing Tier': result.startBillingTier, 'Start Billing Tier Custom Name': result.startBillingTierCustomName,
      'Start Allocated Memory': result.startAllocatedMemory, 'Start Server': result.startServerCount,
      'Start Used CPU Core': result.startUsedCpuCore, 'End Billing Tier': result.endBillingTier,
      'End Billing Tier Custom Name': result.endBillingTierCustomName, 'End Allocated Memory': result.endAllocatedMemory,
      'End Server': result.endServerCount, 'End Used CPU Core': result.endUsedCpuCore,
      'Selected Components': result.selectedComponents,
      'Start Time': result.startTime, 'End Time': result.endTime, Duration: result.duration,
      'Retry Count': result.retryCount, 'Error Step': result.errorStep, 'Error Message': result.errorMessage,
      'Screenshot Path': result.screenshotPath, 'Trace Path': result.tracePath,
    }));
    const starts = values.map((value) => value.startTime).filter(Boolean).sort();
    const ends = values.map((value) => value.endTime).filter(Boolean).sort();
    const summary = [{
      Total: values.length,
      Success: values.filter((r) => r.executionStatus === 'Success').length,
      Failed: values.filter((r) => r.executionStatus === 'Failed').length,
      Skipped: values.filter((r) => r.executionStatus === 'Skipped').length,
      Unsupported: values.filter((r) => r.executionStatus === 'Unsupported').length,
      'End BOM Generated': values.filter((r) => r.endBomStatus === 'Generated and associated').length,
      'Start Time': starts[0] ?? '', 'End Time': ends.at(-1) ?? '',
      'Total Duration': values.reduce((sum, result) => sum + result.duration, 0),
    }];
    const workbook = XLSX.utils.book_new();
    const resultsSheet = XLSX.utils.json_to_sheet(resultRows, { header: [...RESULT_HEADERS] });
    XLSX.utils.book_append_sheet(workbook, resultsSheet, 'Results');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), 'Summary');
    // The UCIDs the team records in its tracker, one row per model, at the end of the workbook.
    const bomRows = values.map((result) => ({
      'Job ID': result.jobId, 'Model Number': result.modelNumber,
      'Start BOM UCID': result.startBomId, 'End BOM UCID': result.endBomId,
      'End BOM Associated': result.endBomAssociated, 'Execution Status': result.executionStatus,
      Comments: result.errorMessage ? `${result.errorStep ? `${result.errorStep}: ` : ''}${result.errorMessage}`.slice(0, 500)
        : result.endBomStatus,
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bomRows, { header: [...BOM_UCID_HEADERS] }), 'BOM UCIDs');
    XLSX.writeFile(workbook, this.outputPath);
  }
}
