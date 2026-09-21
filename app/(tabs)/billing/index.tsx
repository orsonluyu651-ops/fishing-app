import { useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { usePremiumStatus } from "@/lib/premiumAccess";
import { useStripePayment, type PaymentSheetResult } from "@/lib/stripePayment";
import { supabase } from "@/lib/supabase";

const PRICING = {
  MONTHLY: { price: 9.99, stripePriceId: process.env.EXPO_PUBLIC_STRIPE_PRICE_MONTHLY },
  YEARLY: { price: 99.99, stripePriceId: process.env.EXPO_PUBLIC_STRIPE_PRICE_YEARLY },
};

export default function BillingScreen() {
  const { isPro, loading: premiumLoading } = usePremiumStatus();
  const { isLoading: stripeLoading, error: stripeError, presentPaymentSheet } = useStripePayment();

  useEffect(() => {
    console.log("Billing screen mounted");
  }, []);

  if (premiumLoading || stripeLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isPro) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.premiumContainer}>
          <Ionicons name="diamond-outline" size={64} color="#007AFF" />
          <Text style={styles.premiumTitle}>You are Premium!</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (stripeError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#FF9500" />
          <Text style={styles.errorTitle}>Payment Setup Error</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const handleSubscribe = async (priceId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { Alert.alert("Error", "You must be signed in."); return; }
    if (!priceId) { Alert.alert("Error", "Payment not configured."); return; }
    try {
      const result: PaymentSheetResult = await presentPaymentSheet(session.user.id, priceId);
      if (result.success) { Alert.alert("Success!", "Welcome!", [{ text: "OK", onPress: () => router.back() }]); }
      else { Alert.alert("Error", result.error || "Payment failed."); }
    } catch (e) { Alert.alert("Error", "Something went wrong."); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back-outline" size={24} color="#007AFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Go Premium</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={styles.content}>
        <Text style={styles.description}>Unlock premium features.</Text>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.planCard} onPress={() => handleSubscribe(PRICING.MONTHLY.stripePriceId || "")}>
          <Text style={styles.planLabel}>Monthly</Text>
          <Text style={styles.planPrice}>$9.99</Text>
          <Text style={styles.planPeriod}>/month</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.planCard, styles.popularPlan]} onPress={() => handleSubscribe(PRICING.YEARLY.stripePriceId || "")}>
          <View style={styles.popularBadge}><Text style={styles.popularBadgeText}>Popular</Text></View>
          <Text style={[styles.planLabel, styles.popularLabel]}>Yearly</Text>
          <Text style={[styles.planPrice, styles.popularPrice]}>$99.99</Text>
          <Text style={styles.planPeriod}>/year</Text>
        </TouchableOpacity>
        <Text style={styles.terms}>By subscribing, you agree to our Terms.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 16, fontSize: 16, color: "#666" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12 },
  title: { fontSize: 24, fontWeight: "600", color: "#1a1a1a" },
  content: { paddingHorizontal: 20, paddingTop: 16 },
  description: { fontSize: 16, color: "#666", marginBottom: 16 },
  divider: { height: 1, backgroundColor: "#e5e5e5", marginVertical: 20 },
  planCard: { backgroundColor: "#f8f9fa", borderRadius: 12, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: "#e5e5e5" },
  popularPlan: { backgroundColor: "#007AFF", borderColor: "#007AFF" },
  popularBadge: { position: "absolute", top: -8, right: 20, backgroundColor: "#FF9500", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  popularBadgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  planLabel: { fontSize: 18, fontWeight: "600", color: "#1a1a1a", marginBottom: 8 },
  popularLabel: { color: "#fff" },
  planPrice: { fontSize: 28, fontWeight: "700", color: "#1a1a1a" },
  popularPrice: { color: "#fff" },
  planPeriod: { fontSize: 16, color: "#666" },
  premiumContainer: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  premiumTitle: { fontSize: 24, fontWeight: "700", color: "#007AFF", marginTop: 16 },
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  errorTitle: { fontSize: 20, fontWeight: "600", color: "#FF9500", marginTop: 16 },
  retryButton: { backgroundColor: "#007AFF", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginTop: 16 },
  retryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  terms: { fontSize: 12, color: "#999", textAlign: "center", marginTop: 24 },
});
