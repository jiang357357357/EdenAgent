# MonCore Integration

This directory holds the MonCore integration layer for the opencode backend.

Responsibilities:

- read MonCore-backed settings and character data
- map opencode runtime data to MonCore persistence payloads
- sync opencode session/message events to MonCore
- keep MonCore-specific types and client logic out of the core session runtime

Suggested ownership boundaries:

- `config.ts`: feature flags and runtime configuration
- `types.ts`: MonCore DTOs and integration-local types
- `client.ts`: low-level HTTP client
- `mapper.ts`: opencode <-> MonCore mapping helpers
- `settings.ts`: read user opencode settings
- `characters.ts`: read character data
- `sessions.ts`: session/message persistence APIs
- `sync.ts`: event-driven synchronization hooks

