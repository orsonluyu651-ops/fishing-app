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
            {/* Deep-sea gradient stack: hard-stop color bands, abyssal navy → marine blue → teal. */}
            <View style={styles.gradientFill} pointerEvents="none">
              <View style={[styles.gradientBand, styles.bandAbyss]} />
              <View style={[styles.gradientBand, styles.bandDeep]} />
              <View style={[styles.gradientBand, styles.bandMid]} />
              <View style={[styles.gradientBand, styles.bandMarine]} />
              <View style={[styles.gradientBand, styles.bandCyan]} />
              <View style={[styles.gradientBand, styles.bandTeal]} />
            </View>
            {/* High-contrast glow accents layered over the gradient horizon. */}
            <View style={styles.accentGlowTop} pointerEvents="none" />
            <View style={styles.accentGlowBottom} pointerEvents="none" />
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
  meta: { color: '#38bdf8', fontSize: 14, fontWeight: '600' }
});
