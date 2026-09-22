import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { supabase } from '../../src/lib/supabase';
import {
  askFishloreRemote,
  describeAskFishloreError,
  type AskFishloreTurn,
} from '../../src/lib/askFishlore';
import { usePremiumStatus } from '@/lib/premiumAccess';
import { PremiumPaywall } from '@/components/PremiumPaywall';

// ════════════════════════════════════════════════════════════
// Ask Fishlore — the streaming/chat interface.
//
// Every question is proxied through the `ask-tidewire` Supabase Edge
// Function (docs/ai-assistant-spec.md §5): the provider key never lives on
// the device. Regulatory figures are the app's deterministic rule cards'
// job — the model is anchored to fall back to them, and the copy below
// keeps presenting this screen as a "guide", never an "AI".
// ════════════════════════════════════════════════════════════

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

const SUGGESTIONS = [
  'What bait works for bream in winter?',
  'How do tides affect flathead fishing?',
  'How does catch verification work?',
];

const MAX_HISTORY_TURNS = 6;
const MAX_MESSAGE_LENGTH = 2000;

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `m-${Date.now()}-${messageIdCounter}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type Gate = 'checking' | 'signin' | 'pending-premium' | 'paywall' | 'ok';

export default function AskFishloreScreen() {
  const router = useRouter();
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const [gate, setGate] = useState<Gate>('checking');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);

  // ── Gate: the Edge Function requires a signed-in session (401 otherwise). ──
    const { isPro, loading: premiumLoading } = usePremiumStatus();

  // ── Gate: the Edge Function requires a signed-in session (401 otherwise). ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setGate(session ? 'pending-premium' : 'signin');
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setGate(session ? 'pending-premium' : 'signin');
    });
    return () => subscription.unsubscribe();
  }, []);

  // Once the session is confirmed, resolve the premium gate.
  useEffect(() => {
    if (gate === 'pending-premium' && !premiumLoading) {
      setGate(isPro ? 'ok' : 'paywall');
    }
  }, [gate, premiumLoading, isPro]);

  // Re-check premium status after a successful upgrade.
  const handleUpgradeSuccess = useCallback(
    async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setGate('signin');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_pro')
        .eq('id', session.user.id)
        .maybeSingle();
      if (profile?.is_pro === true) {
        setGate('ok');
      }
    },
    [],
  );

  // Report-only regional context for the guide. Permission is checked, never
  // requested from this screen; no fix and no permission means no coordinates.
  const readCoordinates = useCallback(async () => {
    try {
      const { granted } = await Location.getForegroundPermissionsAsync();
      if (!granted) return null;
      const last = await Location.getLastKnownPositionAsync();
      return last
        ? { latitude: last.coords.latitude, longitude: last.coords.longitude }
        : null;
    } catch {
      return null;
    }
  }, []);

  const send = useCallback(
    async (rawInput: string) => {
      const message = rawInput.trim();
      if (!message || pending || gate !== 'ok') return;

      // Only the most recent turns ride along; the function clamps again.
      const history: AskFishloreTurn[] = messages
        .map((item) => ({ role: item.role, content: item.text }))
        .slice(-MAX_HISTORY_TURNS);

      setInput('');
      setPending(true);
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId(), role: 'user', text: message, timestamp: Date.now() },
      ]);

      try {
        const coordinates = await readCoordinates();
        const result = await askFishloreRemote(message, { history, coordinates });
        setMessages((prev) => [
          ...prev,
          { id: nextMessageId(), role: 'assistant', text: result.text, timestamp: Date.now() },
        ]);
      } catch (error) {
        const copy = await describeAskFishloreError(error);
        setMessages((prev) => [
          ...prev,
          { id: nextMessageId(), role: 'assistant', text: copy, timestamp: Date.now() },
        ]);
      } finally {
        setPending(false);
      }
    },
    [pending, gate, messages, readCoordinates],
  );

  // Keep the newest message in view: fires whenever list content grows.
  const handleContentSizeChange = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const canSend = !pending && input.trim().length > 0 && gate === 'ok';

  const handleSubmit = useCallback(() => {
    if (!canSend) return;
    void send(input);
  }, [canSend, input, send]);

  // ── Render ───────────────────────────────────────────────────────────────
    if (gate === 'checking' || gate === 'pending-premium') {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (gate === 'signin') {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="chatbubbles-outline" size={40} color="#007AFF" />
        <Text style={styles.gateTitle}>Sign in to ask Fishlore</Text>
        <Text style={styles.gateBody}>
          Your guide keeps its conversation per account, so it needs a signed-in session.
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/(auth)/sign-in')}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Text style={styles.buttonText}>Sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

    if (gate === 'paywall') {
    return (
      <View style={[styles.container, styles.center]}>
        <PremiumPaywall onUpgradeSuccess={handleUpgradeSuccess} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Ask Fishlore</Text>
          <Text style={styles.headerSubtitle}>Your regional fishing guide</Text>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          onContentSizeChange={handleContentSizeChange}
          ListEmptyComponent={<EmptyState onPick={send} />}
          contentContainerStyle={messages.length === 0 ? styles.emptyContent : styles.listContent}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={11}
        />

        <View style={styles.inputDock}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            editable={!pending}
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Ask about bait, rigs, tides, species…"
            placeholderTextColor="#9ca3af"
            returnKeyType="send"
            onSubmitEditing={handleSubmit}
            accessibilityLabel="Ask Fishlore message input"
          />
          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
          >
            {pending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{message.text}</Text>
        <Text style={[styles.bubbleTime, isUser && styles.bubbleTimeUser]}>
          {formatTime(message.timestamp)}
        </Text>
      </View>
    </View>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="fish-outline" size={44} color="#007AFF" />
      <Text style={styles.emptyTitle}>Ask your guide</Text>
      <Text style={styles.emptyBody}>
        Educational fishing help for South East Queensland. Verified size and bag limits come
        from the app&apos;s own rule cards.
      </Text>
      {SUGGESTIONS.map((suggestion) => (
        <TouchableOpacity
          key={suggestion}
          style={styles.suggestion}
          onPress={() => onPick(suggestion)}
          accessibilityRole="button"
        >
          <Text style={styles.suggestionText}>{suggestion}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },

  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111' },
  headerSubtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },

  bubbleRow: { flexDirection: 'row', marginVertical: 4, paddingHorizontal: 4 },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAssistant: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleUser: { backgroundColor: '#007AFF', borderBottomRightRadius: 4 },
  bubbleAssistant: {
    backgroundColor: '#f3f4f6',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#eceef1',
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 4, alignSelf: 'flex-end' },
  bubbleTimeUser: { color: 'rgba(255,255,255,0.75)' },

  emptyState: { alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111', marginTop: 12 },
  emptyBody: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
  suggestion: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 8,
  },
  suggestionText: { fontSize: 13, fontWeight: '600', color: '#007AFF', textAlign: 'center' },

  inputDock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fafafa',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#c7d7f5' },

  gateTitle: { fontSize: 18, fontWeight: '700', color: '#111', marginTop: 14 },
  gateBody: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 8, lineHeight: 19 },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 18,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
