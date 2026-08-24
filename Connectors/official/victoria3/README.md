# Victoria 3 Connector Package

The Victoria 3 integration runs as an isolated Connector Worker. Build and stage it with:

```bash
cargo build -p mon-agent-connector-victoria3
node Script/Project/package_connector.mjs victoria3 --profile debug
```

The observer is read-only. `probe_control` remains disabled unless `controlEnabled` is explicitly set.
