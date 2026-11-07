import type { RuntimeModel } from '@eden/runtime-pi'

/** Only model connection settings are read; the caller owns all test data. */
export function configuredPluginTestModel(agentRoot: string): RuntimeModel & { apiKey: string }
