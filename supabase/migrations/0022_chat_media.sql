-- 0022_chat_media.sql

-- Alter message tables to support optional media payload references
ALTER TABLE public.group_messages ADD COLUMN image_url TEXT DEFAULT NULL;

-- Create Storage Bucket for Chat Attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Security Policies
CREATE POLICY "Club members can view chat assets" ON storage.objects
    FOR SELECT USING (bucket_id = 'chat-attachments');

CREATE POLICY "Authenticated users can upload chat assets" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'chat-attachments'
        AND auth.uid() IS NOT NULL
    );
