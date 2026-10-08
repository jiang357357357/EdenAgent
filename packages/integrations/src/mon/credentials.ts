/** Account-scoped token provider shared by JSON and media transports. */
export interface MonCredentials {
  token(signal?: AbortSignal, rejectedToken?: string): Promise<string>
}
