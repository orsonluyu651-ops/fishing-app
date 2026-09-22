import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  cleanupCatchExportFiles,
  generateCatchExportPayload,
  type CatchExportFormat,
  type ExportableCatch,
} from '../lib/catchExportEngine';

export interface CatchExportControlsProps {
  /** Raw catch logs to compile and share. */
  catches: ExportableCatch[];
}

export type CatchLogShareOutcome = 'shared' | 'unavailable' | 'failed';

/**
 * Interactive share dashboard sheet for the Profile tab route.
 *
 * `triggerCatchLogShare(format)` builds the payload via
 * `generateCatchExportPayload()`, confirms platform capability through
 * `Sharing.isAvailableAsync()`, launches the native system share sheet, and
 * wipes the temporary asset under `${Paths.cache}exports/` once the sheet
 * interaction finishes or closes.
 */
export function triggerCatchLogShare(
  catches: ExportableCatch[],
  format: CatchExportFormat,
): Promise<CatchLogShareOutcome> {
  return (async () => {
    let fileUri: string | null = null;
    try {
      const payload = await generateCatchExportPayload(catches, format);
      fileUri = payload.fileUri;
      const available = await Sharing.isAvailableAsync();
      if (!available) return 'unavailable';
      await Sharing.shareAsync(fileUri, {
        mimeType: format === 'json' ? 'application/json' : 'text/csv',
        dialogTitle: 'Share Catch Log',
      });
      return 'shared';
    } catch (error) {
      console.error('[CatchExportControls] Catch log share failed:', error);
      return 'failed';
    } finally {
      cleanupCatchExportFiles();
    }
  })();
}

export function CatchExportControls({ catches }: CatchExportControlsProps) {
  const [sharing, setSharing] = useState<CatchExportFormat | null>(null);

  const handleShare = async (format: CatchExportFormat) => {
    if (sharing) return;
    setSharing(format);
    try {
      const outcome = await triggerCatchLogShare(catches, format);
      if (outcome === 'unavailable') {
        Alert.alert('Sharing unavailable', 'Native sharing is not available on this device.');
      } else if (outcome === 'failed') {
        Alert.alert('Export failed', 'The catch log could not be compiled or shared.');
      }
    } finally {
      setSharing(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Export Catch Log</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.button, sharing !== null && styles.buttonDisabled]}
          onPress={() => handleShare('csv')}
          disabled={sharing !== null}
        >
          {sharing === 'csv' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Share CSV</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.secondary, sharing !== null && styles.buttonDisabled]}
          onPress={() => handleShare('json')}
          disabled={sharing !== null}
        >
          {sharing === 'json' ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Text style={[styles.buttonText, styles.secondaryText]}>Share JSON</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  heading: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    backgroundColor: '#0284c7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: '#e2e8f0',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryText: {
    color: '#0f172a',
  },
});
