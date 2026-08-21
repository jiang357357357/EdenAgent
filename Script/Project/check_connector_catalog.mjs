import { readFile } from "node:fs/promises"

const baseUrl = process.env.MON_AGENT_BASE_URL || "http://127.0.0.1:40092"
const tokenFile = process.env.MON_AGENT_TOKEN_FILE || "Data/server-capability.token"
const connectorKey = process.argv[2]
let completed = false

if (!connectorKey) {
  throw new Error("usage: node Script/Project/check_connector_catalog.mjs <connector-key>")
}

const token = (await readFile(tokenFile, "utf8")).trim()
const url = new URL("/rpc", baseUrl.replace(/^http/, "ws"))
const socket = new WebSocket(url, ["mon-agent-rpc-v2", `mon-agent-token.${token}`])
const timeout = setTimeout(() => {
  console.error("connector catalog RPC timed out")
  process.exit(1)
}, 10_000)

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: 2,
      clientName: "connector-catalog-check",
      clientVersion: "1",
      capabilities: [],
    },
  }))
})

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id === 1) {
    if (message.error) throw new Error(message.error.message)
    socket.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "connector.catalog",
      params: {},
    }))
    return
  }
  if (message.id !== 2) return
  if (message.error) throw new Error(message.error.message)
  const connector = message.result?.connectors?.find((item) => item.key === connectorKey)
  console.log(JSON.stringify({
    loaded: Boolean(connector),
    key: connector?.key,
    name: connector?.name,
    version: connector?.version,
    capabilities: connector?.capabilities?.map((item) => item.id) ?? [],
  }))
  completed = true
  clearTimeout(timeout)
  socket.close()
  if (!connector) process.exitCode = 1
})

socket.addEventListener("error", () => {
  if (completed) return
  console.error("connector catalog RPC connection failed")
  process.exit(1)
})
