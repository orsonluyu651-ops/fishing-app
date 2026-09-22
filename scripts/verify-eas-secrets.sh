#!/bin/bash

# Terminate processing immediately if any verification check fails
set -e

TEXT_CYAN='\033[0;36m'
TEXT_GREEN='\033[0;32m'
TEXT_RED='\033[0;31m'
TEXT_RESET='\033[0m'

echo -e "${TEXT_CYAN}[EAS Pre-Flight] Initializing cloud configuration context audit...${TEXT_RESET}"

# Resolve the EAS CLI: prefer the repo-pinned binary (eas-cli is a
# devDependency), then fall back to PATH. A bare `eas` call would
# false-negative "not authenticated" on any machine without a global install.
if [ -x "./node_modules/.bin/eas" ]; then
    EAS_BIN="./node_modules/.bin/eas"
elif command -v eas > /dev/null 2>&1; then
    EAS_BIN="eas"
else
    echo -e "${TEXT_RED}[CRITICAL ERROR] EAS CLI not found (no local binary or PATH entry). Run 'npm ci' first.${TEXT_RESET}"
    exit 1
fi

# Always execute through the resolved binary. This supports the repo-pinned
# CLI without requiring a global `eas` command on a release workstation.
run_eas() {
    "$EAS_BIN" "$@"
}

# Step 1: Verify current authenticated project slug allocation
echo -e "${TEXT_CYAN}[EAS Pre-Flight] Checking app.config.js slug consistency...${TEXT_RESET}"
CURRENT_SLUG=$(node -p "require('./app.config.js').expo.slug")

if [ "$CURRENT_SLUG" != "fishlore-app" ]; then
    echo -e "${TEXT_RED}[CRITICAL ERROR] app.config.js slug is set to '$CURRENT_SLUG' instead of 'fishlore-app'. Build blocked.${TEXT_RESET}"
    exit 1
fi
echo -e "${TEXT_GREEN}[SUCCESS] Configuration identifier matches 'fishlore-app' perfectly.${TEXT_RESET}"

# Step 2: Ensure local user is logged into the Expo CLI system loop
echo -e "${TEXT_CYAN}[EAS Pre-Flight] Checking account credentials...${TEXT_RESET}"
if ! run_eas whoami > /dev/null 2>&1; then
    echo -e "${TEXT_RED}[CRITICAL ERROR] No active EAS account authentication found. Run 'eas login' first.${TEXT_RESET}"
    exit 1
fi
echo -e "${TEXT_GREEN}[SUCCESS] EAS Developer Session is active.${TEXT_RESET}"

# Step 3: Ensure the immutable EAS project link resolves to this rebranded
# slug before querying secrets. A local slug change alone does not rename an
# EAS project; querying the old project would validate the wrong credentials.
echo -e "${TEXT_CYAN}[EAS Pre-Flight] Verifying linked remote project identity...${TEXT_RESET}"
if ! PROJECT_INFO=$(run_eas project:info 2>&1); then
    echo -e "${TEXT_RED}[CRITICAL ERROR] The configured extra.eas.projectId is not linked to the local 'fishlore-app' slug. Rename or create/link the Fishlore EAS project before compiling.${TEXT_RESET}"
    exit 1
fi
if ! echo "$PROJECT_INFO" | grep -q "fishlore-app"; then
    echo -e "${TEXT_RED}[CRITICAL ERROR] The linked EAS project does not identify as 'fishlore-app'. Build blocked to prevent credentials from another project being used.${TEXT_RESET}"
    exit 1
fi
echo -e "${TEXT_GREEN}[SUCCESS] Remote EAS project identity matches 'fishlore-app'.${TEXT_RESET}"

# Step 4: Query the production EAS environment without requesting values.
# `eas secret:list` is deprecated; `env:list` is the supported registry API.
echo -e "${TEXT_CYAN}[EAS Pre-Flight] Querying the production environment registry...${TEXT_RESET}"
SECRETS_LIST=$(run_eas env:list production --scope project --format short)

REQUIRED_SECRETS=(
  "EXPO_PUBLIC_SUPABASE_URL"
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY"
  "GOOGLE_MAPS_ANDROID_API_KEY"
)

for SECRET in "${REQUIRED_SECRETS[@]}"; do
    if ! echo "$SECRETS_LIST" | grep -q "$SECRET"; then
        echo -e "${TEXT_RED}[CRITICAL ERROR] Target compilation secret '$SECRET' is not defined in the remote EAS project dashboard.${TEXT_RESET}"
        exit 1
    fi
done

echo -e "${TEXT_GREEN}[SUCCESS] All target cloud variables verified in project registry. Code base is safe to compile.${TEXT_RESET}"
exit 0
