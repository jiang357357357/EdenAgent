import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { loadMonConfig } from "../../scripts/monconfig"

const monConfig = loadMonConfig()
const serverHost = monConfig.get("server", "HOST", "127.0.0.1") ?? "127.0.0.1"
const serverPort = monConfig.number("server", "PORT", 40082)
const webPort = monConfig.number("server", "WEB_PORT", 40081)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://${serverHost}:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
})
