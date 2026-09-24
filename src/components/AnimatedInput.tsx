import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Animated,
  Easing,
  StyleSheet,
  TextInputProps,
} from 'react-native';

export const COLORS = {
  bg: '#0f172a',
  card: '#1e293b',
  border: '#334155',
  text: '#f1f5f9',
  muted: '#94a3b8',
  accent: '#38bdf8',
  peak: '#10b981',
  good: '#38bdf8',
  avg: '#fbbf24',
  poor: '#ef4444',
  brandSecondary: '#273449',
  textMutedDark: '#64748b',
  textMutedLight: '#cbd5e1',
} as const;

interface AnimatedInputProps extends TextInputProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

/**
 * AnimatedInput — shared, memoized floating-label input component.
 * Uses native-driven animations for 60fps border color transitions.
 * Wrapped in React.memo to prevent unnecessary re-renders on rapid keystrokes.
 */
export const AnimatedInput = React.memo(
  ({ label, value, onChangeText, placeholder, ...rest }: AnimatedInputProps) => {
    const focusAnim = useRef(new Animated.Value(0)).current;

    const handleFocus = useCallback(() => {
      Animated.timing(focusAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }).start();
    }, [focusAnim]);

    const handleBlur = useCallback(() => {
      if (!value) {
        Animated.timing(focusAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }).start();
      }
    }, [focusAnim, value]);

    const borderColor = focusAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [COLORS.border, COLORS.accent],
    });

    const labelTranslateY = focusAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -18],
    });

    const labelScale = focusAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.8],
    });

    const labelOpacity = focusAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    return (
      <View style={styles.inputWrapper}>
        <Animated.Text
          style={[
            styles.floatingLabel,
            {
              opacity: labelOpacity,
              transform: [{ translateY: labelTranslateY }, { scale: labelScale }],
            },
          ]}
          pointerEvents="none"
        >
          {label}
        </Animated.Text>
        <Animated.View style={[styles.inputContainer, { borderColor }]}>
          <TextInput
            style={styles.input}
            placeholder={placeholder || label}
            placeholderTextColor={COLORS.muted}
            value={value}
            onChangeText={onChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            {...rest}
          />
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  inputWrapper: {
    marginBottom: 16,
  },
  floatingLabel: {
    position: 'absolute',
    top: 14,
    left: 14,
    fontSize: 12,
    color: COLORS.accent,
    fontWeight: '600',
    pointerEvents: 'none',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: COLORS.card,
    height: 54,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    paddingVertical: 0,
  },
});