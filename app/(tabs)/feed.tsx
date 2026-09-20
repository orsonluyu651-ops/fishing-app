import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Modal, Image, Alert, LayoutAnimation } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import {
  enqueueCatch,
  isNetworkError,
  loadQueue,
  syncQueue,
} from '../../src/lib/offlineCatchQueue';
import { askAssistant, type AssistantAnswer } from '../../src/lib/assistant';

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

export default function FeedScreen() {
  const animateLayout = () =>
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

  const [catches, setCatches] = useState<CatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentModalVisible, setCommentModalVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [species, setSpecies] = useState('');
  const [length, setLength] = useState('');
  const [location, setLocation] = useState<any>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [submittingCatch, setSubmittingCatch] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantQuery, setAssistantQuery] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState<AssistantAnswer | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);

  const initializeFeed = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);

      const { data, error } = await supabase.from('feed_posts').select('*');

      if (!error && data) {
        const formattedCatches = data.map((item: any) => ({
          id: item.id || Math.random().toString(),
          title: item.caption || item.title || 'Fishing Catch',
          species: item.species || 'Unknown Species',
          location_name: item.location_name || 'Gold Coast Waters',
          user_id: item.user_id,
          profiles: { username: item.username || 'Anonymous Angler' },
          likes_count: item.likes_count ?? 0,
          comments_count: item.comments_count ?? 0,
          has_liked: item.is_liked_by_me ?? false,
        }));
        setCatches(formattedCatches);
      } else if (error) {
        console.error("Supabase view error:", error.message);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const refreshPendingCount = async () => {
    const queue = await loadQueue();
    setPendingCount(queue.length);
  };

  const runQueueSync = async (silent: boolean = false) => {
    const queue = await loadQueue();
    if (queue.length === 0) {
      setPendingCount(0);
      return;
    }
    setSyncingQueue(true);
    try {
      const { synced, failed } = await syncQueue();
      const remaining = await loadQueue();
      setPendingCount(remaining.length);
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

  useEffect(() => {
    initializeFeed();
    refreshPendingCount();
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        runQueueSync(true);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLike = async (postId: string, hasLiked: boolean) => {
    if (!currentUserId) return;
    
    setCatches(prev => prev.map(item => {
      if (item.id === postId) {
        return {
          ...item,
          has_liked: !hasLiked,
          likes_count: hasLiked ? item.likes_count - 1 : item.likes_count + 1
        };
      }
      return item;
    }));

    if (hasLiked) {
      await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUserId);
    } else {
      await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUserId });
    }
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
        animateLayout();
        setPhotoUri(result.assets[0].uri);
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
      const { data: inserted, error: insertError } = await supabase
        .from('catches')
        .insert({
          user_id: currentUserId,
          species: trimmedSpecies,
          length: parsedLength,
          media_path: mediaPath,
          environmental,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      // 3) Refresh the feed (the create_feed_post_on_catch trigger auto-creates the post).
      console.log('Catch Logged:', {
        catchId: inserted?.id,
        species: trimmedSpecies,
        length: parsedLength,
        location,
        mediaPath,
      });
      resetCatchForm();
      await initializeFeed();
      await refreshPendingCount();
    } catch (error: any) {
      console.error('Error submitting catch:', error);
      if (isNetworkError(error)) {
        try {
          await enqueueCatch({
            userId: currentUserId,
            species: trimmedSpecies,
            length: parsedLength,
            latitude: location?.latitude ?? null,
            longitude: location?.longitude ?? null,
            photoUri,
          });
          await refreshPendingCount();
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

  const submitComment = async () => {
    if (!selectedPostId || !newComment.trim() || !currentUserId) return;
    
    const postId = selectedPostId;
    const commentText = newComment.trim();
    
    setNewComment('');
    animateLayout();
    setCommentModalVisible(false);

    setCatches(prev => prev.map(item => 
      item.id === postId ? { ...item, comments_count: item.comments_count + 1 } : item
    ));

    await supabase.from('post_comments').insert({
      post_id: postId,
      user_id: currentUserId,
      text: commentText
    });
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {pendingCount > 0 && (
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFF8E1', borderColor: '#FFB300', borderWidth: 1, marginHorizontal: 12, marginBottom: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }}
          onPress={() => runQueueSync(false)}
          disabled={syncingQueue}
        >
          <Ionicons name="cloud-offline-outline" size={18} color="#E65100" />
          <Text style={{ color: '#E65100', fontSize: 13, fontWeight: '700' }}>
            {syncingQueue
              ? 'Syncing offline catches...'
              : `${pendingCount} catch${pendingCount === 1 ? '' : 'es'} waiting to sync — tap to retry`}
          </Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={catches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.username}>@{item.profiles.username}</Text>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.details}>🐟 {item.species} | 📍 {item.location_name}</Text>
            
            <View style={styles.socialBar}>
              <TouchableOpacity onPress={() => handleLike(item.id, item.has_liked)} style={styles.socialButton}>
                <Ionicons 
                  name={item.has_liked ? "heart" : "heart-outline"} 
                  size={22} 
                  color={item.has_liked ? "#ef4444" : "#64748b"} 
                />
                <Text style={styles.socialText}>{item.likes_count}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={() => { animateLayout(); setSelectedPostId(item.id); setCommentModalVisible(true); }} 
                style={styles.socialButton}
              >
                <Ionicons name="chatbubble-outline" size={20} color="#64748b" />
                <Text style={styles.socialText}>{item.comments_count}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <Modal visible={commentModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Leave a Comment</Text>
            <TextInput
              style={styles.input}
              placeholder="Type your fishing comment..."
              value={newComment}
              onChangeText={setNewComment}
              multiline
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => { animateLayout(); setCommentModalVisible(false); }} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitComment} style={styles.submitBtn}>
                <Text style={styles.submitText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    {/* FAB */}
        <TouchableOpacity style={[styles.fab, { bottom: 88 }]} onPress={() => { animateLayout(); setModalVisible(true); }}><Text style={styles.fabText}>+</Text></TouchableOpacity>
      {/* Ask Tidewire — curated fishing guide */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: '#0284c7' }]}
        onPress={openAssistant}
        accessibilityLabel="Ask Tidewire guide"
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
      {/* Ask Tidewire guide modal */}
      <Modal visible={assistantVisible} animationType="slide" transparent={true} onRequestClose={closeAssistant}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ask Tidewire</Text>
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
  fab: { position: 'absolute', bottom: 20, right: 20, backgroundColor: '#007AFF', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  fabText: { color: '#fff', fontSize: 28, fontWeight: 'bold' }
});
