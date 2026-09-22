import * as FileSystem from 'expo-file-system';
import { Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { supabase } from './supabase';

export interface CatchRecord {
  id: string;
  weight: number;
  species: string;
  location_name: string;
  created_at: string;
}

/**
 * Compiles catch matrices into comma-separated rows and triggers a native sharing dialogue wrapper.
 */
export async function exportCatchesToCSV(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('catches')
      .select('id, weight, species, location_name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) return false;

    const headers = 'ID,Species,Weight (lbs),Location,Date\n';
    const rows = (data as CatchRecord[]).map(c =>
      `"${c.id}","${c.species.replace(/"/g, '""')}",${c.weight},"${c.location_name.replace(/"/g, '""')}","${new Date(c.created_at).toLocaleDateString()}"`
    ).join('\n');

    const csvContent = headers + rows;
    const fileUri = `${Paths.document}catch_log_export_${Date.now()}.csv`;

    await FileSystem.writeAsStringAsync(fileUri, csvContent, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Catch Log Matrix' });
    return true;
  } catch (err) {
    console.error("CSV compilation sequence error:", err);
    return false;
  }
}

/**
 * Dynamically binds record tokens inside an isolated HTML string template to print structural data sheets.
 */
export async function exportCatchesToPDF(userId: string, username: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('catches')
      .select('id, weight, species, location_name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) return false;

    const listItemsHtml = (data as CatchRecord[]).map(c => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${new Date(c.created_at).toLocaleDateString()}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">${c.species}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${c.weight} lbs</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; color: #555;">${c.location_name}</td>
      </tr>
    `).join('');

    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 30px; color: #333; }
            h1 { color: #0284c7; font-size: 24px; margin-bottom: 5px; }
            p { color: #666; margin-top: 0; margin-bottom: 25px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { background-color: #f8fafc; color: #475569; text-align: left; padding: 12px 10px; font-weight: 600; border-bottom: 2px solid #e2e8f0; }
          </style>
        </head>
        <body>
          <h1>Angler Catch Summary Report</h1>
          <p>Generated profile sheet for: <strong>@${username}</strong> on ${new Date().toLocaleDateString()}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Species</th>
                <th>Weight</th>
                <th>Location Reference</th>
              </tr>
            </thead>
            <tbody>
              ${listItemsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const { uri } = await Print.printToFileAsync({ html: htmlContent });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Print Report' });
    return true;
  } catch (err) {
    console.error("PDF engine layout generation crash:", err);
    return false;
  }
}
