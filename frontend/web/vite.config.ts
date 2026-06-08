import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { loadMonConfig } from "../../Script/Project/monconfig"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const monConfig = loadMonConfig(currentDir)
const coreConfig = loadMonConfig(path.resolve(currentDir, "../../../Backend/Server"))
const serverHost = monConfig.get("server", "HOST", "0.0.0.0") ?? "0.0.0.0"
const serverProxyHost = serverHost === "0.0.0.0" || serverHost === "::" ? "127.0.0.1" : serverHost
const serverPort = monConfig.number("server", "PORT", 40092)
const webPort = monConfig.number("server", "WEB_PORT", 40091)
const coreHostRaw = process.env.CORE_SERVER_HOST ?? coreConfig.get("server", "HOST", "127.0.0.1") ?? "127.0.0.1"
const coreHost = coreHostRaw === "0.0.0.0" ? "127.0.0.1" : coreHostRaw
const corePort = Number(process.env.CORE_SERVER_PORT ?? coreConfig.number("server", "PORT", 40011))
const coreBaseUrl = `http://${coreHost}:${corePort}`

const authMode = monConfig.get("auth", "MODE", "production") ?? "production"

export default defineConfig({
  define: {
    __MON_AUTH_MODE__: JSON.stringify(authMode),
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: serverHost,
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://${serverProxyHost}:${serverPort}`,
        changeOrigin: true,
      },
      "/core-api": {
        target: coreBaseUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/core-api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
  },
})
