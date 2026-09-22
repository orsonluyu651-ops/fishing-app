/**
 * Catch history log export transformer + native test coverage.
 *
 * Covers generateCatchExportPayload (csv/json serialisation + isolated
 * cache write), the RFC 4180 cell escaper, and the triggerCatchLogShare
 * bridge (capability gate, share sheet launch, temp-file cleanup).
 */
/// <reference types="jest" />
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  cleanupCatchExportFiles,
  escapeExportCell,
  generateCatchExportPayload,
  serialiseCatchesToCSV,
  serialiseCatchesToJSON,
} from '../catchExportEngine';
import { triggerCatchLogShare } from '../../components/CatchExportControls';

const shareAsyncMock = Sharing.shareAsync as unknown as jest.Mock;
const isAvailableMock = (Sharing as unknown as { isAvailableAsync: jest.Mock }).isAvailableAsync;

beforeEach(() => {
  jest.clearAllMocks();
  cleanupCatchExportFiles();
});

describe('escapeExportCell (RFC 4180)', () => {
  it('quotes cells containing commas, quotes, CR or LF and doubles quotes', () => {
    expect(escapeExportCell('Nerang River, QLD')).toBe('"Nerang River, QLD"');
    expect(escapeExportCell('The "Secret" Snag')).toBe('"The ""Secret"" Snag"');
    expect(escapeExportCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeExportCell('a\rb')).toBe('"a\rb"');
  });

  it('passes plain values through and blanks nullish input', () => {
    expect(escapeExportCell('simple')).toBe('simple');
    expect(escapeExportCell(12.5)).toBe('12.5');
    expect(escapeExportCell(null)).toBe('');
    expect(escapeExportCell(undefined)).toBe('');
  });
});

describe('serialiseCatchesToCSV', () => {
  it('emits the fixed header plus one row per catch', () => {
    const csv = serialiseCatchesToCSV([
      {
        species: 'Dusky Flathead',
        weight: 4.2,
        length: 62,
        lunarPhase: 'full_moon',
        tags: ['dawn', 'tide, run-out'],
        date: '2026-03-22T08:00:00Z',
      },
    ]);
    expect(csv).toBe(
      'species,weight,length,lunar_phase,tags,date\r\n' +
        'Dusky Flathead,4.2,62,full_moon,"dawn; tide, run-out",2026-03-22T08:00:00Z',
    );
  });

  it('supports moonPhase/date aliases and blank rows', () => {
    const csv = serialiseCatchesToCSV([
      { species: 'Bream', moonPhase: 'new_moon', created_at: '2026-01-01T00:00:00Z' },
      {},
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('species,weight,length,lunar_phase,tags,date');
    expect(lines[1]).toBe('Bream,,,new_moon,,2026-01-01T00:00:00Z');
    expect(lines[2]).toBe(',,,,,');
  });
});

describe('serialiseCatchesToJSON', () => {
  it('pretty-prints the raw rows', () => {
    const rows = [{ species: 'Snapper', weight: 5 }];
    expect(serialiseCatchesToJSON(rows)).toBe(JSON.stringify(rows, null, 2));
  });
});

describe('generateCatchExportPayload', () => {
  it('writes CSV to the isolated cache path', async () => {
    const payload = await generateCatchExportPayload(
      [{ species: 'Flathead', weight: 8.4, date: '2026-03-22T08:00:00Z' }],
      'csv',
    );
    expect(payload.format).toBe('csv');
    expect(payload.recordCount).toBe(1);
    expect(payload.fileUri).toContain('exports/catch_log_export.csv');
    expect(payload.content).toContain('species,weight,length,lunar_phase,tags,date');
    const stored = await new File(payload.fileUri).text();
    expect(stored).toBe(payload.content);
  });

  it('writes pretty JSON to the isolated cache path', async () => {
    const rows = [{ species: 'Snapper', tags: ['reef'] }];
    const payload = await generateCatchExportPayload(rows, 'json');
    expect(payload.format).toBe('json');
    expect(payload.fileUri).toContain('exports/catch_log_export.json');
    expect(payload.content).toBe(JSON.stringify(rows, null, 2));
    const stored = await new File(payload.fileUri).text();
    expect(stored).toBe(payload.content);
  });
});

describe('triggerCatchLogShare', () => {
  it('checks capability, launches the share sheet, then wipes the temp file', async () => {
    isAvailableMock.mockResolvedValueOnce(true);
    shareAsyncMock.mockResolvedValueOnce(undefined);

    const outcome = await triggerCatchLogShare([{ species: 'Bream' }], 'csv');

    expect(outcome).toBe('shared');
    expect(isAvailableMock).toHaveBeenCalledTimes(1);
    expect(shareAsyncMock).toHaveBeenCalledTimes(1);
    expect(String(shareAsyncMock.mock.calls[0]![0])).toContain('exports/catch_log_export.csv');
    // Cleanup loop: the exports directory holds no surviving file assets.
    const dir = new Directory(Paths.cache, 'exports');
    expect(dir.list().filter((item) => item instanceof File && item.exists)).toHaveLength(0);
  });

  it('reports unavailable without sharing when the platform cannot share', async () => {
    isAvailableMock.mockResolvedValueOnce(false);

    const outcome = await triggerCatchLogShare([{ species: 'Bream' }], 'json');

    expect(outcome).toBe('unavailable');
    expect(shareAsyncMock).not.toHaveBeenCalled();
    const dir = new Directory(Paths.cache, 'exports');
    expect(dir.list().filter((item) => item instanceof File && item.exists)).toHaveLength(0);
  });
});
