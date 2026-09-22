import { Directory, File, Paths } from 'expo-file-system';

/**
 * Catch history log export transformer.
 *
 * Client-side serialization engine: compiles raw catch logs into RFC 4180
 * CSV or pretty-printed JSON text, then isolates the payload on local disk
 * at `${Paths.cache}exports/catch_log_export.${format}` so anglers can share
 * their history externally even when fully off-grid.
 */

/** File formats supported by the local export and native-sharing bridge. */
export type CatchExportFormat = 'csv' | 'json';

/** Raw log row accepted by the export transformer; extra keys pass through JSON unchanged. */
export interface ExportableCatch {
  id?: string;
  species?: string | null;
  weight?: number | null;
  length?: number | null;
  lunarPhase?: string | null;
  moonPhase?: string | null;
  tags?: string[] | string | null;
  date?: string | null;
  created_at?: string | null;
  captured_at?: string | null;
  [key: string]: unknown;
}

/** Serialized text and isolated cache-file metadata returned by an export run. */
export interface CatchExportPayload {
  format: CatchExportFormat;
  /** Serialized text (CSV per RFC 4180, or pretty-printed JSON). */
  content: string;
  /** Isolated cache URI the payload was written to. */
  fileUri: string;
  /** Number of catch rows serialized. */
  recordCount: number;
}

/** Cache-directory segment used to isolate temporary exported files. */
export const CATCH_EXPORT_DIR_NAME = 'exports';
/** Stable temporary-file basename; the requested format supplies the extension. */
export const CATCH_EXPORT_BASENAME = 'catch_log_export';
const CSV_HEADERS = ['species', 'weight', 'length', 'lunar_phase', 'tags', 'date'] as const;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normaliseTags(tags: ExportableCatch['tags']): string {
  if (tags == null) return '';
  if (Array.isArray(tags)) return tags.map((t) => String(t)).join('; ');
  return String(tags);
}

function pickDate(catchRow: ExportableCatch): string {
  const raw = catchRow.date ?? catchRow.created_at ?? catchRow.captured_at ?? '';
  return raw == null ? '' : String(raw);
}

function pickLunarPhase(catchRow: ExportableCatch): string {
  const raw = catchRow.lunarPhase ?? catchRow.moonPhase ?? '';
  return raw == null ? '' : String(raw);
}

/**
 * RFC 4180 cell escaping: quote when the value contains a comma, quote,
 * CR or LF; embedded quotes double up.
 * @param value Cell value to encode.
 * @returns RFC 4180-safe cell text without a delimiter.
 * @complexity O(n), where n is the encoded value length.
 */
export function escapeExportCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serialize rows to RFC 4180 CSV with the fixed Fishlore catch-log header.
 * @param catches Rows to serialize; nullish values produce a header-only document.
 * @returns CRLF-delimited CSV text.
 * @complexity O(n × f), where n is rows and f is exported field text length.
 */
export function serialiseCatchesToCSV(catches: ExportableCatch[]): string {
  const rows = [CSV_HEADERS.join(',')];
  for (const catchRow of catches ?? []) {
    const weight = toFiniteNumber(catchRow.weight);
    const length = toFiniteNumber(catchRow.length);
    rows.push(
      [
        escapeExportCell(catchRow.species ?? ''),
        escapeExportCell(weight ?? ''),
        escapeExportCell(length ?? ''),
        escapeExportCell(pickLunarPhase(catchRow)),
        escapeExportCell(normaliseTags(catchRow.tags)),
        escapeExportCell(pickDate(catchRow)),
      ].join(','),
    );
  }
  return rows.join('\r\n');
}

/**
 * Serialize rows as human-readable JSON.
 * @param catches Rows to serialize; nullish values become an empty array.
 * @returns Two-space-indented JSON text.
 * @complexity O(n), excluding native JSON engine implementation details.
 */
export function serialiseCatchesToJSON(catches: ExportableCatch[]): string {
  return JSON.stringify(catches ?? [], null, 2);
}

function exportFileFor(format: CatchExportFormat): File {
  const dir = new Directory(Paths.cache, CATCH_EXPORT_DIR_NAME);
  if (!dir.exists) dir.create({ idempotent: true });
  return new File(dir, `${CATCH_EXPORT_BASENAME}.${format}`);
}

/**
 * Compile catch logs to `format` text and write the result to the isolated
 * cache path `${Paths.cache}exports/catch_log_export.${format}`.
 * @param catches Rows to serialize.
 * @param format CSV or JSON output format.
 * @returns Text payload, isolated cache URI, format, and record count.
 * @throws Propagates native file-system write errors so the share UI can report failure.
 * @complexity O(n) serialization plus native file-write cost.
 */
export async function generateCatchExportPayload(
  catches: ExportableCatch[],
  format: CatchExportFormat,
): Promise<CatchExportPayload> {
  const rows = catches ?? [];
  const content = format === 'json' ? serialiseCatchesToJSON(rows) : serialiseCatchesToCSV(rows);
  const file = exportFileFor(format);
  file.write(content);
  return { format, content, fileUri: file.uri, recordCount: rows.length };
}

/**
 * Best-effort wipe of one isolated export asset.
 * @param fileUri URI returned by {@link generateCatchExportPayload}.
 * @returns Nothing; native cleanup errors are contained and logged.
 * @complexity O(1), excluding native file-system cost.
 */
export function deleteCatchExportFile(fileUri: string): void {
  try {
    const file = new File(fileUri);
    if (file.exists) file.delete();
  } catch (error) {
    console.error('[catchExportEngine] Failed to delete export file:', error);
  }
}

/**
 * Best-effort wipe of all temporary export assets under `${Paths.cache}exports/`.
 * Intended for a share-sheet `finally` block so user data is not retained.
 * @returns Nothing; missing directories and native cleanup errors are contained.
 * @complexity O(n), where n is cached export entries.
 */
export function cleanupCatchExportFiles(): void {
  try {
    const dir = new Directory(Paths.cache, CATCH_EXPORT_DIR_NAME);
    if (!dir.exists) return;
    for (const item of dir.list()) {
      if (item instanceof File && item.exists) item.delete();
    }
  } catch (error) {
    console.error('[catchExportEngine] Failed to clean export directory:', error);
  }
}
