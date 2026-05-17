# openclaw-xai-speech

xAI Grok speech synthesis (TTS) provider plugin for [OpenClaw](https://github.com/openclaw/openclaw).

- Reuses **SuperGrok OAuth bearer** from the OpenClaw agent auth store — no separate API key needed
- Falls back to `XAI_API_KEY` env var when no OAuth profile is configured
- ffmpeg MP3→Ogg/Opus conversion for native Telegram/Discord voice bubbles
- Supports xAI built-in voices and console-cloned `voice_id`s

## Install

```bash
openclaw plugins install openclaw-xai-speech
# or, in dev:
openclaw plugins install /path/to/openclaw-xai-speech
```

## Configure

```json5
// .openclaw/config/plugins.json5
{
  "entries": {
    "openclaw-xai-speech": {
      "enabled": true,
      "config": {
        // Optional. Defaults: language=ru-RU, codec=mp3, baseUrl=https://api.x.ai/v1
        "voiceId": "",
        "language": "ru-RU",
        "authProfileAgent": "main"   // agent whose auth-profiles.json holds xai:* OAuth
      }
    }
  }
}
```

Then point messages TTS at it:

```json5
// .openclaw/config/messages.json5
{
  "tts": {
    "provider": "xai",
    "auto": "inbound"
  }
}
```

## Auth precedence

1. `plugins.entries.openclaw-xai-speech.config.apiKey` (explicit override)
2. `XAI_API_KEY` env var
3. xAI OAuth profile (`xai:*`) from `agents/<authProfileAgent>/agent/auth-profiles.json`

Refresh tokens rotate on demand and are written back to the same file.

## Voice notes

For `target=voice-note` (Telegram/Discord), the plugin:
1. Requests MP3 from xAI
2. Pipes it through `ffmpeg -c:a libopus -f ogg`
3. Returns the Opus bytes as `.opus` with `voiceCompatible=true`

ffmpeg must be on `$PATH` (or set `ffmpegPath` in plugin config).

## License

MIT
