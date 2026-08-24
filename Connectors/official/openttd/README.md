# OpenTTD Connector Package

Build and stage the isolated Admin Port Worker with:

```bash
cargo build -p eden-agent-connector-openttd
node Script/Project/package_connector.mjs openttd --profile debug
```

The Worker accepts loopback Admin Port targets only and receives only its declared credential environment variable.
