const { contextBridge, ipcRenderer } = require("electron")

function convertFileSrc(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/")
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`
  return `monagent-file://${encodeURI(withLeadingSlash).replace(/#/g, "%23")}`
}

contextBridge.exposeInMainWorld("monAgentDesktop", {
  invoke(command, args) {
    return ipcRenderer.invoke("mon-agent:invoke", command, args ?? {})
  },
  onViewMode(callback) {
    const handler = (_event, mode) => callback(mode)
    ipcRenderer.on("mon-agent-view-mode", handler)
    return () => ipcRenderer.removeListener("mon-agent-view-mode", handler)
  },
  onPetSettings(callback) {
    const handler = (_event, settings) => callback(settings)
    ipcRenderer.on("mon-agent-pet-settings", handler)
    return () => ipcRenderer.removeListener("mon-agent-pet-settings", handler)
  },
  onOpenSettings(callback) {
    const handler = () => callback()
    ipcRenderer.on("mon-agent-open-settings", handler)
    return () => ipcRenderer.removeListener("mon-agent-open-settings", handler)
  },
  convertFileSrc,
})
