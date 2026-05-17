# Changelog

## 0.3.0 — 2026-05-18

### Features
- **`createBrowserSession` for direct client→xAI realtime** — provider now mints
  an xAI ephemeral token (`POST /v1/realtime/client_secrets`) and returns a
  `provider-websocket` browser-session shape so iOS / Control UI can open
  `wss://api.x.ai/v1/realtime` directly with `xai-client-secret.<token>` as the
  WebSocket subprotocol. The OAuth bearer never leaves the gateway.
- **Transport `"provider-websocket"`** added to capabilities alongside
  `gateway-relay`. Gateway picks the right one based on client-requested
  transport (`talk.client.create`).
- **Config knob `ephemeralExpiresAfterSeconds`** (60–600, default 300) controls
  token lifetime.
- Tests: ephemeral mint POST body/headers/clamping/error path; browser session
  shape (defaults, model URL-encoding, voice override, expiresAt passthrough).

### Notes
- Auto-refresh: the ephemeral mint reuses the same OAuth path as TTS, so a 401
  triggers refresh-token rotation and one retry transparently.
- iOS wiring is a follow-up patch in `build/openclaw/` (StGit, macOS-only) —
  cookbook reference at `build/xai-cookbook/iOS/VoiceTesterApp/.../VoiceAgentWebSocket.swift`.

## 0.2.0 — 2026-05-18

### Features
- **Realtime voice provider** (`xai-realtime`) — wraps `wss://api.x.ai/v1/realtime` as
  `RealtimeVoiceProviderPlugin` for OpenClaw Talk mode (Control UI browser, iOS pending).
  Reuses the same SuperGrok OAuth bearer that powers chat + batch TTS.
  - Transport: `gateway-relay` (no client-owned WebRTC; xAI ephemeral-token
    endpoint not yet wired).
  - Capabilities: barge-in, tool calls, PCM16 24kHz in/out.
  - Auto-refreshes OAuth on 401/4401, persists rotated tokens back to disk.
- **Manifest contracts** for both providers — `speechProviders: ["xai-speech"]`
  and `realtimeVoiceProviders: ["xai-realtime"]` so gateway lazy-activates the
  plugin via capability hint instead of broad discovery.
- **Unit tests** (vitest) — truncation, OAuth resolve/refresh, realtime bridge
  interface conformance (catches missing `setMediaTimestamp` / `acknowledgeMark`
  at runtime).

### Notes
- Browser Talk mode requires `talk.realtime.transport: "gateway-relay"` in
  config (Control UI's Provider dropdown is currently hardcoded to OpenAI/Google
  only, but with provider configured server-side the UI fallback to
  `talk.session.create` works for "Auto" / "Gateway relay" selection).

## 0.1.1 — 2026-05-18

### Features
- Smart input truncation to xAI's documented **15,000-char** TTS cap
  (`truncateForTTS` cuts at sentence/word boundary, falls back to hard cut).
- Bumped HTTP timeout to 60s default to accommodate long synthesis requests.
- User-Agent bumped to `openclaw-xai-speech/0.1.1`.

### Fixes
- xAI `/v1/tts` requires the `language` field (returns HTTP 422 otherwise).
  The plugin now always sends it, normalizing `"multi"` to `"auto"`.
- Default MP3 bit rate corrected to **128 kbps** (xAI server default) instead
  of 64 kbps.
- SpeechProvider id changed from `xai` to `xai-speech` to avoid collision with
  the bundled `xai` plugin (which registers its own speech provider for the
  API-key path).

## 0.1.0 — 2026-05-17

### Initial release
- `SpeechProviderPlugin` (`xai-speech`) for OpenClaw batch TTS.
- POSTs to `https://api.x.ai/v1/tts` with Bearer auth.
- Auth precedence: explicit `apiKey` → `XAI_API_KEY` env → SuperGrok OAuth
  profile from `<authProfileAgent>/agent/auth-profiles.json`.
- OAuth flow: reads xAI access/refresh tokens written by
  `openclaw models auth login --provider xai --method oauth`, refreshes
  proactively when within 60s of expiry, persists rotated tokens.
- ffmpeg pipe MP3 → Ogg/Opus conversion for Telegram voice bubbles
  (`voice-note` target, native voice-bubble rendering).
- Configurable voice id, language, codec, sample rate, bit rate, ffmpeg path.
