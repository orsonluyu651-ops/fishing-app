import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen() {
  // Form State
  const [species, setSpecies] = useState('');
  const [length, setLength] = useState('');
  const [location, setLocation] = useState('');
  
  // Simulated Catch History State
  const [catches, setCatches] = useState([
    { id: '1', species: 'Dusky Flathead', length: '55', location: 'Southport Seaway' },
    { id: '2', species: 'Yellowfin Whiting', length: '28', location: 'Broadwater Banks' },
  ]);

  const handleLogCatch = () => {
    if (!species || !length || !location) {
      alert('Please fill out all fields to log your catch!');
      return;
    }

    const newCatch = {
      id: Date.now().toString(),
      species: species,
      length: length,
      location: location
    };

    setCatches([newCatch, ...catches]);
    
    // Clear Form Fields after success
    setSpecies('');
    setLength('');
    setLocation('');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* 🎣 Header Title */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Angler Logbook</Text>
        <Ionicons name="fish" size={28} color="#0284c7" />
      </View>

      {/* 📝 Interactive Catch Logger Form */}
      <View style={styles.formCard}>
        <Text style={styles.formTitle}>Record a New Catch</Text>
        
        <Text style={styles.inputLabel}>Fish Species</Text>
        <TextInput 
          style={styles.input} 
          placeholder="e.g., Dusky Flathead, Whiting" 
          value={species}
          onChangeText={setSpecies}
        />

        <Text style={styles.inputLabel}>Length (cm)</Text>
        <TextInput 
          style={styles.input} 
          placeholder="e.g., 45" 
          keyboardType="numeric"
          value={length}
          onChangeText={setLength}
        />

        <Text style={styles.inputLabel}>Fishing Spot / Location</Text>
        <TextInput 
          style={styles.input} 
          placeholder="e.g., Southport Seaway" 
          value={location}
          onChangeText={setLocation}
        />

        <TouchableOpacity style={styles.submitBtn} onPress={handleLogCatch}>
          <Ionicons name="add-circle-outline" size={20} color="#fff" />
          <Text style={styles.submitBtnText}>Log Catch to Dashboard</Text>
        </TouchableOpacity>
      </View>

      {/* 📊 Recent Catch History Feed */}
      <Text style={styles.sectionTitle}>Recent Catches ({catches.length})</Text>
      {catches.map((item) => (
        <View key={item.id} style={styles.catchCard}>
          <View style={styles.catchIconContainer}>
            <Ionicons name="ribbon" size={24} color="#0284c7" />
          </View>
          <View style={styles.catchDetails}>
            <Text style={styles.catchSpecies}>{item.species}</Text>
            <Text style={styles.catchMeta}>📏 {item.length} cm  •  📍 {item.location}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 24 },
  formTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginBottom: 14 },
  inputLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, fontSize: 14, color: '#0f172a', marginBottom: 14 },
  submitBtn: { backgroundColor: '#0284c7', borderRadius: 8, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginLeft: 6 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginBottom: 12 },
  catchCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10 },
  catchIconContainer: { width: 40, height: 40, backgroundColor: '#e0f2fe', borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  catchDetails: { flex: 1 },
  catchSpecies: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  catchMeta: { fontSize: 13, color: '#64748b', marginTop: 2 }
});
