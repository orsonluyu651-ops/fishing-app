import React, { useState, useRef, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, Dimensions, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

interface OnboardingSliderProps {
  onComplete: () => void;
}

const { width, height } = Dimensions.get('window');

const ONBOARDING_STORAGE_KEY = 'fishlore_onboarding_index';

export const OnboardingSlider: React.FC<OnboardingSliderProps> = ({ onComplete }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasRestored, setHasRestored] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const slides = [
    { title: 'Welcome to Fishlore', desc: 'The ultimate utility hub for tracking catches and mapping local secret waypoints.' },
    { title: 'Offline Vector Mapping', desc: 'No signal? No worries. High-resolution coastal terrains are cached directly to your hardware.' },
    { title: 'Viral Catch Sharing', desc: 'Instantly text clean, brand-overlay logging profiles straight to your fishing mates.' }
  ];

  // Restore persisted onboarding index on mount so users who background the app
  // land back on the exact same slide they left off on.
  useEffect(() => {
    const restoreIndex = async () => {
      try {
        const saved = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (saved !== null) {
          const idx = parseInt(saved, 10);
          if (idx >= 0 && idx < slides.length) {
            setActiveIndex(idx);
            scrollViewRef.current?.scrollTo({ x: idx * width, animated: false });
          }
        }
      } catch (e) {
        // Silently fall back to first slide
      } finally {
        setHasRestored(true);
      }
    };
    restoreIndex();
  }, []);

  // Persist index whenever it changes — only after initial restore completes
  useEffect(() => {
    if (hasRestored) {
      AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, String(activeIndex)).catch(() => {});
    }
  }, [activeIndex, hasRestored]);

  const handleScroll = (event: any) => {
    const slideIndex = Math.round(event.nativeEvent.contentOffset.x / width);
    setActiveIndex(slideIndex);
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      const newIndex = activeIndex - 1;
      setActiveIndex(newIndex);
      scrollViewRef.current?.scrollTo({ x: newIndex * width, animated: true });
    }
  };

  const handleNext = () => {
    if (activeIndex < slides.length - 1) {
      const newIndex = activeIndex + 1;
      setActiveIndex(newIndex);
      scrollViewRef.current?.scrollTo({ x: newIndex * width, animated: true });
    }
  };

  const handleComplete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY).catch(() => {});
    onComplete();
  };

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        scrollEnabled={hasRestored}
      >
        {slides.map((slide, index) => (
          <View key={index} style={styles.slide}>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.description}>{slide.desc}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.pagination}>
          {slides.map((_, i) => (
            <View key={i} style={[styles.dot, activeIndex === i && styles.activeDot]} />
          ))}
        </View>
        <View style={styles.navButtons}>
          {activeIndex > 0 && (
            <TouchableOpacity style={styles.navBtn} onPress={handlePrev}>
              <Text style={styles.navBtnText}>Prev</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.btn} onPress={handleComplete}>
            <Text style={styles.btnText}>{activeIndex === slides.length - 1 ? 'Get Started' : 'Skip'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  slide: { width, height: height * 0.8, justifyContent: 'center', alignItems: 'center', padding: 40 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0284c7', marginBottom: 20, textAlign: 'center' },
  description: { fontSize: 16, color: '#64748b', textAlign: 'center', lineHeight: 24 },
  footer: { height: height * 0.2, justifyContent: 'space-between', alignItems: 'center', paddingBottom: 50 },
  pagination: { flexDirection: 'row', marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#cbd5e1', marginHorizontal: 4 },
  activeDot: { backgroundColor: '#0284c7', width: 20 },
  navButtons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  navBtnText: { color: '#0284c7', fontSize: 15, fontWeight: '600' },
  btn: { backgroundColor: '#0284c7', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 25 },
  btnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
});
