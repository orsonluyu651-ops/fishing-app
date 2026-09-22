import { buildPushNotificationPayload, type PushPayloadInput } from '../notificationPayloadEngine';

describe('Social Telemetry Push Payload Compilation Engine', () => {
  it('correctly compiles deep-linking chat markers and strings text lengths', () => {
    const messageInput: PushPayloadInput = {
      type: 'chat_message',
      actorUsername: 'SnagMaster',
      targetEntityId: 'room_12',
      contextPreviewText: 'Heading out to the reef right now around the mouth',
    };

    const payload = buildPushNotificationPayload(messageInput);
    expect(payload.body).toContain('@SnagMaster');
    expect(payload.body).toContain('Heading out to the reef right now around');
    expect(payload.data.urlRoute).toBe('fishingapp://chat/room_12');
    expect(payload.data.entityId).toBe('room_12');
    expect(typeof payload.data.clickTimestamp).toBe('string');
  });

  it('truncates chat preview text to 40 characters', () => {
    const longMessage: PushPayloadInput = {
      type: 'chat_message',
      actorUsername: 'Troller',
      targetEntityId: 'room_5',
      contextPreviewText: 'This is a very long message that should definitely be truncated at exactly forty characters',
    };

    const payload = buildPushNotificationPayload(longMessage);
    // Find the quoted portion after ": \""
    const match = payload.body.match(/"(.+)"/);
    expect(match).not.toBeNull();
    expect(match![1]!.length).toBeLessThanOrEqual(40);
  });

  it('correctly maps endorsement actions to specific activity feed query lines', () => {
    const upvoteInput: PushPayloadInput = {
      type: 'catch_upvote',
      actorUsername: 'ReelQueen',
      targetEntityId: 'catch_88',
    };

    const payload = buildPushNotificationPayload(upvoteInput);
    expect(payload.body).toContain('endorsed your logged catch entry');
    expect(payload.data.urlRoute).toBe('fishingapp://feed?catchId=catch_88');
    expect(payload.data.entityId).toBe('catch_88');
  });

  it('correctly routes comment notifications to the comments-focused feed URL', () => {
    const commentInput: PushPayloadInput = {
      type: 'catch_comment',
      actorUsername: 'FishWhisperer',
      targetEntityId: 'catch_42',
      contextPreviewText: 'What a beauty!',
    };

    const payload = buildPushNotificationPayload(commentInput);
    expect(payload.body).toContain('@FishWhisperer commented');
    expect(payload.data.urlRoute).toBe('fishingapp://feed?catchId=catch_42&focus=comments');
  });

  it('safely scales back to baseline settings when names are empty strings', () => {
    const boundaryInput: PushPayloadInput = {
      type: 'leaderboard_bump',
      actorUsername: '  ',
      targetEntityId: 'board_global',
    };

    const payload = buildPushNotificationPayload(boundaryInput);
    expect(payload.body).toContain('@Someone');
    expect(payload.data.urlRoute).toBe('fishingapp://leaderboard');
  });

  it('falls back to default leaderboard route for unknown notification types', () => {
    const defaultInput = buildPushNotificationPayload({
      type: 'leaderboard_bump',
      actorUsername: 'ProAngler',
      targetEntityId: 'any-id',
    });
    expect(defaultInput.data.urlRoute).toBe('fishingapp://leaderboard');
  });

  it('returns the current ISO timestamp in the payload data', () => {
    const before = Date.now();
    const payload = buildPushNotificationPayload({
      type: 'catch_upvote',
      actorUsername: 'Tester',
      targetEntityId: 'c1',
    });
    const after = Date.now();
    const ts = new Date(payload.data.clickTimestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('handles missing contextPreviewText gracefully for comment notifications', () => {
    const noPreview: PushPayloadInput = {
      type: 'catch_comment',
      actorUsername: 'Anonymous',
      targetEntityId: 'catch_99',
    };

    const payload = buildPushNotificationPayload(noPreview);
    expect(payload.body).toContain('@Anonymous commented: ""');
    expect(payload.data.urlRoute).toBe('fishingapp://feed?catchId=catch_99&focus=comments');
  });
});
