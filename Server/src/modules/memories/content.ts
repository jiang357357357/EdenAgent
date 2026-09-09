export function memoryContent(raw: string): string {
  const content = raw.replace(/\s+/g, ' ').trim()
  if (!content || content.length > 16000) throw new Error('Memory content must contain 1 to 16000 characters')
  if (/(sk-[A-Za-z0-9_-]{16,}|(?:api[_ -]?key|token|password|密码|密钥|令牌)\s*[:=：]\s*\S+)/i.test(content)) {
    throw new Error('Credentials cannot be stored in long-term memory')
  }
  return content
}
