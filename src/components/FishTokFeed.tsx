import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  FlatList,
  ViewToken,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface VideoItem {
  id: string;
  title: string;
  waterCondition: string;
  url: string;
  likes: number;
  isLiked: boolean;
  comments: string[];
}

interface CommentSheetProps {
  visible: boolean;
  video: VideoItem | null;
  onClose: () => void;
  onAddComment: (text: string) => void;
}

const { width, height } = Dimensions.get('window');

const CommentSheet: React.FC<CommentSheetProps> = ({ visible, video, onClose, onAddComment }) => {
  const [draft, setDraft] = useState('');
  if (!visible || !video) return null;
  const handleSend = () => {
    const t = draft.trim();
    if (t.length > 0) { onAddComment(t); setDraft(''); }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.commentBackdrop} onPress={onClose} activeOpacity={1}>
        <View style={styles.commentSheet}>
          <View style={styles.commentHeader}>
            <Text style={styles.commentTitle}>Comments on "{video.title}"</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close comments">
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={video.comments}
            keyExtractor={(_, i) => `cmt-${i}`}
            renderItem={({ item }) => <Text style={styles.commentRow}>• {item}</Text>}
            contentContainerStyle={styles.commentList}
          />
          <View style={styles.commentComposer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Drop a line…"
              style={styles.commentInput}
              onSubmitEditing={handleSend}
            />
            <TouchableOpacity onPress={handleSend} accessibilityLabel="Send comment">
              <Ionicons name="send" size={20} color="#0284c7" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

export const FishTokFeed: React.FC = () => {
  const [viewableId, setViewableId] = useState<string | null>('1');
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');

  const [videos, setVideos] = useState<VideoItem[]>([
    {
      id: '1',
      title: 'Snapper smash on the shallow reefs!',
      waterCondition: 'Water Temp: 21°C • Tide: Rising',
      url: 'https://mixkit.co',
      likes: 402,
      isLiked: false,
      comments: ['What a catch at the Seaway!', 'What rig were you using?'],
    },
    {
      id: '2',
      title: 'Topwater Kingfish explosion!',
      waterCondition: 'Water Temp: 19°C • Swell: 1.2m',
      url: 'https://mixkit.co',
      likes: 819,
      isLiked: true,
      comments: ['Kingfish of a lifetime — legend!'],
    },
  ]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].isViewable) {
      setViewableId(viewableItems[0].item.id);
    }
  });

  /* Toggle like state + dynamically bump the count on screen. */
  const toggleLike = (id: string) => {
    setVideos((prev) =>
      prev.map((v) =>
        v.id === id ? { ...v, isLiked: !v.isLiked, likes: v.isLiked ? v.likes - 1 : v.likes + 1 } : v
      )
    );
  };

  const addComment = (id: string, text: string) => {
    setVideos((prev) =>
      prev.map((v) => (v.id === id ? { ...v, comments: [...v.comments, text] } : v))
    );
  };

  const handleUpload = () => {
    const t = uploadTitle.trim();
    if (t.length === 0) {
      Alert.alert('Missing title', 'Give your video a title so your mates know the story.');
      return;
    }
    const newCard: VideoItem = {
      id: `vid-${Date.now()}`,
      title: t,
      waterCondition: 'Water Temp: ?? • Tide: ??',
      url: 'https://mixkit.co',
      likes: 0,
      isLiked: false,
      comments: [],
    };
    setVideos((prev) => [newCard, ...prev]);
    setUploadTitle('');
    setUploadVisible(false);
  };

  return (
        <View style={styles.container}>
      {/* Top-header upload trigger */}
      <TouchableOpacity
        style={styles.uploadFab}
        onPress={() => setUploadVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Post a new catch video"
        accessibilityHint="Opens the video upload form"
      >
        <Ionicons name="cloud-upload" size={24} color="#ffffff" />
      </TouchableOpacity>

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        renderItem={({ item }) => (
          <View style={styles.videoCard}>
            {/* Deep-sea gradient stack: abyssal navy → marine blue → teal */}
            <View style={styles.gradientFill} pointerEvents="none">
              <View style={[styles.gradientBand, styles.bandAbyss]} />
              <View style={[styles.gradientBand, styles.bandDeep]} />
              <View style={[styles.gradientBand, styles.bandMid]} />
              <View style={[styles.gradientBand, styles.bandMarine]} />
              <View style={[styles.gradientBand, styles.bandCyan]} />
              <View style={[styles.gradientBand, styles.bandTeal]} />
            </View>
            <View style={styles.accentGlowTop} pointerEvents="none" />
            <View style={styles.accentGlowBottom} pointerEvents="none" />

            {/* Right-hand vertical floating toolbar */}
            <View style={styles.rightToolbar}>
              <TouchableOpacity
                style={styles.toolCell}
                onPress={() => toggleLike(item.id)}
                accessibilityRole="button"
                accessibilityLabel={item.isLiked ? 'Unlike catch' : 'Like catch'}
                accessibilityHint="Toggles your like on this catch"
              >
                <Ionicons
                  name={item.isLiked ? 'heart' : 'heart-outline'}
                  size={28}
                  color="#ef4444"
                />
                <Text style={styles.toolCount}>{item.likes}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.toolCell}
                onPress={() => setCommentTarget(item.id)}
                accessibilityRole="button"
                accessibilityLabel="Open comments"
                accessibilityHint="Opens the comment sheet for this catch"
              >
                <Ionicons name="chatbubble-ellipses-outline" size={26} color="#ffffff" />
              </TouchableOpacity>
            </View>

            <View style={styles.videoPlaceholder}>
              {viewableId === item.id ? (
                <View style={styles.mockVideoFrame}>
                  <View style={styles.mockVideoOverlay}>
                    <Ionicons name="play-circle" size={64} color="#ffffff" style={{ opacity: 0.45 }} />
                  </View>
                  <View style={styles.mockWaveform}>
                    {[...Array(12)].map((_, i) => {
                      const h = 4 + (Math.sin(i * 0.8) * 10 + 10) + (viewableId === item.id ? 4 : 0);
                      return <View key={i} style={[styles.mockWaveBar, { height: Math.max(4, h) }]} />;
                    })}
                  </View>
                </View>
              ) : (
                <Text style={styles.playIcon}>⏸ Paused</Text>
              )}
            </View>

            <View style={styles.overlay}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>{item.waterCondition}</Text>
            </View>
          </View>
        )}
      />

      {/* Conditional comment modal sheet */}
      {commentTarget && (
        <CommentSheet
          visible={commentTarget !== null}
          video={videos.find((v) => v.id === commentTarget) ?? null}
          onClose={() => setCommentTarget(null)}
          onAddComment={(text) => {
            if (commentTarget) addComment(commentTarget, text);
          }}
        />
      )}

      {/* Upload form overlay */}
      <Modal
        visible={uploadVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setUploadVisible(false)}
      >
        <TouchableOpacity
          style={styles.commentBackdrop}
          onPress={() => setUploadVisible(false)}
          activeOpacity={1}
        />
        <View style={styles.uploadSheet}>
          <Text style={styles.uploadTitle}>Post a new catch video</Text>
          <TextInput
            placeholder="Video title"
            value={uploadTitle}
            onChangeText={setUploadTitle}
            style={styles.uploadInput}
            placeholderTextColor="#94a3b8"
            onSubmitEditing={handleUpload}
          />
          <View style={styles.uploadActions}>
            <TouchableOpacity
              onPress={() => setUploadVisible(false)}
              style={styles.uploadCancel}
              accessibilityLabel="Cancel upload"
            >
              <Text style={styles.uploadCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleUpload}
              style={styles.uploadPostBtn}
              accessibilityLabel="Post video"
            >
              <Text style={styles.uploadPostText}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  videoCard: { width, height, justifyContent: 'center', backgroundColor: '#04182f', overflow: 'hidden' },
  gradientFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end' },
  gradientBand: { flex: 1 },
  bandAbyss: { backgroundColor: '#04182f' },
  bandDeep: { backgroundColor: '#063357' },
  bandMid: { backgroundColor: '#075985' },
  bandMarine: { backgroundColor: '#0284c7' },
  bandCyan: { backgroundColor: '#0891b2' },
  bandTeal: { backgroundColor: '#0d9488' },
  accentGlowTop: { position: 'absolute', top: -70, right: -50, width: 210, height: 210, borderRadius: 105, backgroundColor: 'rgba(45, 212, 191, 0.16)' },
  accentGlowBottom: { position: 'absolute', bottom: -80, left: -60, width: 250, height: 250, borderRadius: 125, backgroundColor: 'rgba(2, 132, 199, 0.20)' },
  videoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  playIcon: { color: '#0284c7', fontSize: 18, fontWeight: 'bold' },
  overlay: { position: 'absolute', bottom: 100, left: 20, right: 20 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  meta: { color: '#38bdf8', fontSize: 14, fontWeight: '600' },
  rightToolbar: {
    position: 'absolute',
    right: 12,
    top: 12,
    flexDirection: 'column',
    alignItems: 'center',
  },
  toolbarButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    marginBottom: 12,
  },
  toolbarLabel: { color: '#ffffff', fontSize: 11, fontWeight: '600', marginTop: 2 },
  likedLabel: { color: '#ef4444' },
  commentBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  commentSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingTop: 12,
  },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  commentTitle: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  commentList: { flexGrow: 1, paddingBottom: 8 },
  commentRow: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, marginBottom: 6 },
  commentComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 10 },
  commentInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
  },
  uploadBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  uploadSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    gap: 14,
  },
  uploadTitle: { color: '#ffffff', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  uploadInput: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  uploadActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 },
  uploadCancel: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1e293b' },
  uploadCancelText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
    uploadPostBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: '#0284c7' },
  uploadPostText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
    uploadFab: {
    position: 'absolute',
    top: 20,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    zIndex: 999,
        backgroundColor: 'rgba(2, 132, 199, 0.95)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  uploadFabText: { color: '#ffffff', fontSize: 22, fontWeight: '300', lineHeight: 22 },
  mockVideoFrame: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    marginHorizontal: 20,
  },
  mockVideoOverlay: {
    position: 'absolute',
    top: '25%',
    left: '25%',
    width: '50%',
    height: '50%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockPlayIcon: {
    fontSize: 56,
    color: '#ffffff',
    opacity: 0.35,
    lineHeight: 56,
  },
  mockWaveform: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginTop: 16,
  },
  mockWaveBar: { width: 3, backgroundColor: '#0284c7', borderRadius: 1.5 },
  toolCell: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    marginBottom: 12,
  },
  toolCount: { color: '#ffffff', fontSize: 13, fontWeight: '600', marginTop: 2 },
});
