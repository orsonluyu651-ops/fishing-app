import React, { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { fetchGroupMessageHistory, sendGroupMessage, subscribeToGroupMessages, uploadChatImage, GroupMessage } from '../../src/lib/groupEngine';

export default function ClubRoomScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const currentUserId = useRef<string | null>(null);
  const [currentUserIdState, setCurrentUserIdState] = useState<string | null>(null);

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingMedia, setUploadingMedia] = useState(false);

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
    if (!currentUserIdState || !groupId) return;

    const loadHistory = async () => {
      const history = await fetchGroupMessageHistory(groupId);
      setMessages(history);
      setLoading(false);
    };

    loadHistory();

    const channel = subscribeToGroupMessages(groupId, (newMsg) => {
      setMessages((prev) => [newMsg, ...prev]);
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, currentUserIdState]);

  const handleSend = async () => {
    if (!inputText.trim() || !currentUserId.current || !groupId) return;
    const textToSend = inputText.trim();
    setInputText('');

    const optimisticMsg: GroupMessage = {
      id: Math.random().toString(),
      group_id: groupId,
      sender_id: currentUserId.current,
      text_content: textToSend,
      created_at: new Date().toISOString(),
      profiles: { username: 'You' }
    };
    setMessages((prev) => [optimisticMsg, ...prev]);

    const { error } = await sendGroupMessage(groupId, currentUserId.current, textToSend, null);
    if (error) console.error('Group message send failure:', error);
  };

  const handleAttachImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission required', 'Permission to access gallery is required.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (result.canceled || !result.assets[0]?.uri) return;

    setUploadingMedia(true);
    const uploadedUrl = await uploadChatImage(groupId!, result.assets[0].uri);
    setUploadingMedia(false);

    if (uploadedUrl && currentUserId.current) {
      await sendGroupMessage(groupId!, currentUserId.current, '[Shared an image]', uploadedUrl);
    }
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
          <View style={{ alignSelf: item.sender_id === currentUserIdState ? 'flex-end' : 'flex-start', backgroundColor: item.sender_id === currentUserIdState ? '#0284c7' : '#fff', padding: 12, borderRadius: 16, marginHorizontal: 12, marginVertical: 4, maxWidth: '75%', boxShadow: '0px 1px 2px rgba(0,0,0,0.05)' }}>
            {item.sender_id !== currentUserIdState && <Text style={{ color: '#0284c7', fontSize: 12, fontWeight: 'bold', marginBottom: 2 }}>{item.profiles?.username ?? 'Angler'}</Text>}
            {item.image_url && (
              <Image
                source={{ uri: item.image_url }}
                style={{ width: 200, height: 150, borderRadius: 12, marginBottom: 6, backgroundColor: '#e1e1e1' }}
                resizeMode="cover"
              />
            )}
            <Text style={{ color: item.sender_id === currentUserIdState ? '#fff' : '#000', fontSize: 16 }}>{item.text_content}</Text>
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', padding: 8, backgroundColor: '#fff', alignItems: 'center' }}>
        <TouchableOpacity onPress={handleAttachImage} disabled={uploadingMedia} style={{ paddingHorizontal: 12 }}>
          <Text style={{ color: '#0284c7', fontSize: 24, fontWeight: 'bold' }}>+</Text>
        </TouchableOpacity>
        <TextInput value={inputText} onChangeText={uploadingMedia ? undefined : setInputText} placeholder={uploadingMedia ? "Uploading..." : "Message club..."} maxLength={1000} style={{ flex: 1, backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, fontSize: 16, maxHeight: 100 }} multiline />
        <TouchableOpacity onPress={handleSend} disabled={uploadingMedia} style={{ marginLeft: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ color: '#0284c7', fontWeight: 'bold', fontSize: 16 }}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}