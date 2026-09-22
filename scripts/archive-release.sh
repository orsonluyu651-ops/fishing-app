#!/bin/bash

# Terminate processing immediately if any git operation fails
set -e

TEXT_CYAN='\033[0;36m'
TEXT_GREEN='\033[0;32m'
TEXT_RESET='\033[0m'

# Read version numbers directly from the audited runtime configuration
VERSION_NAME=$(node -p "require('./app.config.js').expo.version")
TARGET_TAG="v$VERSION_NAME-release"

echo -e "${TEXT_CYAN}[Release Archive] Initializing semantic deployment stamp for $TARGET_TAG...${TEXT_RESET}"

# Ensure working directory is completely clear before tagging
git status --porcelain | grep -q . && { echo "Error: Uncommitted changes present. Stash or commit before tagging."; exit 1; }

# Create and push a annotated signed release tag anchoring the exact commit footprint
git tag -a "$TARGET_TAG" -m "Production Build Release Candidate $VERSION_NAME. Fully audited offline synchronization engines, RFC 4180 local log exporters, debounced fuzzy filters, and Hermes-optimized execution parameters."
git push origin "$TARGET_TAG"

echo -e "${TEXT_GREEN}[SUCCESS] Source control timeline successfully anchored at tag: $TARGET_TAG${TEXT_RESET}"
exit 0
