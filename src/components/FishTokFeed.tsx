import React, { useState, useRef } from 'react';
import { StyleSheet, View, Text, Dimensions, FlatList, ViewToken } from 'react-native';

interface VideoItem {
  id: string;
  title: string;
  waterCondition: string;
  url: string;
}

const { width, height } = Dimensions.get('window');

export const FishTokFeed: React.FC = () => {
  const [viewableId, setViewableId] = useState<string | null>('1');

  const mockVideos: VideoItem[] = [
    { id: '1', title: 'Snapper smash on the shallow reefs!', waterCondition: 'Water Temp: 21°C • Tide: Rising', url: 'https://mixkit.co' },
    { id: '2', title: 'Topwater Kingfish explosion!', waterCondition: 'Water Temp: 19°C • Swell: 1.2m', url: 'https://mixkit.co' }
  ];

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].isViewable) {
      setViewableId(viewableItems[0].item.id);
    }
  });

  return (
    <View style={styles.container}>
      <FlatList
        data={mockVideos}
        keyExtractor={(item) => item.id}
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        renderItem={({ item }) => (
          <View style={styles.videoCard}>
            <View style={styles.videoPlaceholder}>
              <Text style={styles.playIcon}>{viewableId === item.id ? '▶ Video Active' : '⏸ Paused'}</Text>
            </View>
            <View style={styles.overlay}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>{item.waterCondition}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  videoCard: { width, height, justifyContent: 'center', backgroundColor: '#1e293b' },
  videoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  playIcon: { color: '#0284c7', fontSize: 18, fontWeight: 'bold' },
  overlay: { position: 'absolute', bottom: 100, left: 20, right: 20 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  meta: { color: '#38bdf8', fontSize: 14, fontWeight: '600' }
});
