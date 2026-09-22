import * as FileSystem from 'expo-file-system';
import { escapeCSVCell, exportCatchLogsToCSV } from '../catchExportMarshaller';
import { CatchRecord } from '../exportEngine';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file://mock-documents/',
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  EncodingType: { UTF8: 'utf8' },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

describe('Catch History Log Export and CSV Marshalling Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('correctly escapes quotes and strings containing literal commas', () => {
    expect(escapeCSVCell('Nerang River, QLD')).toBe('"Nerang River, QLD"');
    expect(escapeCSVCell('The "Secret" Snag')).toBe('"The ""Secret"" Snag"');
    expect(escapeCSVCell(12.5)).toBe('12.5');
    expect(escapeCSVCell(null)).toBe('');
    expect(escapeCSVCell(undefined)).toBe('');
    expect(escapeCSVCell('simple')).toBe('simple');
  });

  it('converts complete log arrays into valid carriage-returned CSV strings successfully', async () => {
    const samples: CatchRecord[] = [
      { id: 'c1', weight: 8.4, species: 'Flathead', location_name: 'Broadwater', created_at: '2026-03-22T08:00:00Z' },
    ];

    const result = await exportCatchLogsToCSV(samples);
    expect(result.success).toBe(true);
    expect(result.csvString).toContain('ID,Species,Weight_Lbs,Location_Name,Created_At');
    expect(result.csvString).toContain('c1,Flathead,8.4,Broadwater,2026-03-22T08:00:00Z');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalled();
  });

  it('returns success: false when file writing throws an error', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    const result = await exportCatchLogsToCSV([{ id: 'x', weight: 1, species: 'Bream', location_name: 'A', created_at: new Date().toISOString() }]);
    expect(result.success).toBe(false);
    expect(result.fileUri).toBeNull();
    expect(result.csvString).toContain('Bream');
  });

  it('produces correct headers even when the record array is empty', async () => {
    const result = await exportCatchLogsToCSV([]);
    expect(result.success).toBe(true);
    expect(result.csvString).toBe('ID,Species,Weight_Lbs,Location_Name,Created_At');
  });

  it('escapes locations containing commas in the generated CSV string', async () => {
    const records: CatchRecord[] = [
      { id: 'g1', weight: 5.0, species: 'Snapper', location_name: 'Jumpinpin, Queensland', created_at: '2026-01-01T00:00:00Z' },
    ];

    const result = await exportCatchLogsToCSV(records);
    expect(result.csvString).toContain('"Jumpinpin, Queensland"');
  });

  it('handles null or undefined records gracefully', async () => {
    const result = await exportCatchLogsToCSV(null as unknown as CatchRecord[]);
    expect(result.success).toBe(true);
    expect(result.csvString).toBe('ID,Species,Weight_Lbs,Location_Name,Created_At');
  });
});
