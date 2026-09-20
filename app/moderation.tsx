import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';

// ════════════════════════════════════════════════════════════
// Phase 5 — content moderation queue (admin-only).
//
// Reads public.moderation_reports (migration 0008), the security_invoker
// view that joins each report to its reporter + resolved target. RLS does
// the gating: a non-admin physically cannot see anyone else's reports, and
// cannot delete posts/comments/catches — this screen is just the honest UI
// on top of that. For a non-admin the screen exits the same way the data
// does.
// ════════════════════════════════════════════════════════════

interface ReportRow {
  report_id: string;
  reporter_user_id: string;
  reporter_username: string | null;
  target_type: 'post' | 'comment' | 'catch';
  target_id: string;
  reason: string;
  details: string | null;
  status: string;
  reported_at: string;
  // post target (NULL when not a post) — view resolves exactly one branch
  post_id: string | null;
  post_author_username: string | null;
  post_text: string | null;
  // comment target
  comment_id: string | null;
  comment_author_username: string | null;
  comment_text: string | null;
  // catch target
  catch_id: string | null;
  catch_author_username: string | null;
  catch_species: string | null;
  catch_length: number | null;
  catch_verified: string | null;
  catch_captured_at: string | null;
}

type Gate = 'checking' | 'signin' | 'denied' | 'ok';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam',
  abuse: 'Abuse or harassment',
  inappropriate: 'Inappropriate content',
  misinformation: 'Misinformation',
  other: 'Other',
};

const TARGET_LABELS: Record<string, string> = {
  post: 'Post',
  comment: 'Comment',
  catch: 'Catch',
};

function statusBadgeStyle(status: string) {
  switch (status) {
    case 'open':
      return { bg: '#fffbeb', border: '#fde68a', text: '#b45309' };
    case 'under_review':
      return { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' };
    case 'resolved':
      return { bg: '#ecfdf5', border: '#6ee7b7', text: '#047857' };
    default:
      return { bg: '#f3f4f6', border: '#e5e7eb', text: '#6b7280' };
  }
}

export default function ModerationScreen() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>('checking');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  // ── Gate: signed in + admin. RLS backs this up server-side too. ───────
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return setGate('signin');
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        if (!prof?.is_admin) return setGate('denied');
        setGate('ok');
      } catch {
        setGate('denied');
      }
    })();
  }, []);

  // ── Load the moderation queue ──────────────────────────────
  async function loadReports() {
    try {
      setLoadError(null);
      const { data, error } = await supabase
        .from('moderation_reports')
        .select('*')
        .order('reported_at', { ascending: false });
      if (error) throw error;
      setReports((data || []) as ReportRow[]);
    } catch (error: any) {
      console.error('Error loading reports:', error.message);
      if (/relation .* does not exist/i.test(error.message)) {
        setLoadError(
          'The moderation queue needs migration 0008 applied in Supabase (SQL editor). ' +
            'It reads the live moderation_reports view — nothing to add here until that runs.',
        );
      } else {
        setLoadError(error.message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (gate === 'ok') {
      setLoading(true);
      loadReports();
    }
  }, [gate]);

  // ── Actions ─────────────────────────────────────────────────
  async function setStatus(report: ReportRow, status: string) {
    const { error } = await supabase
      .from('content_reports')
      .update({ status })
      .eq('id', report.report_id);
    if (error) return Alert.alert('Error', error.message);
    await loadReports();
  }

  function confirmDelete(report: ReportRow) {
    const message =
      `This permanently removes the reported ${TARGET_LABELS[report.target_type].toLowerCase()}. This cannot be undone.`;

    // React Native's Alert.alert is a no-op on web (Expo web) — it silently
    // renders nothing in Safari/Chrome, so the Delete never fires. Use the
    // browser's native confirm dialog there instead.
    if (Platform.OS === 'web') {
      const browserConfirm = (globalThis as any).confirm as ((m: string) => boolean) | undefined;
      if (typeof browserConfirm === 'function' && browserConfirm(`Delete reported content?\n\n${message}`)) {
        deleteTarget(report);
      }
      return;
    }

    Alert.alert(
      'Delete reported content?',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteTarget(report) },
      ],
      { cancelable: true },
    );
  }

  async function deleteTarget(report: ReportRow) {
    try {
      if (report.target_type === 'catch') {
        // A catch's auto-post has catch_id = this, and posts.catch_id is
        // "on delete set null" — delete the post FIRST or it would survive
        // as a stranded blank caption.
        const postDel = await supabase.from('posts').delete().eq('catch_id', report.target_id);
        if (postDel.error) throw postDel.error;
        const catchDel = await supabase.from('catches').delete().eq('id', report.target_id);
        if (catchDel.error) throw catchDel.error;
      } else if (report.target_type === 'post') {
        const { error } = await supabase.from('posts').delete().eq('id', report.target_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('post_comments').delete().eq('id', report.target_id);
        if (error) throw error;
      }
      // Target gone — close the report as resolved (the row stays as an
      // audit trail; there is deliberately no moderator delete on reports).
      await supabase
        .from('content_reports')
        .update({ status: 'resolved' })
        .eq('id', report.report_id);
      await loadReports();
    } catch (error: any) {
      Alert.alert('Delete failed', error.message);
    }
  }

  // ── What actions a report shows depends on its status ──────
  function renderActions(report: ReportRow) {
    const buttons: { label: string; onPress: () => void; destructive?: boolean }[] = [];
    if (report.status === 'open') {
      buttons.push({ label: 'Under review', onPress: () => setStatus(report, 'under_review') });
      buttons.push({ label: 'Resolve', onPress: () => setStatus(report, 'resolved') });
      buttons.push({ label: 'Dismiss', onPress: () => setStatus(report, 'dismissed') });
    } else if (report.status === 'under_review') {
      buttons.push({ label: 'Resolve', onPress: () => setStatus(report, 'resolved') });
      buttons.push({ label: 'Dismiss', onPress: () => setStatus(report, 'dismissed') });
    } else {
      buttons.push({ label: 'Reopen', onPress: () => setStatus(report, 'open') });
    }
    buttons.push({ label: 'Delete content', onPress: () => confirmDelete(report), destructive: true });

    return (
      <View style={styles.actionsRow}>
        {buttons.map((b) => (
          <TouchableOpacity
            key={b.label}
            style={[styles.actionButton, b.destructive && styles.actionButtonDanger]}
            onPress={b.onPress}
          >
            <Text style={[styles.actionText, b.destructive && styles.actionTextDanger]}>{b.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // ── One report card's target excerpt ────────────────────────
  function renderTarget(report: ReportRow) {
    let author: string | null = null;
    let body: string;

    if (report.target_type === 'post') {
      author = report.post_author_username;
      body = report.post_text || '(no caption — catch post)';
    } else if (report.target_type === 'comment') {
      author = report.comment_author_username;
      body = report.comment_text || '(empty comment)';
    } else {
      author = report.catch_author_username;
      const size = report.catch_length != null ? ` · ${report.catch_length} cm` : '';
      body = report.catch_species || 'unknown species';
      if (size) body += size;
    }

    // If the target row is gone (deleted by its owner), the view's left join
    // resolves to NULL — say so rather than showing an empty box.
    const gone =
      (report.target_type === 'post' && !report.post_id) ||
      (report.target_type === 'comment' && !report.comment_id) ||
      (report.target_type === 'catch' && !report.catch_id);

    return (
      <View style={styles.targetBox}>
        <Text style={styles.targetLabel}>
          {TARGET_LABELS[report.target_type]} by {author ?? 'anonymous'}
        </Text>
        {gone ? (
          <Text style={styles.targetGone}>(deleted already — nothing to remove)</Text>
        ) : (
          <Text style={styles.targetBody}>{body}</Text>
        )}
      </View>
    );
  }

  const visibleReports = filter === 'open' ? reports.filter((r) => r.status === 'open') : reports;
  const pendingCount = reports.filter((r) => r.status === 'open').length;

  // ── Gate screens ────────────────────────────────────────────
  if (gate === 'checking') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (gate === 'signin') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Sign in required</Text>
        <Text style={styles.emptyHint}>Sign in as a moderator to review content reports.</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/(auth)/sign-in')}>
          <Text style={styles.buttonText}>Go to sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={() => router.back()}>
          <Text style={styles.linkText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (gate === 'denied') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Not authorized</Text>
        <Text style={styles.emptyHint}>
          This screen is for moderators only. Your report queue — content you've reported — lives
          behind the flag on each post.
        </Text>
        <TouchableOpacity style={styles.linkButton} onPress={() => router.back()}>
          <Text style={styles.linkText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header, matching the spot-detail screen's non-tab pattern */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Moderation</Text>
      </View>

      <View style={styles.filterBar}>
        {(['open', 'all'] as const).map((f) => {
          const active = filter === f;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f === 'open' ? `Open (${pendingCount})` : 'All'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Moderation queue not loaded</Text>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : (
        <FlatList
          data={visibleReports}
          keyExtractor={(item) => item.report_id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadReports();
              }}
            />
          }
          renderItem={({ item }) => {
            const badge = statusBadgeStyle(item.status);
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(item.reporter_username || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.headerText}>
                    <Text style={styles.username}>
                      {item.reporter_username ?? 'anonymous'}
                      <Text style={styles.date}> · reported {timeAgo(item.reported_at)}</Text>
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
                    <Text style={[styles.statusText, { color: badge.text }]}>
                      {item.status.replace('_', ' ')}
                    </Text>
                  </View>
                </View>

                <View style={styles.reasonRow}>
                  <View style={styles.reasonChip}>
                    <Text style={styles.reasonText}>
                      {REASON_LABELS[item.reason] ?? item.reason}
                    </Text>
                  </View>
                  {item.details ? <Text style={styles.details}>“{item.details}”</Text> : null}
                </View>

                {renderTarget(item)}
                {renderActions(item)}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>
                {filter === 'open' ? 'Nothing waiting' : 'No reports yet'}
              </Text>
              <Text style={styles.emptyHint}>
                {filter === 'open'
                  ? 'All caught up. New reports land here when anglers flag content.'
                  : 'When anglers flag posts or comments, they queue here for review.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },

  header: {
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: { marginRight: 15 },
  backButtonText: { color: '#007AFF', fontSize: 16 },
  title: { fontSize: 24, fontWeight: 'bold', flex: 1, textAlign: 'center', marginRight: 60 },

  filterBar: { flexDirection: 'row', padding: 12, gap: 8 },
  chip: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#444' },
  chipTextActive: { color: '#fff' },

  errorCard: {
    margin: 20,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
    borderRadius: 12,
    padding: 18,
  },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#9a3412', marginBottom: 6 },
  errorText: { fontSize: 13, color: '#c2410c', lineHeight: 19 },

  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#555', textAlign: 'center' },
  emptyHint: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 8, lineHeight: 19 },

  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eee',
  },

  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  headerText: { flex: 1 },
  username: { fontSize: 14, fontWeight: '600', color: '#333' },
  date: { fontSize: 12, color: '#999', fontWeight: '400' },

  statusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  reasonRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  reasonChip: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  reasonText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  details: { fontSize: 12, color: '#6b7280', fontStyle: 'italic', flexShrink: 1 },

  targetBox: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  targetLabel: { fontSize: 12, fontWeight: '600', color: '#9ca3af', marginBottom: 4 },
  targetBody: { fontSize: 14, color: '#444', lineHeight: 19 },
  targetGone: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic' },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#fff',
  },
  actionButtonDanger: { borderColor: '#fecaca', backgroundColor: '#fff' },
  actionText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  actionTextDanger: { color: '#DC2626' },

  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { marginTop: 16 },
  linkText: { color: '#007AFF', fontSize: 15 },
});