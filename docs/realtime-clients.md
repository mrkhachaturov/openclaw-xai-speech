# Realtime Voice — Client Transport Options

The plugin's `xai-realtime` provider declares two transports:

| Transport | Where the xAI WebSocket lives | Auth |
|---|---|---|
| `gateway-relay` | Gateway holds the WS, proxies audio frames to the client | SuperGrok OAuth bearer (server-side) |
| `provider-websocket` | Client (browser / iOS) opens `wss://api.x.ai/v1/realtime` directly | Ephemeral token (`xai-client-secret.<value>`) minted by gateway |

The plugin's `createBrowserSession` mints the ephemeral via `POST https://api.x.ai/v1/realtime/client_secrets` and returns a `provider-websocket` session shape (`provider`, `transport`, `protocol`, `clientSecret`, `websocketUrl`, `audio`, `expiresAt`). The OAuth bearer never leaves the gateway.

Token shape: `value` is `xai-client-secret.<random>` (already includes the prefix). Clients pass it as the WebSocket subprotocol (`Sec-WebSocket-Protocol: xai-client-secret.<value>`).

## OpenAI compatibility — what it does and doesn't buy us

xAI's realtime API is OpenAI-Realtime-API-compatible at the **event protocol** level: `session.update`, `input_audio_buffer.append`, `response.output_audio.delta`, `response.function_call_arguments.done`, etc. (See [voice-agent-api.md §"OpenAI Realtime API Compatibility"](./voice-agent-api.md) — line ~1139.) Our server-side bridge in `src/realtime-voice-provider.ts` was modeled on the OpenAI bridge and works without modification.

That compatibility does **not** automatically make the OpenClaw Control UI work over a direct xAI WebSocket, because the UI's transport split is by mechanism, not by provider:

- OpenAI in the UI uses **WebRTC** (`wss://api.openai.com/v1/realtime/calls` with SDP offer; ephemeral token in `Authorization: Bearer`). There is **no** OpenAI-over-plain-WebSocket transport in the upstream UI.
- The only `provider-websocket` UI client is `GoogleLiveRealtimeTalkTransport` ([ui/src/ui/chat/realtime-talk.ts:44](../../openclaw/.upstream/ui/src/ui/chat/realtime-talk.ts#L44)). It speaks Google Live's wire shape (`realtimeInput: { ... }` envelopes, distinct event names) — not OpenAI's.
- xAI currently exposes WebSocket only — no WebRTC endpoint.

Net effect: routing an xAI `provider-websocket` session through the UI's existing `GoogleLiveRealtimeTalkTransport` fails — Google Live event shapes don't match xAI's OpenAI-style events.

## Paths forward for browser clients

1. **Keep `gateway-relay`** (current production). One extra hop, but the bridge is shipping and stable. Recommended unless a measurable latency problem appears.
2. **Add a UI transport for xAI over WebSocket.** A new `XaiRealtimeTalkTransport` (mirror of our server bridge's event handling, ~200 LOC) routed when the session `protocol` field starts with `xai-client-secret.`. Could be an upstream PR to OpenClaw — the same shape would also serve any other OpenAI-compatible WS provider.
3. **Wait for xAI WebRTC.** If/when xAI ships WebRTC (SDP offer endpoint), the existing OpenAI `WebRtcSdpRealtimeTalkTransport` becomes reusable with a per-provider `offerUrl` swap.

## iOS

iOS goes straight to option 2-equivalent — we write the WebSocket client ourselves (see cookbook reference at `build/xai-cookbook/iOS/VoiceTesterApp/.../VoiceAgentWebSocket.swift`). The flow:

1. App requests session via gateway `talk.client.create` RPC → gateway calls our `createBrowserSession` → returns `{ websocketUrl, protocol, audio, voice, expiresAt }`.
2. App opens `URLSessionWebSocketTask(url:, protocols: [session.protocol])`. No `Authorization` header — auth lives in the subprotocol slot per xAI docs.
3. App speaks OpenAI-style events (24 kHz PCM16, `input_audio_buffer.append`, `response.output_audio.delta` playback).
4. App owns reconnect/backoff and the [tool-call audio-overlap gating](./voice-agent-api.md) (wait for playback before `response.create`).

## Best-practices conformance

The server-side bridge and the browser-session shape align with the [Best Practices section of voice-agent-api.md](./voice-agent-api.md):

- `server_vad` enabled in `sendSessionUpdate`.
- 24 kHz PCM16 declared for both input and output to avoid resampling.
- Output deltas streamed immediately (`response.output_audio.delta` → `onAudio` with no buffering).
- 401 on the ephemeral mint triggers OAuth refresh + one retry.
- Parallel mic+WS init, reconnect/backoff, and tool-call playback gating are **client** responsibilities — flagged for the iOS patch.
