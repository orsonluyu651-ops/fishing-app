#!/usr/bin/env bash
# Manual mock-push dispatcher for the Tidewire simulation layer.
#
# Usage:
#   EXPO_PUSH_TOKEN=ExponentPushToken[xxxxxxxx] ./scripts/send-test-push.sh [deepLink]
#
# The token is what registerForPushNotificationsAsync() resolved on the
# device (also readable from profiles.expo_push_token). deepLink defaults to
# the Guide tab so the banner-tap routing hook has somewhere to go.
set -euo pipefail

TOKEN="${EXPO_PUSH_TOKEN:?Set EXPO_PUSH_TOKEN to the device's Expo push token}"
DEEP_LINK="${1:-/(tabs)/guide}"

PAYLOAD=$(cat <<EOF
[{
  "to": "${TOKEN}",
  "title": "TideWire · Barometer swinging",
  "body": "Pressure moved 5.2 hPa over the last 6h — prime launch frame at Southport Seaway in ~90 minutes.",
  "sound": "default",
  "data": {
    "deepLink": "${DEEP_LINK}",
    "location": "Southport Seaway",
    "varianceHpa": 5.2
  }
}]
EOF
)

echo "Dispatching mock push (deepLink: ${DEEP_LINK})…"
curl -s -X POST "https://exp.host/--/api/v2/push/send" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "${PAYLOAD}"
echo
