-- 0023_push_telemetry.sql

-- Add notification push token registry storage field to the base core user entity
ALTER TABLE public.profiles ADD COLUMN push_token TEXT DEFAULT NULL;

-- Create edge routing dispatcher function definition to broadcast events to a mock external provider
CREATE OR REPLACE FUNCTION public.notify_new_group_message()
RETURNS TRIGGER AS $$
DECLARE
    member_record RECORD;
    sender_name TEXT;
    club_name TEXT;
    target_token TEXT;
BEGIN
    -- Pull sender metadata profile configurations
    SELECT username INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;
    -- Pull primary target group reference name strings
    SELECT name INTO club_name FROM public.groups WHERE id = NEW.group_id;

    -- Route event vectors to every member currently registered within the club boundary target map
    FOR member_record IN 
        SELECT user_id FROM public.group_members WHERE group_id = NEW.group_id AND user_id <> NEW.sender_id
    LOOP
        -- Extract current push token addresses for individual targeted user rows
        SELECT push_token INTO target_token FROM public.profiles WHERE id = member_record.user_id;
        
        -- If an active route target token container address is populated, dispatch event telemetry log
        IF target_token IS NOT NULL THEN
            -- In production, execute a pg_net request link here. For baseline coverage, log out tracking variables.
            RAISE NOTICE 'Notification dispatched payload via target bucket pointer destination address %: [%] %: %', 
                target_token, club_name, sender_name, LEFT(NEW.text_content, 30);
        END IF;
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach continuous monitoring background triggers
CREATE OR REPLACE TRIGGER group_message_push_telemetry_trigger
    AFTER INSERT ON public.group_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_new_group_message();
