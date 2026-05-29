import { createLogger } from "./src/index"

console.log("=".repeat(60))
console.log("  Logs 彩色日志测试")
console.log("=".repeat(60) + "\n")

const log = createLogger("Agent", "prompt")

log.debug("变量值: %s = %d", "count", 42)
log.info("LLM 调用完成，耗时 1234ms")
log.warn("Token 用量接近上限: %d/%d", 7200, 8192)
log.error("API 返回错误", new Error("request timeout"))
log.fatal("不可恢复的连接断开", { sessionID: "abc123" })

const child = log.child("vision")
child.info("开始分析图片: 01_default_stand_transparent.png")
child.debug("base64 解码完成，大小: %d bytes", 1196122)
child.warn("视觉模型响应慢，已等待 5s")

console.log("\n" + "=".repeat(60))
console.log("  测试完成")
console.log("=".repeat(60))
