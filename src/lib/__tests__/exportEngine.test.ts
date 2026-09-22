/**
 * Unit baseline for src/lib/exportEngine.ts.
 */
import { exportCatchesToCSV, exportCatchesToPDF, type CatchRecord } from '../exportEngine';
import { supabase } from '../supabase';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';

// Mock supabase with a builder pattern that supports select().eq().order() chaining
const mockQueryResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(async () => ({
            data: mockQueryResponse.data,
            error: mockQueryResponse.error,
          })),
        })),
      })),
    })),
    auth: {
      getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
    },
  },
}));

const SAMPLE_RECORDS: CatchRecord[] = [
  { id: 'c-1', weight: 12.5, species: 'Dusky Flathead', location_name: 'Moreton Bay', created_at: '2024-08-15T06:30:00Z' },
  { id: 'c-2', weight: 8.0, species: 'Yellowfin Whiting', location_name: 'North Stradbork', created_at: '2024-07-20T14:10:00Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryResponse.data = null;
  mockQueryResponse.error = null;
});

// ─────────────────────────────────────────────────────────────
// Spec 1 — exportCatchesToCSV failure contracts
// ─────────────────────────────────────────────────────────────
describe('exportCatchesToCSV', () => {
  it('returns false when the Supabase query surfaces an error', async () => {
    mockQueryResponse.error = new Error('network blip');

    const ok = await exportCatchesToCSV('user-x');

    expect(ok).toBe(false);
  });

  it('returns false when the query resolves with no rows', async () => {
    mockQueryResponse.data = [];

    const ok = await exportCatchesToCSV('user-x');

    expect(ok).toBe(false);
  });

  it('writes a CSV payload and shares it when records are present', async () => {
    const writeSpy = jest.spyOn(FileSystem, 'writeAsStringAsync').mockResolvedValueOnce(undefined as never);
    const shareSpy = jest.spyOn(Sharing, 'shareAsync').mockResolvedValueOnce(true as never);

    mockQueryResponse.data = SAMPLE_RECORDS;

    const ok = await exportCatchesToCSV('angler-1');

    expect(ok).toBe(true);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const written = writeSpy.mock.calls[0]![1] as string;
    expect(written).toContain('ID,Species,Weight (lbs),Location,Date');
    expect(written).toContain('Dusky Flathead');
    expect(shareSpy).toHaveBeenCalledTimes(1);
  });

  it('escapes double-quotes inside species and location fields', async () => {
    const buggy: CatchRecord = {
      id: 'c-3',
      weight: 5,
      species: 'Sheep "Head" Mackerel',
      location_name: 'Port "M" Jackson',
      created_at: '2024-09-01T00:00:00Z',
    };
    mockQueryResponse.data = [buggy];

    const writeSpy = jest.spyOn(FileSystem, 'writeAsStringAsync').mockResolvedValueOnce(undefined as never);

    await exportCatchesToCSV('user-x');

    const written = writeSpy.mock.calls[0]![1] as string;
    expect(written).toContain('Sheep ""Head"" Mackerel');
    expect(written).toContain('Port ""M"" Jackson');
  });
});

// ─────────────────────────────────────────────────────────────
// Spec 2 — exportCatchesToPDF contracts mirror the CSV surface
// ─────────────────────────────────────────────────────────────
describe('exportCatchesToPDF', () => {
  it('returns false when the Supabase query surfaces an error', async () => {
    mockQueryResponse.error = new Error('timeout');

    const ok = await exportCatchesToPDF('user-x', 'angler');

    expect(ok).toBe(false);
  });

  it('returns false when the query resolves with no rows', async () => {
    mockQueryResponse.data = [];

    const ok = await exportCatchesToPDF('user-x', 'angler');

    expect(ok).toBe(false);
  });

  it('renders an HTML document and shares the produced PDF URI', async () => {
    const printSpy = jest.spyOn(Print, 'printToFileAsync').mockResolvedValueOnce({ uri: 'file:///exports/report.pdf' } as never);
    const shareSpy = jest.spyOn(Sharing, 'shareAsync').mockResolvedValueOnce(true as never);

    mockQueryResponse.data = SAMPLE_RECORDS;

    const ok = await exportCatchesToPDF('angler-1', 'GoldCoast_Fisher');

    expect(ok).toBe(true);
    expect(printSpy).toHaveBeenCalledTimes(1);
    const htmlArg = printSpy.mock.calls[0]![0] as { html: string };
    expect(htmlArg.html).toContain('Angler Catch Summary Report');
    expect(htmlArg.html).toContain('@GoldCoast_Fisher');
    expect(htmlArg.html).toContain('Dusky Flathead');
    expect(shareSpy).toHaveBeenCalledTimes(1);
  });

  it('omits the table body token when the username is blank', async () => {
    mockQueryResponse.data = SAMPLE_RECORDS;

    const printSpy = jest.spyOn(Print, 'printToFileAsync').mockResolvedValueOnce({ uri: 'file:///exports/report.pdf' } as never);

    await exportCatchesToPDF('user-x', '');

    expect(printSpy).toHaveBeenCalledTimes(1);
    const htmlArg = printSpy.mock.calls[0]![0] as { html: string };
    expect(htmlArg.html).toContain('<strong>@</strong>');
  });
});

