/**
 * PremiumPaywall — Conversion-focused membership upgrade sheet.
 *
 * Rendered in-place by gated screens (Ask Fishlore, map tile cache) when the
 * signed-in user's profile has is_pro = false.  Binds the primary CTA to the
 * verified Stripe Payment-Sheet flow exposed by useStripePayment, surfaces
 * in-CTA loading spinners during intent initialization, and catches every
 * rejection path without crashing the host screen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Platform } from 'react-native';
import { useStripePayment } from '@/lib/stripePayment';

interface PremiumPaywallProps {
  /** Called when the Stripe flow reports a successful payment. */
  onUpgradeSuccess?: () => void;
  /** Optional close handler (shown as an X button). */
  onClose?: () => void;
}

const FEATURES: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; description: string }[] = [
  {
    icon: 'cloud-download-outline',
    title: 'Unlock Unlimited Offline Mapping',
    description: 'Cache entire regions — no more 3-tile limit for free users.',
  },
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'Ask Fishlore AI Fishing Guide',
    description: 'Real-time, regulation-grounded fishing advice via the AI assistant.',
  },
  {
        icon: 'sunny-outline',
    title: 'Real-Time Barometric Swings Alerts',
    description: 'Notifications when pressure changes affect bite activity.',
  },
];

export function PremiumPaywall({ onUpgradeSuccess, onClose }: PremiumPaywallProps) {
    const { isLoading: stripeLoading, error: stripeError, presentPaymentSheet } = useStripePayment();
  const [userId, setUserId] = useState<string | null>(null);
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('yearly');

  const isProcessing = stripeLoading;

  const monthlyPriceId = process.env.EXPO_PUBLIC_STRIPE_PRICE_MONTHLY;
  const yearlyPriceId = process.env.EXPO_PUBLIC_STRIPE_PRICE_YEARLY;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
  }, []);

  const handleUpgrade = useCallback(async () => {
    if (!userId) {
      Alert.alert('Error', 'You must be signed in to upgrade.');
      return;
    }
    const priceId = plan === 'monthly' ? monthlyPriceId : yearlyPriceId;
    if (!priceId) {
      Alert.alert('Error', 'Pricing is not configured for this plan.');
      return;
    }
    try {
      const result = await presentPaymentSheet(userId, priceId);
      if (result.success) {
        onUpgradeSuccess?.();
      } else {
        Alert.alert('Payment Failed', result.error || 'Unable to complete your upgrade. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
  }, [userId, plan, monthlyPriceId, yearlyPriceId, presentPaymentSheet, onUpgradeSuccess]);


  return (
    <View style={styles.card}>
      {Platform.OS === 'web' ? (
        <View style={styles.header}>
          <Text style={styles.title}>Pro Membership</Text>
          <Text style={styles.subtitle}>Payments unavailable on web</Text>
        </View>
      ) : null}
      {onClose ? (
        <TouchableOpacity style={styles.closeButton} onPress={onClose} disabled={isProcessing}>
          <Ionicons name="close" size={24} color="#6b7280" />
        </TouchableOpacity>
      ) : null}

      <View style={styles.header}>
        <Ionicons name="diamond" size={56} color="#007AFF" />
        <Text style={styles.title}>Go Premium</Text>
        <Text style={styles.subtitle}>Unlock all fishing features</Text>
      </View>

      <View style={styles.features}>
        {FEATURES.map((feature) => (
          <View key={feature.title} style={styles.featureRow}>
            <Ionicons name={feature.icon} size={24} color="#007AFF" />
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureDesc}>{feature.description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.planSelector}>
        <TouchableOpacity
          style={[styles.planOption, plan === 'monthly' && styles.planSelected]}
          onPress={() => !isProcessing && setPlan('monthly')}
          disabled={isProcessing}
        >
          <Text style={[styles.planLabel, plan === 'monthly' && styles.planLabelSelected]}>Monthly</Text>
          <Text style={[styles.planPrice, plan === 'monthly' && styles.planPriceSelected]}>$9.99</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.planOption, styles.popularPlan, plan === 'yearly' && styles.planSelected]}
          onPress={() => !isProcessing && setPlan('yearly')}
          disabled={isProcessing}
        >
          <Text style={[styles.planLabel, plan === 'yearly' && styles.planLabelSelected]}>Yearly</Text>
          <Text style={[styles.planPrice, plan === 'yearly' && styles.planPriceSelected]}>$99.99</Text>
          <View style={styles.popularBadge}>
            <Text style={styles.popularText}>Popular</Text>
          </View>
        </TouchableOpacity>
      </View>

      {stripeError ? <Text style={styles.errorText}>{stripeError}</Text> : null}

      <TouchableOpacity
        style={[styles.upgradeButton, isProcessing && styles.upgradeButtonDisabled]}
        onPress={handleUpgrade}
        disabled={isProcessing}
      >
        {isProcessing ? (
          <View style={styles.buttonContent}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.upgradeButtonText}>Processing…</Text>
          </View>
        ) : (
          <Text style={styles.upgradeButtonText}>Upgrade to Pro</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.terms}>By subscribing, you agree to our Terms.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    margin: 24,
    padding: 24,
    maxHeight: '80%',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  header: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  features: {
    marginBottom: 20,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  featureDesc: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  planSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  planOption: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  planSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#f0f7ff',
  },
  popularPlan: {
    borderColor: '#007AFF',
    backgroundColor: '#f0f7ff',
    position: 'relative',
  },
  popularBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FF9500',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  popularText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  planLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  planLabelSelected: {
    color: '#111',
  },
  planPrice: {
    fontSize: 20,
    fontWeight: '700',
    color: '#6b7280',
  },
  planPriceSelected: {
    color: '#007AFF',
  },
  upgradeButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  upgradeButtonDisabled: {
    backgroundColor: '#c7d7f5',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  upgradeButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  terms: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
});