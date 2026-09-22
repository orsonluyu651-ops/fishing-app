# Fishlore EAS Cloud Migration Runbook — Archived

> **Archived:** 2026-09-22 · **Verified against:** eas-cli 24.7.0 (repo-pinned, `node_modules/eas-cli`)
> **Baseline at archive time:** 34 suites / 245 tests passing · slug `fishlore-app` · owner `wiretidetest01` · legacy `projectId` `aa4a0e1c-109c-42e3-a5e6-4426f78f69f5`
> **Scope:** break dependency on the legacy remote project container, create the Fishlore cloud destination, bind production credentials, build + submit both platforms.

---

## 0. Corrections validated against the pinned CLI + eas-cli source

| Original spec command | Status on eas-cli 24.7.0 | Replacement |
|---|---|---|
| `eas project:init --force` | Does not exist (not in CLI command registry) | `eas init --force` |
| `eas secret:create --scope project --name … --type string` | Executes, but writes the **legacy secret registry** — invisible to `eas env:list`, which `scripts/verify-eas-secrets.sh` Step 4 greps → gate would fail | `eas env:set … --environment production --scope project` |
| `--value "https://supabase.co"` | Invalid endpoint (bare domain, no project ref) | Real ref sourced from `.env` |
| Dynamic-config write by `eas init` | Impossible: `app.config.js` cannot be auto-modified (CLI prints the JSON snippet, warns, exits non-zero *after* creating the container) | Explicit `node` patch step (Task 1.4) |
| `export EXPO_TOKEN` for local ingestion | CI-only; does nothing to clear local duplicates | Optional; local auth via `eas login` |

`eas init --force` semantics (verified in `projectInitialization.js`):
* remote project missing → **creates** a new container (virgin Fishlore destination)
* remote project exists → links it (idempotent; rename/delete the stale remote app first for a truly empty container)

---

## Task 1 — Cloud Project Re-Initialization Sequence

```bash
cd "/Volumes/Claude Code/Fishing App Project /fishing-app"

# 1.1 Re-authenticate (skip if `npx eas whoami` already resolves)
npx eas login

# 1.2 Create-or-link the fresh 'fishlore-app' container on @wiretidetest01, no prompts
OWNER=$(node -p "require('./app.config.js').expo.owner")
npx eas init --account "$OWNER" --force
#   EXPECTED: "Warning: Your project uses dynamic app configuration, and cannot be
#   automatically modified" + a JSON block containing extra.eas.projectId.
#   Expected for app.config.js projects — the container IS created; Task 1.4 binds it.

# 1.3 Verify remote linkage (slug alignment gate)
npx eas project:info
#   EXPECTED:
#     fullName  wiretidetest01/fishlore-app
#     ID        <new-uuid>

# 1.4 Programmatically bind the authorized projectId into the dynamic config
#     (replaces legacy aa4a0e1c-… in app.config.js extra.eas.projectId)
export PROJECT_ID=$(npx eas project:info | grep -E '^ID' | awk '{print $NF}')
node -e "const fs=require('fs');const f='app.config.js';const s=fs.readFileSync(f,'utf8');const n=s.replace(/projectId:\s*'[^']*'/, \`projectId: '\${process.env.PROJECT_ID}'\`);if(n===s)throw new Error('projectId placeholder not found — no replacement made');fs.writeFileSync(f,n);console.log('app.config.js projectId ->',process.env.PROJECT_ID);"

# 1.5 Binding confirmation gates
node -p "require('./app.config.js').expo.extra.eas.projectId"   # -> new UUID
npx eas project:info | grep -q 'fishlore-app' && echo 'LINKAGE OK: remote slug matches fishlore-app'
```

`extra.eas.projectId` is the single source consumed by `src/lib/notifications.ts` (Expo push tokens) and by every cloud build — Task 1.4 is what breaks the legacy-container dependency.

---

## Task 2 — Parameter-Driven Production Secret Ingestion

```bash
cd "/Volumes/Claude Code/Fishing App Project /fishing-app"

# 2.0 (Optional / CI only) export EXPO_TOKEN="your_expo_token_here"
#     Local runs use the persisted `eas login` session.

# 2.1 Load live Supabase client values from the local source of truth (.env is gitignored)
export SUPABASE_URL=$(grep -m1 '^EXPO_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2-)
export SUPABASE_KEY=$(grep -m1 '^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' .env | cut -d= -f2-)

# 2.2 Supply remaining production credentials (interactive paste — never commit these)
export STRIPE_PK="pk_live_your_production_stripe_key"
export STRIPE_PRICE_MONTHLY="price_your_production_monthly_price_id"
export STRIPE_PRICE_YEARLY="price_your_production_yearly_price_id"
export GMAPS_ANDROID="your_production_google_maps_android_key"

# 2.3 Inject into the NEW container's EAS environment registry (project scope, production)
#     EXPO_PUBLIC_* are public-by-design client values (inlined into the JS bundle) -> plaintext.
npx eas env:set --scope project --environment production --non-interactive --visibility plaintext \
  --name EXPO_PUBLIC_SUPABASE_URL --value "$SUPABASE_URL"
npx eas env:set --scope project --environment production --non-interactive --visibility plaintext \
  --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "$SUPABASE_KEY"
npx eas env:set --scope project --environment production --non-interactive --visibility plaintext \
  --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value "$STRIPE_PK"
# Billing UI consumes these two (app/(tabs)/billing/index.tsx, src/components/PremiumPaywall.tsx):
npx eas env:set --scope project --environment production --non-interactive --visibility plaintext \
  --name EXPO_PUBLIC_STRIPE_PRICE_MONTHLY --value "$STRIPE_PRICE_MONTHLY"
npx eas env:set --scope project --environment production --non-interactive --visibility plaintext \
  --name EXPO_PUBLIC_STRIPE_PRICE_YEARLY --value "$STRIPE_PRICE_YEARLY"
# Native-only build credential (gradle/AndroidManifest on the build runner) -> obfuscated in logs:
npx eas env:set --scope project --environment production --non-interactive --visibility sensitive \
  --name GOOGLE_MAPS_ANDROID_API_KEY --value "$GMAPS_ANDROID"

# 2.4 Audit the production registry (exact invocation the verify gate uses)
npx eas env:list production --scope project --format short
#   EXPECTED: all six names listed (sensitive values render as [hidden]; name presence is what the gate greps)

# 2.5 (Optional) mirror names into preview for staged QA builds
# npx eas env:set --scope project --environment preview --non-interactive --visibility plaintext \
#   --name EXPO_PUBLIC_SUPABASE_URL --value "$SUPABASE_URL"   # repeat per variable

# 2.5b ALTERNATIVE bulk path — only after filling real values in .env.production
#      (it currently ships placeholder shapes):
# npx eas env:push production --path .env.production --force
```

---

## Task 3 — Execution Sanity & Multi-Platform Submission

```bash
cd "/Volumes/Claude Code/Fishing App Project /fishing-app"

# 3.1 Local diagnostics — full variable + linkage alignment gate (exit 0 = all pass)
./scripts/verify-eas-secrets.sh
#   Gates: slug == 'fishlore-app' · active session · project:info contains 'fishlore-app' ·
#          env:list production contains all 4 required names

# 3.2 Baseline regression guard (validated at archive time: 34 suites / 245 tests green)
npx jest --silent

# 3.3 Submission prerequisites — required for --auto-submit --non-interactive:
ls -l android-service-account-key.json   # Play Console service-account JSON referenced by
                                         # eas.json submit.production.android (ABSENT at archive time)
npx eas credentials                       # fresh container starts with EMPTY credential store —
                                          # one-time interactive pass to wire iOS distribution cert /
                                          # provisioning profile (or ASC API key)

# 3.4 Atomic cloud build (Hermes AOT) + auto-submission to App Store Connect & Play Console
npx eas build --profile production --platform all --auto-submit --non-interactive
```

### Operational caveats (fresh-container reality)

1. **Fresh container ⇒ fresh signing assets.** The new project has its own empty keystore/certificate store. To preserve the legacy Android upload-key signature, migrate via `eas credentials` (download from old project → upload to new). A regenerated keystore changes the APK/AAB signature.
2. **`appVersionSource: "remote"` starts clean** — `buildNumber` / `versionCode` history resets in the new container (desired for a rebrand).
3. If the Play service-account key or ASC API key are not yet provisioned, run build-only first and submit interactively after:
   `npx eas build --profile production --platform all` → `npx eas submit --platform ios` / `npx eas submit --platform android`.

---

## Execution status at archive time

* Runbook fully validated against the pinned eas-cli 24.7.0 command surface (`--help` + compiled sources inspected).
* Local baseline re-verified: `npx jest --silent` → 34 suites / 245 tests passing.
* **Not yet executed against expo.dev** — Tasks 1–3 require the authenticated developer terminal (cloud operations).
* Supabase Edge Function secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) remain Supabase-side, never EAS/client — see `docs/ai-assistant-spec.md`.


