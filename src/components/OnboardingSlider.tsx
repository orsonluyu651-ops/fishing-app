import React, { useState, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, Dimensions, TouchableOpacity } from 'react-native';

interface OnboardingSliderProps {
  onComplete: () => void;
}

const { width, height } = Dimensions.get('window');

export const OnboardingSlider: React.FC<OnboardingSliderProps> = ({ onComplete }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  const slides = [
    { title: 'Welcome to Fishlore', desc: 'The ultimate utility hub for tracking catches and mapping local secret waypoints.' },
    { title: 'Offline Vector Mapping', desc: 'No signal? No worries. High-resolution coastal terrains are cached directly to your hardware.' },
    { title: 'Viral Catch Sharing', desc: 'Instantly text clean, brand-overlay logging profiles straight to your fishing mates.' }
  ];

  const handleScroll = (event: any) => {
    const slideIndex = Math.round(event.nativeEvent.contentOffset.x / width);
    setActiveIndex(slideIndex);
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
        <TouchableOpacity style={styles.btn} onPress={onComplete}>
          <Text style={styles.btnText}>{activeIndex === slides.length - 1 ? 'Get Started' : 'Skip'}</Text>
        </TouchableOpacity>
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
  btn: { backgroundColor: '#0284c7', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 25 },
  btnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 }
});
