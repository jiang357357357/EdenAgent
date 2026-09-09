export class RpcFailure extends Error {
  constructor(readonly code: number, message: string) { super(message) }
}
