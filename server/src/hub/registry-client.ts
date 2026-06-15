import { networkInterfaces } from "node:os"
import { Dealer } from "zeromq"
import type { AgentServerConfig } from "../app/config"
import type { Logger } from "../shared"

interface HubMessage {
  protocol?: string
  version?: string
  type: string
  source: string
  target: string
  msg_id?: string
  timestamp?: string
  payload?: Record<string, unknown>
}

interface HubResponse {
  type?: string
  correlation_id?: string
  payload?: Record<string, unknown>
}

interface HubResponseWaiter {
  predicate: (message: HubResponse) => boolean
  resolve: (message: HubResponse | null) => void
  timer: Timer
}

function nowIso() {
  return new Date().toISOString()
}

function isPrivate172(address: string) {
  const parts = address.split(".").map((part) => Number(part))
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
}

function resolvePublicHost(configured: string) {
  const value = configured.trim()
  if (value && value !== "auto") return value

  const candidates: Array<{ address: string; score: number }> = []
  for (const [name, items] of Object.entries(networkInterfaces())) {
    for (const item of items ?? []) {
      if (item.family !== "IPv4" || item.internal) continue
      if (item.address.startsWith("169.254.")) continue
      if (item.address === "0.0.0.0") continue

      let score = 0
      if (item.address.startsWith("192.168.")) score += 120
      else if (item.address.startsWith("10.")) score += 100
      else if (isPrivate172(item.address)) score += 80
      else score += 40

      if (/wi-?fi|wlan|wireless|ethernet|以太网|lan/i.test(name)) score += 30
      if (/docker|wsl|hyper-v|vmware|virtualbox|vEthernet|container|loopback|tailscale|zerotier/i.test(name)) {
        score -= 200
      }

      candidates.push({ address: item.address, score })
    }
  }
  candidates.sort((left, right) => right.score - left.score)
  return candidates[0]?.address ?? "127.0.0.1"
}

export class HubRegistryClient {
  private socket?: Dealer
  private heartbeatTimer?: Timer
  private reconnectTimer?: Timer
  private startedAt = nowIso()
  private stopped = false
  private registered = false
  private reconnecting = false
  private heartbeatFailures = 0
  private lastHubMessageAt = Date.now()
  private responseWaiters = new Map<string, HubResponseWaiter>()

  constructor(
    private readonly config: AgentServerConfig,
    private readonly logger: Logger,
  ) {}

  async start() {
    if (!this.config.hub.enabled) {
      this.logger.info("MonHub 注册已关闭")
      return
    }

    this.stopped = false
    try {
      await this.connectAndRegister("startup")
      this.startHeartbeatTimer()
      this.logger.info("MonHub 注册客户端已启动", {
        address: this.config.hub.address,
        serviceId: this.config.hub.serviceId,
      })
    } catch (error) {
      this.logger.warn("MonHub 注册失败，Agent 将继续本地运行", {
        error: error instanceof Error ? error.message : String(error),
      })
      this.scheduleReconnect("startup_failed")
    }
  }

  async stop(reason = "shutdown") {
    this.stopped = true
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    for (const waiter of this.responseWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.resolve(null)
    }
    this.responseWaiters.clear()

    try {
      if (this.socket && this.registered) {
        await this.send({
          type: "SERVICE_UNREGISTER",
          source: this.config.hub.serviceName,
          target: "MonHub",
          payload: {
            service_id: this.config.hub.serviceId,
            reason,
          },
        })
      }
    } catch (error) {
      this.logger.warn("MonHub 注销失败", { error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.registered = false
      this.socket?.close()
      this.socket = undefined
    }
  }

  private async connectAndRegister(reason: string) {
    this.socket?.close()
    this.socket = new Dealer({ routingId: this.config.hub.serviceName })
    this.socket.connect(this.config.hub.address)
    this.registered = false
    this.heartbeatFailures = 0
    this.lastHubMessageAt = Date.now()
    void this.listen(this.socket)
    await this.send({
      type: "HEARTBEAT",
      source: this.config.hub.serviceName,
      target: "MonHub",
      payload: { status: "alive" },
    })
    await this.register(reason)
  }

  private startHeartbeatTimer() {
    if (this.heartbeatTimer) return

    this.heartbeatTimer = setInterval(
      () => void this.heartbeat(),
      Math.max(5, this.config.hub.heartbeatIntervalSeconds) * 1000,
    )
  }

  private scheduleReconnect(reason: string) {
    if (this.stopped || this.reconnecting || this.reconnectTimer) return

    this.logger.warn("MonHub 连接将重建", { reason })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.reconnect(reason)
    }, 2_000)
  }

  private async reconnect(reason: string) {
    if (this.stopped || this.reconnecting) return

    this.reconnecting = true
    try {
      await this.connectAndRegister(`reconnect:${reason}`)
      this.logger.info("MonHub 连接已恢复", {
        address: this.config.hub.address,
        serviceId: this.config.hub.serviceId,
      })
      this.startHeartbeatTimer()
    } catch (error) {
      this.logger.warn("MonHub 重连失败，将继续重试", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      })
      this.registered = false
      this.socket?.close()
      this.socket = undefined
    } finally {
      this.reconnecting = false
    }

    if (!this.stopped && !this.registered) {
      this.scheduleReconnect("retry_after_failure")
    }
  }

  private async register(reason: string) {
    const host = resolvePublicHost(this.config.hub.publicHost)
    await this.send({
      type: "SERVICE_REGISTER",
      source: this.config.hub.serviceName,
      target: "MonHub",
      payload: {
        service_id: this.config.hub.serviceId,
        service_name: this.config.hub.serviceName,
        service_type: this.config.hub.serviceType,
        version: this.config.hub.version,
        status: "online",
        description: this.config.hub.description,
        started_at: this.startedAt,
        endpoints: [
          {
            protocol: "http",
            host,
            port: this.config.port,
            path: "/api",
            primary: true,
            secure: false,
            metadata: { local_host: this.config.host },
          },
          {
            protocol: "web",
            host,
            port: this.config.vitePort,
            path: "/",
            primary: false,
            secure: false,
          },
        ],
        capabilities: [
          "agent.chat",
          "agent.pi_runtime",
          "agent.tool_call",
          "agent.self_awake",
        ],
        metadata: {
          reason,
          workspace_root: this.config.workspaceRoot,
          core_base_url: this.config.coreBaseUrl,
        },
      },
    })
    this.registered = true
    this.logger.info("已发送 MonHub 服务注册", {
      service: this.config.hub.serviceName,
      endpoint: `http://${host}:${this.config.port}`,
    })
  }

  private async heartbeat() {
    const silentLimitMs = Math.max(90, this.config.hub.heartbeatIntervalSeconds * 4) * 1000
    if (Date.now() - this.lastHubMessageAt > silentLimitMs) {
      this.scheduleReconnect("hub_silent")
      return
    }

    try {
      await this.send({
        type: "SERVICE_HEARTBEAT",
        source: this.config.hub.serviceName,
        target: "MonHub",
        payload: {
          service_id: this.config.hub.serviceId,
          status: "online",
          health: 100,
        },
      })
      this.heartbeatFailures = 0
    } catch (error) {
      this.heartbeatFailures += 1
      this.logger.warn("MonHub 心跳发送失败", { error: error instanceof Error ? error.message : String(error) })
      if (this.heartbeatFailures >= 3) {
        this.scheduleReconnect("heartbeat_failed")
      }
    }
  }

  async waitForService(serviceName: string, timeoutMs = 30_000) {
    if (!this.socket) return null

    const msgID = crypto.randomUUID()
    const responsePromise = new Promise<HubResponse | null>((resolve) => {
      const timer = setTimeout(() => {
        this.responseWaiters.delete(msgID)
        resolve(null)
      }, Math.max(timeoutMs + 1_000, 100))

      this.responseWaiters.set(msgID, {
        timer,
        resolve,
        predicate: (message) => {
          const payload = message.payload ?? {}
          if (payload.pending) return false
          return Boolean(payload.service) || payload.success === false
        },
      })
    })

    try {
      await this.send({
        msg_id: msgID,
        type: "SERVICE_QUERY",
        source: this.config.hub.serviceName,
        target: "MonHub",
        payload: {
          service_name: serviceName,
          watch: true,
          watch_timeout: timeoutMs / 1000,
        },
      })
      this.logger.info("等待 MonHub 服务上线", { service: serviceName, timeoutMs })
      const response = await responsePromise
      const payload = response?.payload ?? {}
      const service = payload.service
      if (payload.success && service && typeof service === "object") {
        this.logger.info("MonHub 服务已可用", { service: serviceName })
        return service as Record<string, unknown>
      }
      this.logger.warn("等待 MonHub 服务失败或超时", {
        service: serviceName,
        error: payload.error,
      })
      return null
    } catch (error) {
      const waiter = this.responseWaiters.get(msgID)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.responseWaiters.delete(msgID)
      }
      this.logger.warn("等待 MonHub 服务异常", {
        service: serviceName,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  static selectEndpoint(service: Record<string, unknown>, protocol?: string) {
    const endpoints = Array.isArray(service.endpoints) ? service.endpoints : []
    const candidates = endpoints.filter((endpoint): endpoint is Record<string, unknown> => {
      if (!endpoint || typeof endpoint !== "object") return false
      return !protocol || endpoint.protocol === protocol
    })
    return candidates.find((endpoint) => endpoint.primary === true) ?? candidates[0] ?? null
  }

  private async send(message: HubMessage) {
    if (!this.socket) throw new Error("MonHub socket 尚未初始化")
    const payload = {
      protocol: "MonHub",
      version: "2.0.0",
      msg_id: crypto.randomUUID(),
      timestamp: nowIso(),
      ...message,
    }
    await this.socket.send(["", JSON.stringify(payload)])
  }

  private notifyResponseWaiter(message: HubResponse) {
    const correlationID = message.correlation_id
    if (!correlationID) return
    const waiter = this.responseWaiters.get(correlationID)
    if (!waiter || !waiter.predicate(message)) return

    clearTimeout(waiter.timer)
    this.responseWaiters.delete(correlationID)
    waiter.resolve(message)
  }

  private async listen(socket: Dealer | undefined = this.socket) {
    if (!socket) return

    try {
      for await (const frames of socket) {
        if (this.stopped || this.socket !== socket) return
        const raw = frames.at(-1)?.toString()
        if (!raw) continue
        const message = JSON.parse(raw) as HubResponse
        this.lastHubMessageAt = Date.now()
        if (message.type === "HEARTBEAT") continue
        this.notifyResponseWaiter(message)
        if (message.payload?.error_code === "RE_REGISTER_REQUIRED") {
          this.logger.warn("MonHub 要求重新注册 Agent 服务", message.payload)
          try {
            await this.register("hub_requested")
          } catch (error) {
            this.logger.warn("MonHub 要求重注册但提交失败", { error: error instanceof Error ? error.message : String(error) })
            this.scheduleReconnect("reregister_failed")
          }
        }
      }
    } catch (error) {
      if (!this.stopped && this.socket === socket) {
        this.logger.warn("MonHub 监听已停止", { error: error instanceof Error ? error.message : String(error) })
        this.scheduleReconnect("listen_stopped")
      }
    }
  }
}
