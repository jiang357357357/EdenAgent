# Eden Agent Hearts of Iron IV Observer Connector

This official connector package contains an isolated Rust Worker and the game-side, read-only HOI4 Mod. The Worker communicates with Eden Agent only through Connector Protocol v1; the Server has no HOI4 runtime branch.

Install `package/assets/game-mod` as a local mod, enable it in a launcher playset, and start a campaign. It appends structured telemetry to HOI4's `logs/game.log`. The bridge observes human-controlled countries at startup and once per in-game month. It cannot pause, change speed, issue orders, edit production or research, touch saves, or control the UI.

On Windows, run `Script/Cmd/Win/InstallHoi4Observer.ps1`. Local mods can affect multiplayer checksums and achievement eligibility, so use a separate observation playset.

For development, build and install the package without rebuilding the Server:

```powershell
cargo build -p eden-agent-connector-hoi4
node Script/Project/package_connector.mjs hoi4 --profile debug
```

