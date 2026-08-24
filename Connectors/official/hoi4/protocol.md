# Hearts of Iron IV Bridge Protocol

The Mod uses HOI4's `log` effect to append namespaced records to `logs/game.log`. A normal engine prefix may precede the marker, so the Worker starts parsing at `EDENAGENT_HOI4|`.

```text
EDENAGENT_HOI4|1|HELLO|bridge_version=0.1.0|mode=observe
EDENAGENT_HOI4|1|SNAPSHOT|date=1939.9.1|country_tag=GER|country_name=German Reich|...
```

- Field separator: `|`
- Key/value separator: the first `=` in each field
- Unknown record kinds and protocol versions are ignored
- Values remain strings on the game boundary and are normalized by the Worker
- Snapshot deduplication uses country tag and in-game date
- Protocol v1 contains no gameplay action or process injection

