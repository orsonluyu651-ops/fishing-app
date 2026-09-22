-- 0020_direct_messages.sql
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    text_content TEXT NOT NULL CONSTRAINT max_text_len CHECK (char_length(text_content) <= 1000),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Optimization Indexes for conversation lookups
CREATE INDEX messages_conversation_idx ON public.messages(sender_id, receiver_id, created_at DESC);

-- Enable Security
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own sent or received messages" ON public.messages 
    FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can insert messages as themselves" ON public.messages 
    FOR INSERT WITH CHECK (auth.uid() = sender_id);