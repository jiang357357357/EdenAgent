# Server Integrations

This directory hosts server-facing integration entrypoints.

Use it for:

- bootstrapping external integrations at server startup
- wiring backend-only services that should not leak into the core runtime
- exposing integration-specific routes or handlers in a thin layer

The MonCore integration entrypoint lives here so that transport concerns stay
separate from the generic integration code in `src/integrations`.

