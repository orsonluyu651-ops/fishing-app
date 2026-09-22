import React, { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { fetchMessageHistory, sendDirectMessage, subscribeToMessages, DirectMessage } from '../../src/lib/messageEngine';

export default function ChatRoomScreen() {
  const { chatUserId } = useLocalSearchParams<{ chatUserId: string }>();
  const currentUserId = useRef<string | null>(null);
  const [currentUserIdState, setCurrentUserIdState] = useState<string | null>(null);

  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        currentUserId.current = user.id;
        setCurrentUserIdState(user.id);
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    if (!currentUserIdState || !chatUserId) return;

    const loadHistory = async () => {
      const history = await fetchMessageHistory(currentUserIdState, chatUserId);
      setMessages(history);
      setLoading(false);
    };

    loadHistory();

    const channel = subscribeToMessages(currentUserIdState, chatUserId, (newMsg) => {
      setMessages((prev) => [newMsg, ...prev]);
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatUserId, currentUserIdState]);

  const handleSend = async () => {
    if (!inputText.trim() || !currentUserId.current || !chatUserId) return;
    const textToSend = inputText.trim();
    setInputText('');

    // Optimistic UI updates
    const optimisticMsg: DirectMessage = {
      id: Math.random().toString(),
      sender_id: currentUserId.current,
      receiver_id: chatUserId,
      text_content: textToSend,
      created_at: new Date().toISOString()
    };
    setMessages((prev) => [optimisticMsg, ...prev]);

    const { error } = await sendDirectMessage(currentUserId.current, chatUserId, textToSend);
    if (error) console.error('Message send failure:', error);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      <FlatList
        data={messages}
        inverted
        keyExtractor={(item) => item.id}
        initialNumToRender={15}
        renderItem={({ item }) => (
          <View style={{ alignSelf: item.sender_id === currentUserIdState ? 'flex-end' : 'flex-start', backgroundColor: item.sender_id === currentUserIdState ? '#007AFF' : '#E5E5EA', padding: 12, borderRadius: 16, marginHorizontal: 12, marginVertical: 4, maxWidth: '75%' }}>
            <Text style={{ color: item.sender_id === currentUserIdState ? '#fff' : '#000', fontSize: 16 }}>{item.text_content}</Text>
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', padding: 8, backgroundColor: '#fff', alignItems: 'center' }}>
        <TextInput value={inputText} onChangeText={setInputText} placeholder="Type a message..." maxLength={1000} style={{ flex: 1, backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, fontSize: 16, maxHeight: 100 }} multiline />
        <TouchableOpacity onPress={handleSend} style={{ marginLeft: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ color: '#007AFF', fontWeight: 'bold', fontSize: 16 }}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}