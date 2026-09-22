import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { CatchRecord } from './exportEngine';

export interface ExportFileResult {
  fileUri: string | null;
  csvString: string;
  success: boolean;
}

/**
 * Escapes characters and strings to safely comply with standard RFC 4180 CSV specifications.
 */
export function escapeCSVCell(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return '';
  const strValue = String(value);
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n') || strValue.includes('\r')) {
    return `"${strValue.replace(/"/g, '""')}"`;
  }
  return strValue;
}

const _fs = FileSystem as unknown as { documentDirectory: string; EncodingType: { UTF8: string } };

/**
 * Transforms data arrays into text streams and writes them straight to native sharing layers.
 */
export async function exportCatchLogsToCSV(records: CatchRecord[]): Promise<ExportFileResult> {
  const safeRecords = records || [];

  // Construct standard data headers
  const headers = ['ID', 'Species', 'Weight_Lbs', 'Location_Name', 'Created_At'];
  const rows = [headers.join(',')];

  for (const record of safeRecords) {
    const rowCells = [
      escapeCSVCell(record.id),
      escapeCSVCell(record.species),
      escapeCSVCell(record.weight),
      escapeCSVCell(record.location_name),
      escapeCSVCell(record.created_at),
    ];
    rows.push(rowCells.join(','));
  }

  const csvString = rows.join('\r\n');
  const targetFileUri = `${_fs.documentDirectory}angler_catch_logs_export.csv`;

  try {
    await FileSystem.writeAsStringAsync(targetFileUri, csvString, { encoding: FileSystem.EncodingType.UTF8 });

    const isSharingAvailable = await Sharing.isAvailableAsync();
    if (isSharingAvailable) {
      await Sharing.shareAsync(targetFileUri, { mimeType: 'text/csv', dialogTitle: 'Export Catch History' });
    }

    return { fileUri: targetFileUri, csvString, success: true };
  } catch (err) {
    console.error('Data marshalling file export execution error:', err);
    return { fileUri: null, csvString, success: false };
  }
}
