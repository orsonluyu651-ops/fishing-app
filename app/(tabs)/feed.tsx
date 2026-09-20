import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, Modal } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

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
  const [catches, setCatches] = useState<CatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentModalVisible, setCommentModalVisible] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [species, setSpecies] = useState('');
  const [length, setLength] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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

  useEffect(() => {
    initializeFeed();
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

  const submitComment = async () => {
    if (!selectedPostId || !newComment.trim() || !currentUserId) return;
    
    const postId = selectedPostId;
    const commentText = newComment.trim();
    
    setNewComment('');
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
                onPress={() => { setSelectedPostId(item.id); setCommentModalVisible(true); }} 
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
              <TouchableOpacity onPress={() => setCommentModalVisible(false)} style={styles.cancelBtn}>
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
        <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}><Text style={styles.fabText}>+</Text></TouchableOpacity>
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
          <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F2F2F7', padding: 14, borderRadius: 12, borderStyle: 'dashed', borderWidth: 1, borderColor: '#C7C7CC' }} onPress={() => console.log('Photo selector placeholder tapped')}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#007AFF' }}>📸 Add Photo</Text>
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
         setLocation({ latitude: currentLoc.coords.latitude, longitude: currentLoc.coords.longitude });
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
      </View>

      {/* Action Buttons */}
      <View style={{ gap: 10 }}>
        <TouchableOpacity style={{ backgroundColor: '#007AFF', padding: 16, borderRadius: 14, alignItems: 'center', shadowColor: '#007AFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3 }} onPress={() => { console.log('Catch Logged:', { species, length, location }); setSpecies(''); setLength(''); setLocation(null); setModalVisible(false); }}>
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>Submit Catch</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={{ padding: 16, borderRadius: 14, alignItems: 'center' }} onPress={() => setModalVisible(false)}>
          <Text style={{ color: '#8E8E93', fontSize: 16, fontWeight: '500' }}>Cancel</Text>
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
