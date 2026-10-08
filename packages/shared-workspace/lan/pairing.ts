import { randomBytes, randomUUID, generateKeyPairSync, diffieHellman, createPublicKey } from 'node:crypto'
import { LanError, type Invitation, type Peer } from './contracts.ts'
import { binary, endpoint, integer, publicKey, record, text, uuid } from './validation.ts'
import { signature, verified, digest } from './identity.ts'
import { derive, open, seal } from './encryption.ts'
import { LanRepository } from './repository.ts'
import { post } from './wire.ts'

type Pending = { invite: Invitation; used?: string; response?: unknown }
export class LanPairing {
  private pending: Pending | undefined
  private readonly repository: LanRepository
  private readonly addresses: () => string[]
  private readonly active: () => boolean
  constructor(repository: LanRepository, addresses: () => string[], active: () => boolean) { this.repository = repository; this.addresses = addresses; this.active = active }
  invite() {
    if (!this.active()) throw new LanError(503, '局域网共享未启动')
    const { device } = this.repository
    const invite: Invitation = { id: randomUUID(), deviceId: device.deviceId, name: device.name, publicKey: device.publicKey,
      addresses: this.addresses(), expiresAt: Date.now() + 10 * 60_000, secret: randomBytes(32).toString('base64url') }
    const data = JSON.stringify(invite)
    this.pending = { invite }
    return { code: `eden-lan2:${Buffer.from(JSON.stringify({ data, signature: signature(data, device) })).toString('base64url')}`, expiresAt: invite.expiresAt }
  }
  async accept(body: unknown, source: string): Promise<unknown> {
    const box = record(body), pending = this.pending
    if (!this.active() || !pending || box.invitationId !== pending.invite.id || pending.invite.expiresAt < Date.now()) throw new LanError(403, '配对邀请已失效')
    const context = `pair:${pending.invite.id}`, key = binary(pending.invite.secret, 32)
    const payload = record(open(box.box, key, `${context}:request`)), raw = text(payload.data, 2000), data = record(JSON.parse(raw))
    const deviceId = uuid(data.deviceId), deviceKey = publicKey(data.publicKey)
    if (deviceId === this.repository.device.deviceId || data.invitationId !== pending.invite.id || !verified(raw, deviceKey, payload.signature)) throw new LanError(403, '配对设备身份无效')
    const fingerprint = digest(raw)
    if (pending.used) {
      if (pending.used !== fingerprint) throw new LanError(403, '配对邀请已使用')
      return pending.response
    }
    const port = integer(data.port, 65535)
    if (!port) throw new LanError(400, '配对设备端口无效')
    const ephemeral = generateKeyPairSync('x25519'), remoteKey = createPublicKey({ key: binary(publicKey(data.ephemeral, 'x25519')), type: 'spki', format: 'der' })
    const shared = derive(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: remoteKey }), `${context}:${deviceId}:${this.repository.device.deviceId}`, key)
    this.repository.savePeer({ deviceId, name: text(data.name), publicKey: deviceKey, key: shared.toString('base64url'), addresses: [endpoint(`http://${source}:${port}`)], revoked: false })
    const reply = JSON.stringify({ invitationId: pending.invite.id, deviceId: this.repository.device.deviceId, name: this.repository.device.name,
      publicKey: this.repository.device.publicKey, requester: deviceId, nonce: text(data.nonce, 100), ephemeral: ephemeral.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') })
    pending.used = fingerprint
    pending.response = seal({ data: reply, signature: signature(reply, this.repository.device) }, key, `${context}:response`)
    return pending.response
  }
  async join(code: string, address: string | undefined, port: number, signal: AbortSignal): Promise<{ paired: true }> {
    const invite = decodeInvitation(code), context = `pair:${invite.id}`, key = binary(invite.secret, 32), device = this.repository.device
    if (invite.deviceId === device.deviceId) throw new LanError(400, '不能与本机配对')
    const addresses = address ? [endpoint(address)] : invite.addresses
    if (!addresses.length) throw new LanError(400, '邀请中没有局域网地址，请填写对方电脑的 IPv4 地址和端口')
    const ephemeral = generateKeyPairSync('x25519'), nonce = randomBytes(24).toString('base64url')
    const raw = JSON.stringify({ invitationId: invite.id, deviceId: device.deviceId, name: device.name, publicKey: device.publicKey, port, nonce,
      ephemeral: ephemeral.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') })
    const payload = { invitationId: invite.id, box: seal({ data: raw, signature: signature(raw, device) }, key, `${context}:request`) }
    let failure: unknown = new Error('配对设备不可达')
    for (const target of addresses) {
      try {
        const response = record(open(await post(target, '/eden-lan/v2/pair', payload, signal), key, `${context}:response`))
        const result = this.verifyReply(response, invite, device.deviceId, nonce)
        signal.throwIfAborted(); if (!this.active()) throw new LanError(503, '配对期间局域网共享已关闭')
        const remoteKey = createPublicKey({ key: binary(publicKey(result.ephemeral, 'x25519')), type: 'spki', format: 'der' })
        const shared = derive(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: remoteKey }), `${context}:${device.deviceId}:${invite.deviceId}`, key)
        const peer: Peer = { deviceId: invite.deviceId, name: invite.name, publicKey: invite.publicKey, key: shared.toString('base64url'), addresses: [target], revoked: false }
        this.repository.savePeer(peer); return { paired: true }
      } catch (error) { failure = error; if (signal.aborted || error instanceof LanError && error.status === 403) throw error }
    }
    throw failure
  }
  private verifyReply(response: Record<string, unknown>, invite: Invitation, deviceId: string, nonce: string) {
    const reply = text(response.data, 2000), result = record(JSON.parse(reply))
    if (!verified(reply, invite.publicKey, response.signature) || result.invitationId !== invite.id || result.deviceId !== invite.deviceId
      || result.requester !== deviceId || result.nonce !== nonce || result.publicKey !== invite.publicKey) throw new LanError(403, '配对响应与邀请身份不匹配')
    return result
  }
  clear() { this.pending = undefined }
}
export function decodeInvitation(code: string): Invitation {
  if (!code.startsWith('eden-lan2:') || code.length > 4096) throw new LanError(400, '请输入完整的局域网配对邀请')
  const envelope = record(JSON.parse(binary(code.slice(10)).toString('utf8'))), data = text(envelope.data, 2000), value = record(JSON.parse(data))
  const key = publicKey(value.publicKey)
  if (!verified(data, key, envelope.signature)) throw new LanError(403, '配对邀请签名无效')
  if (!Array.isArray(value.addresses) || value.addresses.length > 16) throw new LanError(400, '无效配对地址')
  const expiresAt = integer(value.expiresAt)
  if (expiresAt < Date.now() || expiresAt > Date.now() + 11 * 60_000) throw new LanError(403, '配对邀请已过期')
  binary(value.secret, 32)
  return { id: uuid(value.id), deviceId: uuid(value.deviceId), name: text(value.name), publicKey: key, secret: String(value.secret),
    addresses: value.addresses.map(endpoint), expiresAt }
}
