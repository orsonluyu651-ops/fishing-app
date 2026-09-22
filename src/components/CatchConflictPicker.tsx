import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import type { CatchConflict } from '../lib/offlineCatchQueue';
import { resolvePendingCatchConflict } from '../lib/offlineCatchQueue';
import type { ConflictResolutionStrategy } from '../lib/offlineQueueMutation';

/** Props for the accessible modal used to resolve a deferred sync collision. */
export interface CatchConflictPickerProps {
  /** Trapped collision awaiting the angler's decision. Null hides the overlay. */
  conflict: CatchConflict | null;
  /** Called after the transactional change is applied (or the row deferred). */
  onResolved?: (strategy: ConflictResolutionStrategy | 'deferred') => void;
  onDismiss?: () => void;
}

/**
 * High-fidelity conflict picker overlay.
 *
 * Mounted when a background sync row is suspended on a timestamp collision
 * with no resolution rule. The angler picks "Keep local edits"
 * (client-wins), "Adopt server history" (server-wins), or "Combine notes"
 * (merge-fields); the choice is applied transactionally via
 * `resolvePendingCatchConflict()` and the sync task is re-queued by leaving
 * the resolved entry for the next `syncQueue()` pass. "Decide later"
 * shelves the row without touching the queue.
 * Button state is disabled while a choice is processing to prevent duplicate
 * transactional updates. The modal uses the platform request-close pathway
 * for assistive technology and native back actions.
 * @param props Active collision and resolution callbacks.
 * @returns A modal overlay when a conflict exists, otherwise `null`.
 */
export function CatchConflictPicker({ conflict, onResolved, onDismiss }: CatchConflictPickerProps) {
  const [busy, setBusy] = useState<ConflictResolutionStrategy | 'defer' | null>(null);

  if (!conflict) return null;

  const choose = async (strategy: ConflictResolutionStrategy | 'defer') => {
    if (busy) return;
    setBusy(strategy);
    try {
      if (strategy === 'defer') {
        onResolved?.('deferred');
        onDismiss?.();
        return;
      }
      await resolvePendingCatchConflict(conflict.localEntry.id, strategy);
      onResolved?.(strategy);
      onDismiss?.();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Server changes detected</Text>
          <Text style={styles.body}>
            This catch was edited on another device while you were offline. Keep local edits, adopt
            server history, or combine notes?
          </Text>
          <Text style={styles.detail}>
            Local: {conflict.localEntry.species || 'Untitled'}
            {conflict.remoteSnapshot.species ? `  •  Server: ${conflict.remoteSnapshot.species}` : ''}
          </Text>
          <TouchableOpacity
            style={[styles.button, styles.primary]}
            onPress={() => choose('client-wins')}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Keep local edits"
            accessibilityHint="Keeps this device's changes and requeues the catch for sync"
            accessibilityState={{ disabled: busy !== null, busy: busy === 'client-wins' }}
          >
            <Text style={styles.buttonText}>
              {busy === 'client-wins' ? 'Keeping…' : 'Keep local edits'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondary]}
            onPress={() => choose('server-wins')}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Adopt server history"
            accessibilityHint="Discards this device's queued edit and keeps the server version"
            accessibilityState={{ disabled: busy !== null, busy: busy === 'server-wins' }}
          >
            <Text style={styles.secondaryText}>
              {busy === 'server-wins' ? 'Adopting…' : 'Adopt server history'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.secondary]}
            onPress={() => choose('merge-fields')}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Combine notes"
            accessibilityHint="Merges compatible local and server fields before requeuing sync"
            accessibilityState={{ disabled: busy !== null, busy: busy === 'merge-fields' }}
          >
            <Text style={styles.secondaryText}>
              {busy === 'merge-fields' ? 'Combining…' : 'Combine notes'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => choose('defer')}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Decide later"
            accessibilityHint="Leaves this catch deferred until you choose a resolution"
            accessibilityState={{ disabled: busy !== null, busy: busy === 'defer' }}
          >
            <Text style={styles.later}>Decide later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 380,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    marginBottom: 8,
  },
  detail: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 16,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  primary: {
    backgroundColor: '#0ea5e9',
  },
  secondary: {
    backgroundColor: '#e2e8f0',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  secondaryText: {
    color: '#0f172a',
    fontWeight: 'bold',
  },
  later: {
    textAlign: 'center',
    marginTop: 4,
    color: '#64748b',
  },
});
