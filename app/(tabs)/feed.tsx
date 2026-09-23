import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Modal, Image, Alert, LayoutAnimation, AppState } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import {
  discardQueuedCatch,
  enqueueCatch,
  FAILED_ATTEMPT_THRESHOLD,
  isFailedEntry,
  isNetworkError,
  loadQueue,
  newQueueId,
  pendingForUser,
  syncQueue,
  type QueuedCatch,
} from '../../src/lib/offlineCatchQueue';
import { updateQueuedCatchEntry } from '../../src/lib/offlineQueueMutation';
import { optimizeCatchImage } from '../../src/lib/mediaOptimizer';
import { askAssistant, type AssistantAnswer } from '../../src/lib/assistant';
import { fetchFollowingIds, fetchFollowingCatchesRange } from '../../src/lib/socialEngine';
import { generateMockCatches } from '../../src/lib/mockDataSeed';

interface CatchItem {
  id: string;
  title: string;
  species: string;
  location_name: string;
  user_id: string;
  profiles: { username: string };
  likes_count: number;
  comments_count: number;
  has_liked: boolean;
}

interface CommentItem {
  id: string;
  text: string;
  created_at: string;
  profiles: { username: string };
  // True while the optimistic copy is still waiting on its database insert.
  pending?: boolean;
}

// Strict page size for the windowed feed query: every scroll iteration pulls
// exactly this many rows via .range(start, start + PAGE_SIZE - 1).
const PAGE_SIZE = 10;

// Longest comment the database CHECK constraint accepts
// (char_length(btrim(text)) between 1 and 1000) — enforced client-side so an
// over-long comment fails instantly instead of on the wire.
const MAX_COMMENT_LENGTH = 1000;

const formatCommentTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export default function FeedScreen() {
  const animateLayout = () =>
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

  const [catches, setCatches] = useState<CatchItem[]>([]);
  const [loading, setLoading] = useState(true);

  // On first render, if the feed board is completely empty (no live catches
  // resolved yet — offline, untouched, or an empty Supabase response), bridge
  // in a small randomized Gold Coast dataset so the social cards always have
  // something beautiful to show. The real feed query, once it completes,
  // naturally replaces this set via setCatches, so this is a pure startup
  // default bridge rather than a replacement for the live feed path.
  useEffect(() => {
    if (catches.length === 0) {
      const seed = generateMockCatches();
      setCatches(
        seed.map((item) => ({
          id: item.id,
          title: `${item.species} Catch`,
          species: item.species,
          location_name: item.location,
          user_id: 'seed',
          profiles: { username: item.angler },
          likes_count: 0,
          comments_count: 0,
          has_liked: false,
        }))
      );
    }
  }, []);
  // Pagination state: loadingMore mirrors the in-flight "next page" fetch and
  // hasMore turns off once a window comes back short (or empty).
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [commentModalVisible, setCommentModalVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [species, setSpecies] = useState('');
  const [length, setLength] = useState('');
  const [location, setLocation] = useState<any>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [submittingCatch, setSubmittingCatch] = useState(false);
  // The signed-in user's queued catches, not just a count: the feed renders a
  // placeholder card per pending item and the banner classifies them.
  const [pendingEntries, setPendingEntries] = useState<QueuedCatch[]>([]);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  // State for editing a failed/queued catch entry
  const [editingEntry, setEditingEntry] = useState<QueuedCatch | null>(null);
  const [editSpecies, setEditSpecies] = useState('');
  const [editLength, setEditLength] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  // The contextual comment list for the currently open post, plus its loader.
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [feedMode, setFeedMode] = useState<'global' | 'following'>('global');
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  // Mirror of currentUserId for callbacks registered once on mount (the NetInfo
  // listener). Without it those callbacks close over the initial null and would
  // never be able to scope a sync to the signed-in user.
  const currentUserIdRef = useRef<string | null>(null);
  // Mirror of the rendered feed rows, kept in lockstep with every setCatches
  // (and re-synced by the effect below). Callbacks that must read the freshest
  // list — the pagination offset and per-post like toggles — read this instead
  // of closing over stale render state.
  const catchesRef = useRef<CatchItem[]>([]);
  // One promise chain per post id: a rapid double-tap on the like button
  // queues behind the previous toggle instead of racing an insert against a
  // delete for the same row.
  const likeChainsRef = useRef<Map<string, Promise<void>>>(new Map());
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantQuery, setAssistantQuery] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState<AssistantAnswer | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);

  // Keep the row mirror in lockstep with state (pagination and optimistic
  // interactions also write it directly; this is the safety net for the rest).
  useEffect(() => {
    catchesRef.current = catches;
  }, [catches]);

  /**
   * Maps one raw feed_posts row onto the card shape the list renders.
   */
  const toCatchItem = (item: any): CatchItem => ({
    id: item.id || Math.random().toString(),
    title: item.caption || item.title || 'Fishing Catch',
    species: item.species || 'Unknown Species',
    location_name: item.location_name || 'Gold Coast Waters',
    user_id: item.user_id,
    profiles: { username: item.username || 'Anonymous Angler' },
    likes_count: item.likes_count ?? 0,
    comments_count: item.comments_count ?? 0,
    has_liked: item.is_liked_by_me ?? false,
  });

  /**
   * Pulls one window of feed rows. The ordering is fixed (newest first, id as
   * the tiebreaker) so the .range() windows stay stable across pages — without
   * a deterministic sort, pages could overlap or skip rows. start/end are
   * inclusive row indices; each window is exactly PAGE_SIZE rows.
   */
  const fetchFeedPage = async (start: number): Promise<any[]> => {
    if (feedMode === 'following') {
      if (followingIds.length === 0) return [];
      const { data, error } = await fetchFollowingCatchesRange(followingIds, start, start + PAGE_SIZE - 1);
      if (error) throw error;
      return data ?? [];
    }
    const { data, error } = await supabase
      .from('feed_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    return data ?? [];
  };

  const initializeFeed = async (): Promise<string | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
        currentUserIdRef.current = user.id;
        const ids = await fetchFollowingIds(user.id);
        setFollowingIds(ids);
      }

      // Page 0 resets the pagination window: a refresh (new catch logged,
      // offline queue flushed) re-reads the newest rows and drops older pages a
      // fresh sort may have shifted.
      const rows = await fetchFeedPage(0);
      const formattedCatches = rows.map(toCatchItem);
      catchesRef.current = formattedCatches;
      setCatches(formattedCatches);
      // A short first window means the whole feed fits on one page — stop here
      // instead of firing an empty "next page" request on the first scroll.
      setHasMore(rows.length >= PAGE_SIZE);
    } catch (err) {
      console.error('Supabase feed error:', err);
    } finally {
      setLoading(false);
    }
    return currentUserIdRef.current;
  };

  /**
   * Appends the next PAGE_SIZE rows when the user scrolls into the lower 20%
   * of the list (onEndReachedThreshold). Guarded so at most one window is ever
   * in flight, and deduplicated by id: a catch posted between two page fetches
   * shifts every window down, so a naive append could repeat a rendered row.
   */
  const loadMoreCatches = async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const start = catchesRef.current.length;
      const rows = await fetchFeedPage(start);
      const seenIds = new Set(catchesRef.current.map((item) => item.id));
      const fresh = rows.map(toCatchItem).filter((item) => !seenIds.has(item.id));
      const merged = [...catchesRef.current, ...fresh];
      catchesRef.current = merged;
      setCatches(merged);
      // The feed has ended when a window comes back short — or when a full
      // window's rows were all duplicates of what is already rendered.
      setHasMore(rows.length >= PAGE_SIZE && fresh.length > 0);
    } catch (error: any) {
      // A failed page load keeps the already-rendered feed usable; hasMore
      // stays true so the next scroll attempt retries the same window.
      console.error('Error loading more catches:', error);
      setHasMore(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const refreshPendingQueue = async (userId: string | null = currentUserIdRef.current) => {
    // Scope the queue view to this user: catches queued by another account stay
    // parked until their owner signs in, so they are not "waiting to sync" here.
    const queue = await loadQueue();
    setPendingEntries(pendingForUser(queue, userId));
  };

  const runQueueSync = async (
    silent: boolean = false,
    userId: string | null = currentUserIdRef.current,
    includeFailed: boolean = false,
  ) => {
    // Without a signed-in user there is nothing we are allowed to push: the
    // storage RLS only accepts writes under auth.uid()'s own folder.
    if (!userId) return;
    const queue = await loadQueue();
    if (pendingForUser(queue, userId).length === 0) {
      setPendingEntries([]);
      return;
    }
    setSyncingQueue(true);
    try {
      const { synced, failed } = await syncQueue(userId, { includeFailed });
      const remaining = await loadQueue();
      setPendingEntries(pendingForUser(remaining, userId));
      if (!silent && synced > 0) {
        Alert.alert(
          'Offline catches synced',
          failed > 0
            ? `${synced} catch(es) uploaded, ${failed} still pending.`
            : `${synced} queued catch(es) uploaded.`,
        );
      }
      if (synced > 0) await initializeFeed();
    } catch (error) {
      console.error('Error syncing offline queue:', error);
    } finally {
      setSyncingQueue(false);
    }
  };

  // An explicit retry from the banner: the user is asking, so entries that
  // automatic sync now skips (already at the failure threshold) are included.
  const retryQueuedCatches = () => runQueueSync(false, currentUserIdRef.current, true);

  /**
   * Drops one stuck catch from the device.
   *
   * Asks first because it is destructive and irreversible: the queue entry and
   * its cached photo are both erased and the catch never reached the feed.
   * Drop the Alert wrapper if a single tap is preferred.
   */
  const handleDiscardQueuedCatch = (entry: QueuedCatch) => {
    Alert.alert(
      'Discard queued catch?',
      `"${entry.species}" never reached the feed. Discarding removes it from this device permanently.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            const discarded = await discardQueuedCatch(entry.id);
            if (!discarded) return;
            // Re-read the queue so the card unmounts immediately.
            await refreshPendingQueue(currentUserIdRef.current);
          },
        },
      ],
    );
  };

  /**
   * Opens the edit modal for a failed/queued catch entry.
   * Pre-fills the form with the entry's current data.
   */
  const openEditDraft = (entry: QueuedCatch) => {
    setEditingEntry(entry);
    setEditSpecies(entry.species);
    setEditLength(entry.length?.toString() ?? '');
    setEditPhotoUri(entry.photoUri);
  };

  /**
   * Closes the edit modal without saving.
   */
  const closeEditDraft = () => {
    setEditingEntry(null);
    setEditSpecies('');
    setEditLength('');
    setEditPhotoUri(null);
  };

  /**
   * Saves edits to a queued catch entry.
   * Uses optimistic UI updates after the mutation succeeds.
   */
  const saveEditDraft = async () => {
    if (!editingEntry) return;

    if (!editSpecies.trim()) {
      Alert.alert('Species required', 'Please enter the fish species.');
      return;
    }

    setIsSavingEdit(true);

    try {
      // Build partial update data
      const partialData: Partial<QueuedCatch> = {
        species: editSpecies.trim(),
        length: editLength ? parseFloat(editLength) : null,
        photoUri: editPhotoUri,
      };

      // Update the queued catch entry
      const updated = await updateQueuedCatchEntry(editingEntry.id, partialData);

      if (updated) {
        // Optimistic UI update: refresh the queue to reflect changes
        await refreshPendingQueue(currentUserIdRef.current);
        closeEditDraft();
        Alert.alert('Saved', 'Your draft has been updated.');
      } else {
        Alert.alert('Error', 'Failed to update the draft. The entry may have been removed.');
      }
    } catch (error) {
      console.error('Error saving edit:', error);
      Alert.alert('Error', 'An error occurred while saving your changes.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const userId = await initializeFeed();
      if (cancelled) return;
      await refreshPendingQueue(userId);
      // Flush anything left over from a previous session now that we know who
      // is signed in, instead of waiting for the next connectivity change.
      await runQueueSync(true, userId);
    };
    bootstrap();

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        runQueueSync(true, currentUserIdRef.current);
      }
    });

    // A connectivity *change* is not the only moment a pending queue deserves a
    // chance to flush. An app killed while offline and relaunched while online,
    // or resumed after the user switched away, may never observe a transition.
    // The 'active' foreground state covers both. It only fires on transitions,
    // so it does not duplicate the bootstrap sync above.
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const userId = currentUserIdRef.current;
      refreshPendingQueue(userId);
      runQueueSync(true, userId);
    });

    return () => {
      cancelled = true;
      // NetInfo hands back a bare unsubscribe function; AppState hands back an
      // EmitterSubscription. Hence the two different shapes.
      unsubscribeNetInfo();
      appStateSubscription.remove();
    };
  }, []);

  /**
   * Applies a change to one feed card through the row mirror, so state and the
   * freshest-read ref move together. This is the single write path for
   * optimistic interactions (like flips, comment counts).
   */
  const applyCatchUpdate = (postId: string, updater: (item: CatchItem) => CatchItem) => {
    catchesRef.current = catchesRef.current.map((item) =>
      item.id === postId ? updater(item) : item,
    );
    setCatches(catchesRef.current);
  };

  const performLikeToggle = async (postId: string) => {
    const userId = currentUserIdRef.current;
    if (!userId) {
      Alert.alert('Sign in required', 'Sign in before reacting to catches.');
      return;
    }
    const current = catchesRef.current.find((item) => item.id === postId);
    if (!current) return;
    const nextLiked = !current.has_liked;

    // The optimistic flip happens first, unconditionally — the database write
    // below is a background confirmation, never a gate on the UI.
    applyCatchUpdate(postId, (item) => ({
      ...item,
      has_liked: nextLiked,
      likes_count: Math.max(0, item.likes_count + (nextLiked ? 1 : -1)),
    }));

    try {
      if (nextLiked) {
        // Upsert rather than insert: a replayed tap after a lost response is
        // deduplicated on the (post_id, user_id) primary key instead of
        // surfacing a 23505 unique violation as a hard failure.
        const { error } = await supabase
          .from('post_likes')
          .upsert(
            { post_id: postId, user_id: userId },
            { onConflict: 'post_id,user_id', ignoreDuplicates: true },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', userId);
        if (error) throw error;
      }
    } catch (error: any) {
      if (isNetworkError(error)) {
        // Network dropped mid-toggle: keep the optimistic state and let the
        // next foreground refresh reconcile it against the database. No dialog,
        // no flicker — the interaction stays responsive through the outage.
        console.warn('Like sync interrupted while offline; the feed will reconcile on refresh.');
      } else {
        // A definitive database rejection (RLS, constraint): quietly roll the
        // card back so the UI never disagrees with what was actually stored.
        console.error('Error syncing like:', error);
        applyCatchUpdate(postId, (item) => ({
          ...item,
          has_liked: !nextLiked,
          likes_count: Math.max(0, item.likes_count + (nextLiked ? -1 : 1)),
        }));
      }
    }
  };

  const toggleLike = (postId: string) => {
    const previous = likeChainsRef.current.get(postId) ?? Promise.resolve();
    const next = previous
      .then(() => performLikeToggle(postId))
      .catch((error) => console.error('Like toggle chain failed:', error));
    likeChainsRef.current.set(postId, next);
  };

  const pickPhoto = async () => {
    try {
      setLoadingPhoto(true);
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to attach a catch photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const pickedUri = result.assets[0].uri;
        // Optimize before the URI reaches anything else: the direct bucket
        // upload and the offline queue both persist from photoUri, so bounding
        // the resolution here shrinks every downstream path, and the re-encode
        // strips GPS EXIF before the photo is even copied locally.
        try {
          const optimized = await optimizeCatchImage(pickedUri);
          animateLayout();
          setPhotoUri(optimized.uri);
        } catch (optimizeError) {
          // Fail closed on privacy: an unprocessed photo could still carry the
          // spot's coordinates in its EXIF, so it must not be attached as-is.
          console.error('Error optimizing catch photo:', optimizeError);
          Alert.alert(
            'Could not process photo',
            'The photo could not be prepared for upload. Please try another photo.',
          );
        }
      }
    } catch (error) {
      console.error('Error picking photo:', error);
      Alert.alert('Could not pick photo', 'Please try again.');
    } finally {
      setLoadingPhoto(false);
    }
  };

  const resetCatchForm = () => {
    animateLayout();
    setSpecies('');
    setLength('');
    setLocation(null);
    setPhotoUri(null);
    setModalVisible(false);
  };

  const submitCatch = async () => {
    const trimmedSpecies = species.trim();
    if (!trimmedSpecies) {
      Alert.alert('Species required', 'Enter the species before submitting your catch.');
      return;
    }
    if (!currentUserId) {
      Alert.alert('Sign in required', 'Sign in before logging a catch.');
      return;
    }
    const parsedLength = length.trim() === '' ? null : Number(length.trim());
    if (parsedLength !== null && (!Number.isFinite(parsedLength) || parsedLength <= 0)) {
      Alert.alert('Invalid length', 'Length must be a positive number in centimetres.');
      return;
    }

    // Mint this catch's idempotency key BEFORE the first write. Declared outside
    // the try so the offline fallback can hand the very same id to the queue: if
    // this insert commits but its response is lost, the queued retry then
    // deduplicates against that row instead of logging a second catch.
    const clientQueueId = newQueueId();

    try {
      setSubmittingCatch(true);

      // 1) Package the photo: upload to the private catch-media bucket under the user's folder.
      let mediaPath: string | null = null;
      if (photoUri) {
        const extension = photoUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
        const filePath = `${currentUserId}/${Date.now()}.${extension}`;
        const file = new File(photoUri);
        const bytes = await file.bytes();
        const contentType =
          extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
        const { error: uploadError } = await supabase.storage
          .from('catch-media')
          .upload(filePath, bytes, { contentType, upsert: false });
        if (uploadError) throw uploadError;
        mediaPath = filePath;
      }

      // 2) Package catch details + GPS coords together (location lives in environmental per schema).
      // Build the coordinate payload through an explicitly typed mapping block so the
      // latitude/longitude object literal always conforms to a declared shape instead
      // of being inferred inline at the insert() call site.
      const environmental: { latitude: number; longitude: number } | Record<string, never> = location
        ? { latitude: location.latitude, longitude: location.longitude }
        : {};
      // upsert with ignoreDuplicates rather than a plain insert: client_queue_id
      // is unique, so repeating the same submit is skipped instead of raising
      // 23505, and a deduplicated write returns zero rows - a success, not an
      // error, hence .select() without .single().
      const { data: inserted, error: insertError } = await supabase
        .from('catches')
        .upsert(
          {
            user_id: currentUserId,
            client_queue_id: clientQueueId,
            species: trimmedSpecies,
            length: parsedLength,
            media_path: mediaPath,
            environmental,
          },
          { onConflict: 'client_queue_id', ignoreDuplicates: true },
        )
        .select('id');
      if (insertError) throw insertError;

      // 3) Refresh the feed (the create_feed_post_on_catch trigger auto-creates the post).
      resetCatchForm();
      await initializeFeed();
      await refreshPendingQueue();
    } catch (error: any) {
      console.error('Error submitting catch:', error);
      if (isNetworkError(error)) {
        try {
          // Same id as the direct attempt above: if that write actually committed
          // and only its response was lost, the replay deduplicates against it
          // instead of logging a second catch.
          await enqueueCatch(
            {
              userId: currentUserId,
              species: trimmedSpecies,
              length: parsedLength,
              latitude: location?.latitude ?? null,
              longitude: location?.longitude ?? null,
              photoUri,
            },
            clientQueueId,
          );
          await refreshPendingQueue();
          Alert.alert(
            'Saved offline',
            'No connection — your catch is queued and will sync automatically when you are back online.',
          );
          resetCatchForm();
          return;
        } catch (queueError) {
          console.error('Error queueing catch offline:', queueError);
        }
      }
      Alert.alert('Could not log catch', error?.message ?? 'Please try again.');
    } finally {
      setSubmittingCatch(false);
    }
  };

  /**
   * Loads the comment history for the post the user tapped into. Network
   * failures degrade quietly: the overlay still opens with a usable composer,
   * the history just stays empty until a refresh.
   */
  const loadComments = async (postId: string) => {
    setLoadingComments(true);
    try {
      const { data, error } = await supabase
        .from('post_comments')
        .select('id, text, created_at, profiles(username)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setComments(
        (data ?? []).map((row: any) => ({
          id: row.id,
          text: row.text,
          created_at: row.created_at,
          profiles: { username: row.profiles?.username ?? 'Anonymous Angler' },
        })),
      );
    } catch (error: any) {
      if (isNetworkError(error)) {
        console.warn('Comment history unavailable while offline; the composer stays usable.');
      } else {
        console.error('Error loading comments:', error);
      }
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  const openComments = (postId: string) => {
    animateLayout();
    setSelectedPostId(postId);
    setNewComment('');
    setComments([]);
    setCommentModalVisible(true);
    void loadComments(postId);
  };

  const closeComments = () => {
    animateLayout();
    setCommentModalVisible(false);
    setSelectedPostId(null);
    setComments([]);
    setNewComment('');
  };

  /**
   * Posts a comment with optimistic append: the text lands in the open list
   * and the card's comment count ticks up immediately, while the database
   * insert runs in the background. A network drop keeps the optimistic comment
   * (flagged pending) for a later refresh to reconcile; a definitive database
   * rejection quietly withdraws it and the count.
   */
  const submitComment = async () => {
    const postId = selectedPostId;
    const userId = currentUserIdRef.current;
    const commentText = newComment.trim();
    if (!postId || !commentText || !userId) return;
    if (commentText.length > MAX_COMMENT_LENGTH) {
      Alert.alert('Comment too long', 'Comments are limited to 1000 characters.');
      return;
    }

    setNewComment('');
    animateLayout();

    const optimisticId = `local-${Date.now()}`;
    const optimisticComment: CommentItem = {
      id: optimisticId,
      text: commentText,
      created_at: new Date().toISOString(),
      profiles: { username: 'You' },
      pending: true,
    };
    setComments((prev) => [...prev, optimisticComment]);
    applyCatchUpdate(postId, (item) => ({
      ...item,
      comments_count: item.comments_count + 1,
    }));

    try {
      const { data, error } = await supabase
        .from('post_comments')
        .insert({ post_id: postId, user_id: userId, text: commentText })
        .select('id, text, created_at, profiles(username)')
        .single();
      if (error) throw error;
      // Swap the placeholder for the committed row (real id + author handle).
      // The row is cast explicitly: supabase-js types an embedded resource from
      // a select string as an array (`{ username: any }[]`) even though the
      // server returns a single object for this belongs-to join, so the direct
      // cast doesn't sufficiently overlap. Assert through `unknown` and the
      // runtime shape (one profile row) below.
      const committedRow = data as unknown as {
        id: string;
        text: string;
        created_at: string;
        profiles: { username: string } | null;
      } | null;
      if (committedRow) {
        const committed: CommentItem = {
          id: committedRow.id,
          text: committedRow.text,
          created_at: committedRow.created_at,
          profiles: { username: committedRow.profiles?.username ?? 'You' },
        };
        setComments((prev) => prev.map((c) => (c.id === optimisticId ? committed : c)));
      }
    } catch (error: any) {
      if (isNetworkError(error)) {
        // Offline: the optimistic comment stays (marked pending) and the next
        // refresh reconciles it against the database.
        console.warn('Comment sync interrupted while offline; it will reconcile on refresh.');
      } else {
        console.error('Error posting comment:', error);
        setComments((prev) => prev.filter((c) => c.id !== optimisticId));
        applyCatchUpdate(postId, (item) => ({
          ...item,
          comments_count: Math.max(0, item.comments_count - 1),
        }));
      }
    }
  };

  const openAssistant = () => {
    animateLayout();
    setAssistantQuery('');
    setAssistantAnswer(null);
    setAssistantVisible(true);
  };

  const closeAssistant = () => {
    animateLayout();
    setAssistantVisible(false);
  };

  const submitAssistantQuery = async (preset?: string) => {
    const query = (preset ?? assistantQuery).trim();
    if (!query || assistantLoading) return;
    setAssistantLoading(true);
    try {
      const answer = await askAssistant(query);
      animateLayout();
      setAssistantAnswer(answer);
    } catch (error) {
      console.error('Error asking guide:', error);
      Alert.alert('Guide unavailable', 'Could not load an answer right now. Please try again.');
    } finally {
      setAssistantLoading(false);
    }
  };

  // Two buckets the banner reports separately: still being retried, versus failed
  // often enough to need the user's attention.
  const waitingCount = pendingEntries.filter((entry) => !isFailedEntry(entry)).length;
  const failedCount = pendingEntries.filter(isFailedEntry).length;
  const pendingSummary = [
    waitingCount > 0 ? `${waitingCount} waiting to sync` : null,
    failedCount > 0 ? `${failedCount} failed after ${FAILED_ATTEMPT_THRESHOLD} attempts` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  if (feedMode === 'following' && followingIds.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
        <Text style={{ textAlign: 'center', color: '#888', fontSize: 16, lineHeight: 24 }}>
          Your network is quiet! Explore the global feed or leaderboard to find local anglers to follow.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', padding: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' }}>
        <TouchableOpacity
          style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderBottomWidth: feedMode === 'global' ? 2 : 0, borderBottomColor: '#007AFF' }}
          onPress={() => { setFeedMode('global'); }}
        >
          <Text style={{ fontWeight: feedMode === 'global' ? 'bold' : 'normal', color: feedMode === 'global' ? '#007AFF' : '#666' }}>Global</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderBottomWidth: feedMode === 'following' ? 2 : 0, borderBottomColor: '#007AFF' }}
          onPress={() => { setFeedMode('following'); }}
        >
          <Text style={{ fontWeight: feedMode === 'following' ? 'bold' : 'normal', color: feedMode === 'following' ? '#007AFF' : '#666' }}>Following</Text>
        </TouchableOpacity>
      </View>
      {pendingEntries.length > 0 && (
        <TouchableOpacity
          style={[styles.syncBanner, failedCount > 0 && styles.syncBannerAlert]}
          onPress={retryQueuedCatches}
          disabled={syncingQueue}
          accessibilityRole="summary"
          accessibilityState={{ busy: syncingQueue }}
          accessibilityHint="Retries uploading your saved offline catches"
          accessibilityLabel={
            syncingQueue
              ? `Syncing offline catches. ${pendingSummary}.`
              : `Offline catch queue. ${pendingSummary}. Activate to retry syncing.`
          }
        >
          <Ionicons
            name={failedCount > 0 ? 'alert-circle-outline' : 'cloud-offline-outline'}
            size={18}
            color={failedCount > 0 ? '#B91C1C' : '#E65100'}
          />
          <Text style={[styles.syncBannerText, failedCount > 0 && styles.syncBannerTextAlert]}>
            {syncingQueue ? 'Syncing offline catches...' : `${pendingSummary} — tap to retry`}
          </Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={catches}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          pendingEntries.length > 0 ? (
            <View style={styles.pendingList}>
              {pendingEntries.map((entry) => {
                const failedEntry = isFailedEntry(entry);
                // The card is grouped into one screen-reader element only while
                // there is nothing actionable inside it. Grouping a card that
                // holds a Discard button would hide that button from assistive
                // tech, so `accessible` is switched off for failed entries.
                return (
                  <View
                    key={entry.id}
                    style={[styles.card, styles.pendingCard]}
                    accessible={!failedEntry}
                    accessibilityRole="summary"
                    accessibilityLabel={
                      `Queued catch, ${entry.species}` +
                      (entry.length !== null ? `, ${entry.length} centimetres` : '') +
                      (entry.photoUri ? ', with photo' : '') +
                      (failedEntry
                        ? `. Needs attention after ${entry.attempts} failed sync attempts.`
                        : '. Saved on this device, waiting to sync.')
                    }
                  >
                    <View style={styles.pendingBadgeRow}>
                      <View style={styles.pendingBadgeGroup}>
                        <Ionicons
                          name={failedEntry ? 'alert-circle-outline' : 'cloud-upload-outline'}
                          size={13}
                          color={failedEntry ? '#B91C1C' : '#B45309'}
                        />
                        <Text style={[styles.pendingBadge, failedEntry && styles.pendingBadgeAlert]}>
                          {failedEntry ? 'Needs attention' : 'Queued offline'}
                        </Text>
                      </View>
                      {failedEntry ? (
                        <View style={styles.pendingActionRow}>
                          <TouchableOpacity
                            style={styles.pendingEdit}
                            onPress={() => openEditDraft(entry)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit draft: ${entry.species}`}
                            accessibilityHint="Opens a form to modify this queued catch before it syncs"
                          >
                            <Ionicons name="pencil-outline" size={13} color="#2563EB" />
                            <Text style={styles.pendingEditText}>Edit Draft</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.pendingDiscard}
                            onPress={() => handleDiscardQueuedCatch(entry)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Discard queued catch, ${entry.species}`}
                            accessibilityHint="Removes this catch and its photo from this device"
                          >
                            <Ionicons name="trash-outline" size={13} color="#B91C1C" />
                            <Text style={styles.pendingDiscardText}>Discard</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.title}>
                      🐟 {entry.species}
                      {entry.length !== null ? ` — ${entry.length} cm` : ''}
                    </Text>
                    <Text style={styles.details}>Saved on this device — not yet on the feed</Text>
                  </View>
                );
              })}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.username}>@{item.profiles.username}</Text>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.details}>🐟 {item.species} | 📍 {item.location_name}</Text>
            
            <View style={styles.socialBar}>
              <TouchableOpacity
                onPress={() => toggleLike(item.id)}
                style={styles.socialButton}
                accessibilityRole="button"
                accessibilityLabel={`${item.has_liked ? 'Unlike' : 'Like'} catch by ${item.profiles.username}`}
                accessibilityHint="Toggles your like on this catch"
                accessibilityState={{ selected: item.has_liked }}
              >
                <Ionicons
                  name={item.has_liked ? 'heart' : 'heart-outline'}
                  size={22}
                  color={item.has_liked ? '#ef4444' : '#64748b'}
                />
                <Text style={styles.socialText}>{item.likes_count}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => openComments(item.id)}
                style={styles.socialButton}
                accessibilityRole="button"
                accessibilityLabel={`Open comments on catch by ${item.profiles.username}`}
                accessibilityHint="Opens the comment list for this catch"
              >
                <Ionicons name="chatbubble-outline" size={20} color="#64748b" />
                <Text style={styles.socialText}>{item.comments_count}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        onEndReached={loadMoreCatches}
        onEndReachedThreshold={0.2}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerSpinner}>
              <ActivityIndicator size="small" color="#0284c7" />
              <Text style={styles.footerSpinnerText}>Loading more catches…</Text>
            </View>
          ) : !hasMore && catches.length > 0 ? (
            <Text style={styles.endOfFeed}>You're all caught up 🎣</Text>
          ) : null
        }
      />

      {/* Contextual comment overlay: the tapped post's list + composer */}
      <Modal
        visible={commentModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={closeComments}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Comments</Text>
            {loadingComments ? (
              <View style={styles.commentLoading}>
                <ActivityIndicator size="small" color="#0284c7" />
              </View>
            ) : comments.length === 0 ? (
              <Text style={styles.commentEmpty}>
                No comments yet — be the first to say something.
              </Text>
            ) : (
              <FlatList
                data={comments}
                keyExtractor={(comment) => comment.id}
                style={styles.commentList}
                renderItem={({ item: comment }) => (
                  <View style={[styles.commentRow, comment.pending && styles.commentPending]}>
                    <Text style={styles.commentUsername}>@{comment.profiles.username}</Text>
                    <Text style={styles.commentText}>{comment.text}</Text>
                    <Text style={styles.commentTime}>{formatCommentTime(comment.created_at)}</Text>
                  </View>
                )}
              />
            )}
            <TextInput
              style={styles.input}
              placeholder="Type your fishing comment..."
              value={newComment}
              onChangeText={setNewComment}
              multiline
              maxLength={MAX_COMMENT_LENGTH}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={closeComments} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitComment}
                style={[styles.submitBtn, (!newComment.trim() || !currentUserId) && styles.submitBtnDisabled]}
                disabled={!newComment.trim() || !currentUserId}
                accessibilityRole="button"
                accessibilityLabel="Post comment"
                accessibilityState={{ disabled: !newComment.trim() || !currentUserId }}
              >
                <Text style={styles.submitText}>Post</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    {/* FAB */}
        <TouchableOpacity style={[styles.fab, { bottom: 88 }]} onPress={() => { animateLayout(); setModalVisible(true); }}><Text style={styles.fabText}>+</Text></TouchableOpacity>
      {/* Ask Fishlore — curated fishing guide */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: '#0284c7' }]}
        onPress={openAssistant}
        accessibilityLabel="Ask Fishlore guide"
      >
        <Ionicons name="chatbubble-ellipses-outline" size={26} color="#fff" />
      </TouchableOpacity>
<Modal animationType="slide" transparent={true} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
  <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'flex-end' }}>
    <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 10 }}>
      
      {/* Drag Indicator / Header */}
      <View style={{ width: 40, height: 5, backgroundColor: '#E5E5EA', borderRadius: 3, alignSelf: 'center', marginBottom: 20 }} />
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#1C1C1E', marginBottom: 20, textAlign: 'center' }}>🐟 Log Your Catch</Text>
      
      {/* Form Fields Section */}
      <View style={{ gap: 14, marginBottom: 24 }}>
        <View>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#8E8E93', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fish Species</Text>
          <TextInput style={{ backgroundColor: '#F2F2F7', borderRadius: 12, padding: 14, fontSize: 16, color: '#1C1C1E' }} placeholder="e.g., Dusky Flathead" placeholderTextColor="#AEAEB2" value={species} onChangeText={setSpecies} />
        </View>

        <View>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#8E8E93', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Length (cm)</Text>
          <TextInput style={{ backgroundColor: '#F2F2F7', borderRadius: 12, padding: 14, fontSize: 16, color: '#1C1C1E' }} placeholder="e.g., 45" placeholderTextColor="#AEAEB2" keyboardType="numeric" value={length} onChangeText={setLength} />
        </View>

        {/* UI Placeholders for Advanced Data */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: photoUri ? '#E3F2FD' : '#F2F2F7', padding: 14, borderRadius: 12, borderStyle: photoUri ? 'solid' : 'dashed', borderWidth: 1, borderColor: photoUri ? '#007AFF' : '#C7C7CC' }}
            onPress={pickPhoto}
            disabled={loadingPhoto}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#007AFF' }}>
              {loadingPhoto ? '⏳ Loading...' : photoUri ? '🖼️ Photo Added' : '📸 Add Photo'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
     style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: location ? '#E8F5E9' : '#F2F2F7', padding: 14, borderRadius: 12, borderStyle: location ? 'solid' : 'dashed', borderWidth: 1, borderColor: location ? '#34C759' : '#C7C7CC' }} 
     disabled={loadingLocation}
     onPress={async () => {
       try {
         setLoadingLocation(true);
         let { status } = await Location.requestForegroundPermissionsAsync();
         if (status !== 'granted') {
           alert('Permission to access location was denied');
           return;
         }
         let currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
         animateLayout();
         setLocation({ latitude: Number(currentLoc.coords.latitude), longitude: Number(currentLoc.coords.longitude) });
       } catch (error) {
         console.error('Error fetching location:', error);
         alert('Could not fetch location. Please try again.');
       } finally {
         setLoadingLocation(false);
       }
     }}
   >
     <Text style={{ fontSize: 15, fontWeight: '600', color: '#34C759' }}>
       {loadingLocation ? '🛰️ Locating...' : location ? '✅ Located' : '📍 Add Location'}
     </Text>
   </TouchableOpacity>
        </View>
        {location && (
          <Text style={{ fontSize: 12, color: '#34C759', marginTop: 8, textAlign: 'center' }}>
            📍 {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
          </Text>
        )}
        {photoUri && (
          <View style={{ marginTop: 8, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#C7C7CC', position: 'relative' }}>
            <Image source={{ uri: photoUri }} style={{ width: '100%', height: 160 }} resizeMode="cover" />
            <TouchableOpacity
              onPress={() => { animateLayout(); setPhotoUri(null); }}
              style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <View style={{ gap: 10 }}>
        <TouchableOpacity
          style={{ backgroundColor: submittingCatch ? '#8E8E93' : '#007AFF', padding: 16, borderRadius: 14, alignItems: 'center', shadowColor: '#007AFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3 }}
          onPress={submitCatch}
          disabled={submittingCatch}
        >
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>
            {submittingCatch ? 'Logging Catch...' : 'Submit Catch'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={{ padding: 16, borderRadius: 14, alignItems: 'center' }} onPress={resetCatchForm}>
          <Text style={{ color: '#8E8E93', fontSize: 16, fontWeight: '500' }}>Cancel</Text>
        </TouchableOpacity>
      </View>

    </View>
  </View>
</Modal>

{/* Edit Draft Modal — for modifying failed/queued catch entries */}
{editingEntry && (
  <Modal animationType="slide" transparent={true} visible={true} onRequestClose={closeEditDraft}>
    <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'flex-end' }}>
      <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 10 }}>
        
        {/* Drag Indicator / Header */}
        <View style={{ width: 40, height: 5, backgroundColor: '#E5E5EA', borderRadius: 3, alignSelf: 'center', marginBottom: 20 }} />
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#1C1C1E', marginBottom: 20, textAlign: 'center' }}>✏️ Edit Draft</Text>
        
        {/* Form Fields Section */}
        <View style={{ gap: 14, marginBottom: 24 }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#8E8E93', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fish Species</Text>
            <TextInput style={{ backgroundColor: '#F2F2F7', borderRadius: 12, padding: 14, fontSize: 16, color: '#1C1C1E' }} placeholder="e.g., Dusky Flathead" placeholderTextColor="#AEAEB2" value={editSpecies} onChangeText={setEditSpecies} />
          </View>

          <View>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#8E8E93', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Length (cm)</Text>
            <TextInput style={{ backgroundColor: '#F2F2F7', borderRadius: 12, padding: 14, fontSize: 16, color: '#1C1C1E' }} placeholder="e.g., 45" placeholderTextColor="#AEAEB2" keyboardType="numeric" value={editLength} onChangeText={setEditLength} />
          </View>

          {/* Photo Section */}
          <View style={{ gap: 12 }}>
            <TouchableOpacity
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: editPhotoUri ? '#E3F2FD' : '#F2F2F7', padding: 14, borderRadius: 12, borderStyle: editPhotoUri ? 'solid' : 'dashed', borderWidth: 1, borderColor: editPhotoUri ? '#007AFF' : '#C7C7CC' }}
              onPress={async () => {
                try {
                  const result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ImagePicker.MediaTypeOptions.Images,
                    quality: 0.7,
                  });
                  if (!result.canceled && result.assets && result.assets[0]) {
                    // Optimize and copy the image to a local file
                    const optimized = await optimizeCatchImage(result.assets[0].uri);
                    setEditPhotoUri(optimized.uri);
                  }
                } catch (error) {
                  console.error('Error picking photo:', error);
                }
              }}
              disabled={isSavingEdit}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#007AFF' }}>
                {isSavingEdit ? '⏳ Saving...' : editPhotoUri ? '🖼️ Photo Added' : '📸 Add/Change Photo'}
              </Text>
            </TouchableOpacity>
          </View>
          
          {editPhotoUri && (
            <View style={{ marginTop: 8, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#C7C7CC', position: 'relative' }}>
              <Image source={{ uri: editPhotoUri }} style={{ width: '100%', height: 160 }} resizeMode="cover" />
              <TouchableOpacity
                onPress={() => setEditPhotoUri(null)}
                disabled={isSavingEdit}
                style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={{ gap: 10 }}>
          <TouchableOpacity
            style={{ backgroundColor: isSavingEdit ? '#8E8E93' : '#007AFF', padding: 16, borderRadius: 14, alignItems: 'center', shadowColor: '#007AFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3 }}
            onPress={saveEditDraft}
            disabled={isSavingEdit}
          >
            <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>
              {isSavingEdit ? 'Saving...' : 'Save Changes'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={{ padding: 16, borderRadius: 14, alignItems: 'center' }} onPress={closeEditDraft} disabled={isSavingEdit}>
            <Text style={{ color: '#8E8E93', fontSize: 16, fontWeight: '500' }}>Cancel</Text>
          </TouchableOpacity>
        </View>

      </View>
    </View>
  </Modal>
)}

      {/* Ask Fishlore guide modal */}
      <Modal visible={assistantVisible} animationType="slide" transparent={true} onRequestClose={closeAssistant}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ask Fishlore</Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
              Curated Gold Coast fishing guide — size limits, spots, bait, rigs &amp; how logging works.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. What size can I keep a flathead?"
              value={assistantQuery}
              onChangeText={setAssistantQuery}
              multiline
              onSubmitEditing={() => submitAssistantQuery()}
            />
            {assistantLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <ActivityIndicator size="small" color="#0284c7" />
              </View>
            ) : assistantAnswer ? (
              <View style={{ backgroundColor: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' }}>
                {assistantAnswer.title ? (
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 6 }}>
                    {assistantAnswer.title}
                  </Text>
                ) : null}
                <Text style={{ fontSize: 14, color: '#0f172a', lineHeight: 20 }}>{assistantAnswer.text}</Text>
                {assistantAnswer.followUps.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                    {assistantAnswer.followUps.slice(0, 3).map((followUp) => (
                      <TouchableOpacity
                        key={followUp}
                        style={{ backgroundColor: '#e0f2fe', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 }}
                        onPress={() => { setAssistantQuery(followUp); submitAssistantQuery(followUp); }}
                      >
                        <Text style={{ fontSize: 12, color: '#0284c7', fontWeight: '600' }}>{followUp}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={closeAssistant} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => submitAssistantQuery()} style={styles.submitBtn} disabled={assistantLoading}>
                <Text style={styles.submitText}>{assistantLoading ? 'Asking…' : 'Ask'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', paddingTop: 12 },
  card: { backgroundColor: '#fff', padding: 16, marginHorizontal: 12, marginBottom: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  username: { fontWeight: 'bold', color: '#0284c7', marginBottom: 4 },
  title: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  details: { fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 12 },
  socialBar: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#f1f5f9', paddingTop: 8 },
  socialButton: { flexDirection: 'row', alignItems: 'center', marginRight: 24 },
  socialText: { marginLeft: 6, color: '#475569', fontSize: 14, fontWeight: '500' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12, color: '#0f172a' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, minHeight: 80, textAlignVertical: 'top', marginBottom: 16 },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between' },
  cancelBtn: { padding: 12, flex: 1, alignItems: 'center' },
  cancelText: { color: '#64748b', fontWeight: '600' },
  submitBtn: { backgroundColor: '#0284c7', padding: 12, flex: 1, alignItems: 'center', borderRadius: 8 },
  submitText: { color: '#fff', fontWeight: '600' },
  syncBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFF8E1', borderColor: '#FFB300', borderWidth: 1, marginHorizontal: 12, marginBottom: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  syncBannerAlert: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  syncBannerText: { color: '#E65100', fontSize: 13, fontWeight: '700' },
  syncBannerTextAlert: { color: '#B91C1C' },
  pendingList: { marginBottom: 4 },
  pendingCard: { opacity: 0.6, borderStyle: 'dashed', backgroundColor: '#f1f5f9' },
  pendingBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  pendingBadgeGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingDiscard: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  pendingDiscardText: { fontSize: 11, fontWeight: '700', color: '#B91C1C' },
  pendingEdit: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' },
  pendingEditText: { fontSize: 11, fontWeight: '700', color: '#2563EB' },
  pendingActionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingBadge: { fontSize: 11, fontWeight: '700', color: '#B45309', letterSpacing: 0.5 },
  pendingBadgeAlert: { color: '#B91C1C' },
  fab: { position: 'absolute', bottom: 20, right: 20, backgroundColor: '#007AFF', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  fabText: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  footerSpinner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  footerSpinnerText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  endOfFeed: { textAlign: 'center', color: '#94a3b8', fontSize: 13, fontWeight: '600', paddingVertical: 18 },
  commentList: { maxHeight: 300, marginBottom: 12 },
  commentRow: { paddingVertical: 8, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  commentUsername: { fontWeight: '700', color: '#0284c7', fontSize: 13, marginBottom: 2 },
  commentText: { color: '#0f172a', fontSize: 14, lineHeight: 19 },
  commentTime: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  commentPending: { opacity: 0.55 },
  commentLoading: { alignItems: 'center', paddingVertical: 20 },
  commentEmpty: { color: '#64748b', fontSize: 14, paddingVertical: 12, textAlign: 'center' },
  submitBtnDisabled: { backgroundColor: '#94a3b8' },
});
