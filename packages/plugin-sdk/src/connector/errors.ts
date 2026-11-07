/** A business rejection explicitly intended to be shown to the caller. Never include secrets. */
export class ConnectorRequestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message.slice(0, 1000))
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(code) || !message.trim()) throw new Error('Invalid connector request error')
    this.code = code
  }
}
