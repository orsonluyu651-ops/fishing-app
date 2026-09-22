export type NotificationType = 'chat_message' | 'catch_upvote' | 'catch_comment' | 'leaderboard_bump';

export interface PushPayloadInput {
  type: NotificationType;
  actorUsername: string;
  targetEntityId: string;
  contextPreviewText?: string;
}

export interface ConsolidatedPushPayload {
  body: string;
  data: {
    urlRoute: string;
    entityId: string;
    clickTimestamp: string;
  };
}

/**
 * Transforms raw operational database event rows into standard notification payload tokens.
 */
export function buildPushNotificationPayload(input: PushPayloadInput): ConsolidatedPushPayload {
  let body = '';
  let urlRoute = '';

  const cleanActor = input.actorUsername.trim() || 'Someone';
  const cleanPreview = input.contextPreviewText?.trim() || '';

  switch (input.type) {
    case 'chat_message':
      body = `@${cleanActor} messaged the club: "${cleanPreview.substring(0, 40)}"`;
      urlRoute = `fishingapp://chat/${input.targetEntityId}`;
      break;
    case 'catch_upvote':
      body = `@${cleanActor} endorsed your logged catch entry! 👑`;
      urlRoute = `fishingapp://feed?catchId=${input.targetEntityId}`;
      break;
    case 'catch_comment':
      body = `@${cleanActor} commented: "${cleanPreview.substring(0, 40)}"`;
      urlRoute = `fishingapp://feed?catchId=${input.targetEntityId}&focus=comments`;
      break;
    case 'leaderboard_bump':
    default:
      body = `@${cleanActor} just jumped ahead of you on the global leaderboard charts! 🏆`;
      urlRoute = `fishingapp://leaderboard`;
      break;
  }

  return {
    body,
    data: {
      urlRoute,
      entityId: input.targetEntityId,
      clickTimestamp: new Date().toISOString(),
    },
  };
}
