# Lichess Connector Package

Build and stage the isolated Worker with:

```bash
cargo build -p mon-agent-connector-lichess
node Script/Project/package_connector.mjs lichess --profile debug
```

Credentials remain identity-scoped (`MON_CONNECTOR_LICHESS_<IDENTITY>`) or may be selected with `tokenEnv`.
