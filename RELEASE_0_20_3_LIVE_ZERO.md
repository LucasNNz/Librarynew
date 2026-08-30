# Corvo Library V2 0.20.3 — LIVE ZERO ENFORCED

## Why 0.20.2 did not visibly clear the published Library

0.20.2 contained the factory-zero migration, but an already connected browser could keep talking to an existing Cloudflare Worker/D1 without forcing that migration to run. If the Core already reported the expected application version, the UI did not insist on the migration step. The result was a new frontend reading old D1 rows such as `PROJ-RECOVER-*` and pending assets.

## 0.20.3 behavior

- The browser runs a release gate once a connected Core is healthy.
- If the Worker is older, the Worker self-update endpoint is invoked and polled until Core 0.20.3 is live.
- Web-managed migrations are applied automatically.
- A dedicated `/control/factory-zero/status` endpoint checks the server-side one-time release marker.
- If needed, `/control/factory-zero` performs an idempotent direct purge of user/content tables even when an older cleanup migration had already been marked as applied.
- The reset preserves `v2_infrastructure_profiles`, `v2_infrastructure_config_events`, the D1/R2 bindings, and structural migration metadata.
- Corvo-managed R2 prefixes are scheduled for cleanup while the bucket itself is preserved.
- After the direct reset, the Worker stores `factory_zero_release_0_20_3=DONE`, so later real imports are not wiped on subsequent browser loads.
- The MCP connection button is visible in the global top bar, in addition to Configurações.

## Expected first boot after publishing 0.20.3

1. `Preparando biblioteca limpa` banner appears.
2. Core update is performed only if required.
3. Schema/migrations are applied.
4. Factory Zero is verified server-side.
5. UI refreshes to 0 assets and 0 projects.
6. Future imports remain persistent because the release marker is DONE.
