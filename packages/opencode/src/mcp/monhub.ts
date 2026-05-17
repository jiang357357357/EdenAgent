import dgram from "dgram"
import { randomUUID } from "crypto"

const DEFAULT_UDP_PORT = 40053
const DEFAULT_BROADCAST_ADDRESS = "255.255.255.255"
const DEFAULT_TIMEOUT = 3_000

export interface MonHubDiscoveryConfig {
  type: "monhub"
  serviceName?: string
  serviceType?: string
  capabilities?: string[]
  udpPort?: number
  broadcastAddress?: string
  timeout?: number
}

interface MonHubEndpoint {
  protocol?: string
  host?: string
  port?: number
  path?: string
  primary?: boolean
  metadata?: {
    url?: string
  }
}

interface MonHubService {
  service_name?: string
  service_type?: string
  status?: string
  capabilities?: string[]
  endpoints?: MonHubEndpoint[]
  metadata?: {
    url?: string
  }
}

export async function resolveMonHubMcpUrl(key: string, discovery: MonHubDiscoveryConfig): Promise<string> {
  const serviceName = discovery.serviceName ?? key
  const serviceType = discovery.serviceType ?? "mcp_server"
  const services = await queryMonHub(discovery)
  const service = services.find((item) => matchesService(item, serviceName, serviceType, discovery.capabilities ?? []))

  if (!service) {
    throw new Error(`MonHub service not found: ${serviceName}`)
  }

  const endpoint =
    service.endpoints?.find((item) => item.primary && item.protocol === "mcp.streamable_http") ??
    service.endpoints?.find((item) => item.protocol === "mcp.streamable_http") ??
    service.endpoints?.[0]

  const url = endpoint?.metadata?.url ?? service.metadata?.url ?? endpointToUrl(endpoint)
  if (!url) {
    throw new Error(`MonHub service has no usable MCP endpoint: ${serviceName}`)
  }

  return url
}

function matchesService(service: MonHubService, serviceName: string, serviceType: string, capabilities: string[]) {
  if (service.service_name !== serviceName) return false
  if (serviceType && service.service_type !== serviceType) return false
  if (service.status && service.status !== "online") return false
  return capabilities.every((capability) => service.capabilities?.includes(capability))
}

function endpointToUrl(endpoint: MonHubEndpoint | undefined) {
  if (!endpoint?.host || !endpoint.port) return
  const path = endpoint.path ?? "/mcp"
  return `http://${endpoint.host}:${endpoint.port}${path}`
}

function queryMonHub(discovery: MonHubDiscoveryConfig): Promise<MonHubService[]> {
  const udpPort = discovery.udpPort ?? DEFAULT_UDP_PORT
  const broadcastAddress = discovery.broadcastAddress ?? DEFAULT_BROADCAST_ADDRESS
  const timeout = discovery.timeout ?? DEFAULT_TIMEOUT
  const msgID = randomUUID()
  const payload = Buffer.from(
    JSON.stringify({
      protocol: "MonHub",
      version: "2.0.0",
      msg_id: msgID,
      type: "SERVICE_QUERY",
      source: "opencode",
      target: "MonHub",
      timestamp: new Date().toISOString(),
      payload: {
        query: {
          service_type: discovery.serviceType ?? "mcp_server",
          status: "online",
          capabilities: discovery.capabilities,
        },
      },
    }),
  )

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4")
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error(`Timed out querying MonHub UDP discovery on port ${udpPort}`))
    }, timeout)

    const finish = (services: MonHubService[]) => {
      clearTimeout(timer)
      socket.close()
      resolve(services)
    }

    socket.on("error", (error) => {
      clearTimeout(timer)
      socket.close()
      reject(error)
    })

    socket.on("message", (data) => {
      try {
        const response = JSON.parse(data.toString("utf8"))
        if (response.source !== "MonHub") return
        if (response.correlation_id && response.correlation_id !== msgID) return
        finish(response.payload?.services ?? [])
      } catch {
        return
      }
    })

    socket.bind(0, () => {
      socket.setBroadcast(true)
      socket.send(payload, udpPort, broadcastAddress)
      socket.send(payload, udpPort, "127.0.0.1")
    })
  })
}
