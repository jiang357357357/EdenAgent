import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import { normalizeOutput, resolveInsideWorkspace, resolveReadablePath, text, type MonToolOptions } from "./shared"

export function createWorkspaceTools(workspaceRoot: string, options: MonToolOptions = {}): AgentTool[] {
  return [
    {
      name: "read",
      label: "read",
      description: "读取 UTF-8 文本文件。工作区内自动读取，工作区外路径需要用户授权。",
      parameters: Type.Object({
        path: Type.String({ description: "工作区内的相对路径或绝对路径。" }),
        offset: Type.Optional(Type.Number({ description: "从第几行开始读取，行号从 1 开始。" })),
        limit: Type.Optional(Type.Number({ description: "最多读取多少行。" })),
      }),
      async execute(toolCallID, rawInput) {
        const input = rawInput as { path: string; offset?: number; limit?: number }
        const filePath = await resolveReadablePath(workspaceRoot, input.path, options, {
          toolName: "read",
          toolCallID,
          action: "读取文件",
        })
        const raw = await readFile(filePath, "utf8")
        const lines = raw.split(/\r?\n/)
        const start = Math.max(0, (input.offset ?? 1) - 1)
        const end = input.limit ? start + input.limit : Math.min(lines.length, start + 300)
        const body = lines.slice(start, end).join("\n")
        const suffix = end < lines.length ? `\n\n[truncated: showing lines ${start + 1}-${end} of ${lines.length}]` : ""
        return text(body + suffix, { path: filePath, totalLines: lines.length })
      },
    },
    {
      name: "ls",
      label: "ls",
      description: "列出文件和目录。工作区内自动列出，工作区外路径需要用户授权。",
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: "工作区内的目录路径。" })),
      }),
      async execute(toolCallID, rawInput) {
        const input = rawInput as { path?: string }
        const dirPath = await resolveReadablePath(workspaceRoot, input.path ?? ".", options, {
          toolName: "ls",
          toolCallID,
          action: "列出目录",
        })
        const entries = await readdir(dirPath, { withFileTypes: true })
        const lines = await Promise.all(
          entries.map(async (entry) => {
            const entryPath = path.join(dirPath, entry.name)
            const info = await stat(entryPath).catch(() => undefined)
            const kind = entry.isDirectory() ? "dir " : "file"
            return `${kind} ${entry.name}${info && !entry.isDirectory() ? ` ${info.size}B` : ""}`
          }),
        )
        return text(lines.join("\n") || "(empty)", { path: dirPath })
      },
    },
    {
      name: "grep",
      label: "grep",
      description: "使用 ripgrep 搜索文本。工作区内自动搜索，工作区外路径需要用户授权。",
      parameters: Type.Object({
        pattern: Type.String({ description: "搜索关键词或正则表达式。" }),
        path: Type.Optional(Type.String({ description: "工作区内的搜索路径。" })),
        glob: Type.Optional(Type.String({ description: "可选的 glob 文件过滤条件。" })),
      }),
      async execute(toolCallID, rawInput, signal) {
        const input = rawInput as { pattern: string; path?: string; glob?: string }
        const searchPath = await resolveReadablePath(workspaceRoot, input.path ?? ".", options, {
          toolName: "grep",
          toolCallID,
          action: "搜索文本",
        })
        const args = ["--line-number", "--color", "never", "--max-count", "200"]
        if (input.glob) args.push("--glob", input.glob)
        args.push(input.pattern, searchPath)
        const proc = Bun.spawn(["rg", ...args], { stdout: "pipe", stderr: "pipe", signal })
        const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
        await proc.exited
        return text(normalizeOutput(stdout, stderr), { path: searchPath, pattern: input.pattern })
      },
    },
    {
      name: "write",
      label: "write",
      description: "在当前工作区内写入 UTF-8 文本文件。",
      parameters: Type.Object({
        path: Type.String({ description: "工作区内的相对路径或绝对路径。" }),
        content: Type.String({ description: "要写入的文件内容。" }),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, rawInput) {
        const input = rawInput as { path: string; content: string }
        const filePath = resolveInsideWorkspace(workspaceRoot, input.path)
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, input.content, "utf8")
        return text(`Wrote ${input.content.length} characters to ${filePath}`, { path: filePath })
      },
    },
    {
      name: "shell",
      label: "shell",
      description: "在当前工作区内运行 shell 命令。",
      parameters: Type.Object({
        command: Type.String({ description: "要运行的命令。" }),
        timeoutMs: Type.Optional(Type.Number({ description: "超时时间，单位毫秒。" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, rawInput, signal) {
        const input = rawInput as { command: string; timeoutMs?: number }
        const timeout = Math.min(Math.max(input.timeoutMs ?? 30000, 1000), 120000)
        const command =
          process.platform === "win32"
            ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", input.command]
            : ["bash", "-lc", input.command]
        const controller = new AbortController()
        signal?.addEventListener("abort", () => controller.abort(), { once: true })
        const timer = setTimeout(() => controller.abort(), timeout)
        try {
          const proc = Bun.spawn(command, {
            cwd: workspaceRoot,
            stdout: "pipe",
            stderr: "pipe",
            signal: controller.signal,
          })
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ])
          const output = normalizeOutput(stdout, stderr)
          return text(output, { command: input.command, exitCode })
        } finally {
          clearTimeout(timer)
        }
      },
    },
  ]
}
