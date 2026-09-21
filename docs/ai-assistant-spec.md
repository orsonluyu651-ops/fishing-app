# Ask TideWire — AI Assistant Architecture Spec

> Status: **Draft v1 (scaffold phase)** · Last updated: 2026-09-21
> Related files: `src/lib/assistant.ts` (V1.1 engine) · `src/lib/rules.ts` (rule resolver) · `supabase/functions/verify-catch/index.ts` (function pattern) · `app/ask-tidewire/index.tsx` (route reservation)

## 1. Purpose and scope

This spec defines how Ask TideWire evolves from the current deterministic answer engine into an LLM-backed assistant **without a provider API key ever shipping inside the React Native bundle**. The chosen pattern is a **Supabase Edge Function proxy**: the client talks only to Supabase; the Edge Function holds provider credentials server-side and talks to the LLM vendor itself.

In scope: proxy architecture, function contract, auth, grounding, cost/rate controls, failure taxonomy, rollout phases.
Out of scope: catch photo verification (covered by `verify-catch`), leaderboard logic, DB schema changes beyond usage tracking.

## 2. Current state (V1.1 — shipped)

- `src/lib/assistant.ts` is a **deterministic engine, not a language model**:
  - every regulatory figure (min/max size, bag limits) is read LIVE from `species`/`fishing_rules` via the shared resolver in `rules.ts` — the same resolver Add Catch uses — so the guide can never quote a rule that contradicts the leaderboard's legality gate;
  - contextual answers (seasons, bait, rigs, tides, how-to) come from curated guides in code; no number in that text is regulatory.
- Species resolution mirrors the app's free-text rule: `common_name` first, then `alternate_names`; the longest phrase match wins.
- Answer shape — the client contract that must survive the proxy upgrade:

```ts
AssistantAnswer = {
  text: string;
  title?: string;               // optional heading (topic guides)
  rule?: RuleCard | null;       // live regulatory card from the DB
  followUps: string[];
  sources: { label: string; url?: string }[];
}
```

- UI copy rule: the screen is presented as a **"guide", never an "AI"**.

## 3. Target architecture — proxy integration pattern

```
┌────────────────────────── React Native (app/) ──────────────────────────┐
│  app/ask-tidewire/index.tsx                                             │
│    └── src/lib/assistant.ts                                             │
│          ├── deterministic engine (unchanged — fallback + grounding)    │
│          └── askTidewireRemote(question) ─► supabase.functions.invoke(  │
│                     'ask-tidewire', { body: { question, history } })    │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ HTTPS + publishable (anon) key + user JWT
                                   ▼
┌──────────────── Supabase Edge Function — Deno runtime ──────────────────┐
│  supabase/functions/ask-tidewire/index.ts                               │
│    1. CORS preflight (mirror verify-catch corsHeaders)                  │
│    2. verify JWT → supabase.auth.getUser(token)        (401 on failure) │
│    3. validate + clamp payload                          (400/422)       │
│    4. per-user rate limit / daily quota check           (429)           │
│    5. build grounded prompt (RuleCards + curated guides resolved from   │
│       the DB server-side — same resolver semantics as rules.ts)         │
│    6. call LLM provider with the Deno.env provider key                  │
│       (the key never leaves the function runtime)                       │
│    7. post-process: figures only from resolved cards, topic fencing,    │
│       output length cap                                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

The single Supabase client stays `src/lib/supabase.ts` — screens never mint their own clients, which is what keeps auth state and RLS behaving consistently.

## 4. Why a proxy (and not a direct provider call from the device)

| Concern | Direct call from device | Edge Function proxy |
|---|---|---|
| API key custody | Bundled in JS — extractable from any APK/IPA | `Deno.env` only, server-side |
| User attribution | Vendor sees token-less, raw-IP traffic | JWT-bound requests, per-user quotas enforceable |
| Cost control | None — any client can burn the key | Per-user daily quota + 429s, provider budget caps |
| Prompt guardrails | Impossible to keep secret | System prompt + response post-processing hidden |
| Expo Go compat | Vendor SDKs may need native modules | Plain `functions.invoke` (fetch-based) — no native module |

Non-goals for the proxy: no caching of personal data in responses, no prompt logging beyond redacted telemetry.

## 5. Supabase Edge Function contract — `ask-tidewire`

Layout and conventions mirror `supabase/functions/verify-catch/` exactly: `Deno.serve`, `corsHeaders(request)`, a `json()` helper, the `{ error, message }` envelope, and a `model_version` echo. The folder is already excluded from app type-checking (`tsconfig.json` → `supabase/functions`) and type-shimmed via `supabase/functions/deno-shims.d.ts`.

### 5.1 Endpoint

- `POST /functions/v1/ask-tidewire` — JSON request/response
- `OPTIONS` — preflight, returns 204

### 5.2 Auth and CORS

The `Authorization` header (user access token) is mandatory: `supabase.auth.getUser(token)` must resolve server-side, and the JWT `sub` is the quota key. CORS mirrors `verify-catch`: `ASK_TIDEWIRE_ALLOWED_ORIGINS` (empty = allow all), `Vary: Origin`, 86400s preflight cache.

### 5.3 Request

| Field | Type | Constraints |
|---|---|---|
| `question` | string | required, 1–500 chars after trim |
| `history` | `{ role: 'user' \| 'assistant'; content: string }[]` | optional, ≤ 6 turns, each ≤ 1000 chars |
| `context` | `{ species?: string }` | optional species hint for prompt grounding |

### 5.4 Response (200)

```json
{
  "answer": {
    "text": "Tailor are 30cm or larger…",
    "title": "Tailor rules",
    "rule": { "species": "tailor", "minLength": 30, "…RuleCard…": "" },
    "followUps": ["What bait should I use?"],
    "sources": [{ "label": "QLD fishing rules", "url": "…" }]
  },
  "model_version": "anthropic:claude-…:2026xxxx",
  "usage": { "input_tokens": 0, "output_tokens": 0 }
}
```

`rule` and `sources` must originate from DB rows resolved server-side (deterministic resolver ported into the function) — the model composes prose only.

### 5.5 Error envelope (mirrors verify-catch)

```json
{ "error": "rate_limited", "message": "Daily guide limit reached." }
```

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_json` / `invalid_question` | malformed body / bounds violation |
| 401 | `unauthorized` | missing, invalid or expired JWT |
| 422 | `invalid_history` | history shape violations |
| 405 | `method_not_allowed` | non-POST/OPTIONS |
| 429 | `rate_limited` | per-user quota exhausted |
| 502 | `provider_error` | LLM vendor returned non-2xx |
| 504 | `provider_timeout` | `AbortSignal.timeout(20_000)` fired |
| 500 | `assistant_failed` | unexpected server error |

### 5.6 Function sketch (structural parity with verify-catch)

```ts
// supabase/functions/ask-tidewire/index.ts (skeleton)
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'POST')
    return json(request, { error: 'method_not_allowed', message: 'Use POST for ask-tidewire.' }, 405);
  try {
    const token = /* Authorization bearer */ '';
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user)
      return json(request, { error: 'unauthorized', message: 'The session is invalid or expired.' }, 401);

    const payload = await request.json(); // validate → 400 / 422 envelope
    if (!(await quotaAllows(userData.user.id)))
      return json(request, { error: 'rate_limited', message: 'Daily guide limit reached.' }, 429);

    const grounded = await buildGroundedPrompt(payload); // RuleCards from DB
    const text = await callProvider(grounded);           // Deno.env provider key
    return json(request, { answer: shapeAnswer(text, grounded.cards), model_version: MODEL_ID, usage });
  } catch (error) {
    if (isTimeout(error))
      return json(request, { error: 'provider_timeout', message: 'The guide took too long.' }, 504);
    console.error('ask-tidewire failed', error);
    return json(request, { error: 'assistant_failed', message: 'Please try again.' }, 500);
  }
});
```

## 6. Client integration

`app/ask-tidewire/index.tsx` (route reserved) calls a thin wrapper instead of any vendor SDK:

```ts
// src/lib/assistant.ts (additive)
export async function askTidewireRemote(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<AssistantAnswer> {
  const { data, error } = await supabase.functions.invoke('ask-tidewire', {
    body: { question, history },
  });
  if (error) throw error; // FunctionsHttpError → map per §5.5
  return data.answer as AssistantAnswer;
}
```

## 7. Grounding and guardrails

1. **Numbers invariant (hard rule):** every regulatory figure shown must come from a `RuleCard` resolved live from the DB; the model may rephrase prose but the UI renders figures from the card. If no card resolves, the function answers with deterministic-engine copy and marks `grounded: false`.
2. Prompt-injection defence: user text is embedded as *data*, never concatenated into instructions; the system prompt forbids revealing prompts/keys; output length capped via `max_tokens`.
3. Topic fencing: off-topic (non-fishing) questions short-circuit to the deterministic `noAnswer` path **without** a provider call (cost + safety).

## 8. Rate limiting and cost controls

- Quota is DB-backed because Edge Functions are stateless/multi-instance: `assistant_usage (user_id uuid, day date, count int, primary key (user_id, day))` via migration `0016_assistant_usage.sql`; an atomic `INSERT … ON CONFLICT … UPDATE count = count + 1 RETURNING` gates every provider call.
- Defaults: 20 questions/user/day, burst 5/min (env-tunable). Hard caps: `max_tokens` 512, provider timeout 20s, `history` ≤ 6 turns.

## 9. Secrets and environment

| Variable | Where | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `.env` (see `.env.example`) | client — already in use |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Function runtime (auto-injected) | server-side DB/auth |
| `ASK_TIDEWIRE_API_KEY` | `supabase secrets set` | provider key — **never** `EXPO_PUBLIC_*`, never in repo |
| `ASK_TIDEWIRE_MODEL` | `supabase secrets set` | pinned model id |
| `ASK_TIDEWIRE_ALLOWED_ORIGINS` | `supabase secrets set` | CORS allowlist (verify-catch pattern) |

## 10. Rollout phases

> Status 2026-09-21: **Phases A–C implemented** — route, client wrapper (`src/lib/askTidewire.ts`), chat UI and the provider-backed proxy function (`supabase/functions/ask-tidewire/index.ts`) are in place. Phase D (streaming) and the DB-backed quota (§8) remain open.

- **Phase A (this scaffold):** route reserved at `app/ask-tidewire/index.tsx`; this spec; jest baseline pinning the failure taxonomy (`src/lib/__tests__/offlineCatchQueue.test.ts`). ✅
- **Phase B:** Edge Function shell returns deterministic-engine results through the §5 contract (no provider call yet) — lets client wiring, auth and quota land safely. ✅ (superseded: the live function ships with provider support and the deterministic engine remains the documented fallback.)
- **Phase C:** provider integration behind `buildGroundedPrompt` / `callProvider`, with grounding-invariant tests (figures only from cards). ✅ (function implemented; invariant tests land with Phase D hardening.)
- **Phase D:** streaming (SSE passthrough) — only after the JSON contract is stable; non-streaming JSON remains the fallback.

## 11. Risks and open questions

- Provider availability → always degrade to the deterministic engine; the guide never dead-ends.
- Vendor response drift → `model_version` echoed in every response for auditability.
- Multi-instance Edge Functions → never count quota in memory; DB-backed counters only.
- `functions.invoke` inside standard Expo Go must be verified on device in Phase B (it is fetch-based, so no native module is expected).
- Cost drift → alerts on provider spend; the `usage` field in responses feeds the dashboard.


