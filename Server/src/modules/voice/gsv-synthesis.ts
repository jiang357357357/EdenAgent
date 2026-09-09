import { z } from 'zod'
import type { GsvTtsConfig } from '@eden/api'
import { gsvResponse } from './gsv-client.ts'
const languages: Record<string, string> = { 中文: 'zh', 英文: 'en', 日文: 'ja', 粤语: 'yue', 韩文: 'ko', 粤英混合: 'auto_yue', '多语种混合(粤语)': 'auto_yue', 中英混合: 'auto', 日英混合: 'auto', 韩英混合: 'auto', 多语种混合: 'auto' }
export async function synthesizeGsv(config: GsvTtsConfig, text: string, signal: AbortSignal) {
  let roleId = config.roleId
  if (!roleId) {
    const response = await gsvResponse(config, `/api/role/list/?${new URLSearchParams({ version: config.version, world_name: config.world })}`, signal)
    const payload = z.object({ roles: z.array(z.object({ name: z.string(), id: z.union([z.string(), z.number()]) })) }).parse(JSON.parse(response.bytes.toString('utf8')))
    const role = payload.roles.find(item => item.name === config.role)
    if (!role) throw new Error('Configured GSV voice role was not found')
    roleId = String(role.id)
  }
  const response = await gsvResponse(config, '/api/synthesis/role-emotion', signal, { role_id: roleId, emotion: config.emotion, text,
    text_language: languages[config.textLanguage] ?? config.textLanguage, version: config.version, speed: config.speed, top_k: config.topK,
    top_p: config.topP, temperature: config.temperature, sample_steps: config.sampleSteps, how_to_cut: config.cutMethod,
    pause_second: config.pauseSeconds, return_base64: true, if_sr: config.superResolution, ref_free: config.referenceFree, if_freeze: config.freeze })
  let bytes = response.bytes, mime = response.mime, durationMs: number | null = null
  if (mime === 'application/json') {
    const payload = z.object({ success: z.boolean().optional(), audio_data: z.string().optional(), duration: z.number().finite().nonnegative().optional() }).parse(JSON.parse(bytes.toString('utf8')))
    if (payload.success === false || !payload.audio_data) throw new Error('GSV synthesis returned no audio')
    const encoded = payload.audio_data.split(',').at(-1)!
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('GSV audio is not valid base64')
    bytes = Buffer.from(encoded, 'base64'); mime = 'audio/wav'; durationMs = payload.duration === undefined ? null : Math.round(payload.duration * 1000)
  }
  if (!bytes.length || !mime.startsWith('audio/')) throw new Error('GSV returned empty or non-audio content')
  return { bytes, mime, durationMs, roleId }
}
