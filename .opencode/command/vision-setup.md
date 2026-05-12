---
description: Configure vision model for image analysis
---

Help the user configure a vision-capable AI instance for image analysis.

## Check current state

Read `.opencode/instances.json` to see if any instances are already configured and which one is set as the active vision model (`vision_active` field).

## Guide the user

If no instances exist or no vision model is selected:

1. `/instance-add` — Add an AI instance with name, model, API key, and endpoint
2. `/instance-vision` — Select which instance to use for vision/image analysis

The vision tool automatically uses the instance marked as `vision_active` in instances.json.

## Manage instances

- `/instance-add` — Add a new AI instance (guided wizard)
- `/instance-select` — Set which instance to use for chat/conversation
- `/instance-vision` — Set which instance to use for vision/image analysis
