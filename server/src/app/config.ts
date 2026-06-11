import path from "node:path"
import { loadMonConfig } from "../../../Script/Project/monconfig"
import { createCoreBaseUrl } from "../core"

export interface AgentServerConfig {
  host: string
  port: number
  vitePort: number
  isDev: boolean
  workspaceRoot: string
  logLevel: string
  coreBaseUrl: string
  authDev: {
    username: string
    password: string
  }
  selfAwake: {
    startupWakeEnabled: boolean
    startupWakeDelaySeconds: number
  }
  hub: {
    enabled: boolean
    address: string
    heartbeatIntervalSeconds: number
    serviceId: string
    serviceName: string
    serviceType: string
    version: string
    description: string
    publicHost: string
  }
}

export function loadAgentServerConfig(): AgentServerConfig {
  const config = loadMonConfig(path.resolve(import.meta.dir, "../../.."))
  const coreConfig = loadMonConfig(path.resolve(config.workspaceRoot, "..", "Backend", "Server"))
  const hubHost = process.env.MON_AGENT_HUB_HOST ?? config.get("hub", "HUB_ZMQ_HOST", "127.0.0.1") ?? "127.0.0.1"
  const hubPort = Number(process.env.MON_AGENT_HUB_PORT ?? "") || config.number("hub", "HUB_ZMQ_PORT", 40051)

  return {
    host: process.env.MON_AGENT_HOST ?? config.get("server", "HOST", "0.0.0.0") ?? "0.0.0.0",
    port: Number(process.env.MON_AGENT_PORT ?? "") || config.number("server", "PORT", 40092),
    vitePort: config.number("server", "WEB_PORT", 40091),
    isDev: !process.env.MON_AGENT_PROD,
    workspaceRoot: path.resolve(process.env.MON_AGENT_WORKSPACE ?? config.workspaceRoot),
    logLevel: config.get("log", "LEVEL", "INFO") ?? "INFO",
    coreBaseUrl: createCoreBaseUrl({
      baseUrl: process.env.MON_CORE_BASE_URL ?? coreConfig.get("server", "BASE_URL"),
      host: coreConfig.get("server", "HOST", "127.0.0.1"),
      port: coreConfig.number("server", "PORT", 40011),
    }),
    authDev: {
      username: process.env.MON_AGENT_CORE_USERNAME ?? config.get("auth_dev", "USERNAME", "") ?? "",
      password: process.env.MON_AGENT_CORE_PASSWORD ?? config.get("auth_dev", "PASSWORD", "") ?? "",
    },
    selfAwake: {
      startupWakeEnabled:
        (process.env.MON_AGENT_STARTUP_SELFAWAKE_ENABLED ??
          config.get("self_awake", "STARTUP_WAKE_ENABLED", "false")) === "true",
      startupWakeDelaySeconds:
        Number(process.env.MON_AGENT_STARTUP_SELFAWAKE_DELAY_SECONDS ?? "") ||
        config.number("self_awake", "STARTUP_WAKE_DELAY_SECONDS", 2),
    },
    hub: {
      enabled: (process.env.MON_AGENT_HUB_ENABLED ?? config.get("hub", "ENABLED", "true")) !== "false",
      address: process.env.MON_AGENT_HUB_ADDRESS ?? `tcp://${hubHost}:${hubPort}`,
      heartbeatIntervalSeconds:
        Number(process.env.MON_AGENT_HUB_HEARTBEAT_INTERVAL ?? "") ||
        config.number("hub", "HEARTBEAT_INTERVAL", 30),
      serviceId: config.get("hub", "SERVICE_ID", "monagent-001") ?? "monagent-001",
      serviceName: config.get("hub", "SERVICE_NAME", config.get("service", "NAME", "MonAgent") ?? "MonAgent") ?? "MonAgent",
      serviceType: config.get("hub", "SERVICE_TYPE", "agent_service") ?? "agent_service",
      version: config.get("service", "VERSION", "0.1.0") ?? "0.1.0",
      description: config.get("hub", "DESCRIPTION", "MonAgent 本地智能体服务") ?? "MonAgent 本地智能体服务",
      publicHost: config.get("service", "PUBLIC_HOST", config.get("server", "PUBLIC_HOST", "auto") ?? "auto") ?? "auto",
    },
  }
}
