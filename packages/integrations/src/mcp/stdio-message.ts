import { jsonValue, type JsonValue } from '@eden/api'

export class McpStdioProtocolError extends Error {
  constructor(readonly code: string, detail: string, cause?: unknown) {
    super(`Invalid MCP stdio message [${code}]: ${detail}`, { cause })
  }
}

/** Classify failures without inserting a potentially huge media payload in the error. */
export function decodeMcpStdioMessage(line: Buffer): JsonValue {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(line) }
  catch (cause) { throw new McpStdioProtocolError('MCP_INVALID_UTF8', 'stdout is not valid UTF-8', cause) }
  let value: unknown
  try { value = JSON.parse(text) }
  catch (cause) { throw new McpStdioProtocolError('MCP_INVALID_JSON', 'stdout contains non-JSON output; send logs to stderr', cause) }
  try { return jsonValue.parse(value) }
  catch (cause) { throw new McpStdioProtocolError('MCP_INVALID_VALUE', 'message contains an unsupported JSON value', cause) }
}
