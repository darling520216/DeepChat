import { ApiError, request } from './client.js'
import { joinApiPath } from './origin.js'
import type { SingChannelConfig } from '../settings.js'

/**
 * 唱歌接口（sing-gateway / FlowBee 网关，与 astrbot_plugin_deepseek_sing 同源协议）：
 * - 提交任务：POST {api_root}/sing/v1/jobs，body 首字段 model 为 sing-song
 * - 轮询任务：GET {api_root}/sing/v1/jobs/{id}
 * - 成功响应携带 audio_url（网关公开缓存直链，可直接交给 <audio> 播放）
 */

/** 网关约定的唱歌模型名，保持固定 */
const SING_MODEL = 'sing-song'

/** 任务最长等待：网关冷启动首单可能 2~4 分钟，留足余量 */
const DEFAULT_DEADLINE_MS = 300_000
/** 轮询间隔 */
const POLL_INTERVAL_MS = 3_000

export type SingResult = {
  audioUrl: string
  title: string
  artist: string
  durationSeconds: number
  cached: boolean
}

/** 轮询进度回调：seconds 为已等待秒数，status 为网关当前状态 */
export type SingProgress = (seconds: number, status: string) => void

const apiRoot = (channel: SingChannelConfig) => channel.baseUrl.trim().replace(/\/+$/, '')

const authHeaders = (channel: SingChannelConfig): Record<string, string> => {
  const key = channel.apiKey.trim()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

const errorFromResponse = async (response: Response): Promise<ApiError> => {
  const raw = await response.text().catch(() => '')
  let detail = raw
  try {
    const body = JSON.parse(raw) as Record<string, unknown>
    const nested = body.detail ?? body.error
    if (typeof nested === 'string') {
      detail = nested
    } else if (typeof nested === 'object' && nested !== null && 'message' in nested) {
      detail = String((nested as { message: unknown }).message)
    }
  } catch {
    // 非 JSON 响应，保留原文
  }
  return new ApiError('http', `HTTP ${response.status} ${detail.slice(0, 300)}`, response.status)
}

/** 按通道配置与歌名（或音频直链）组装网关任务载荷 */
export const buildSingJobBody = (channel: SingChannelConfig, song: string): Record<string, unknown> => {
  const trimmed = song.trim()
  const clamp = (value: number, min: number, max: number, fallback: number) => {
    if (!Number.isFinite(value)) {
      return fallback
    }
    return Math.min(max, Math.max(min, Math.round(value)))
  }
  return {
    model: SING_MODEL,
    // 直链走 url 字段，歌名走 song 字段（与插件 _job_payload 一致）
    ...(/^https?:\/\//i.test(trimmed) ? { url: trimmed } : { song: trimmed }),
    ...(channel.voice.trim() ? { voice: channel.voice.trim() } : {}),
    duration: clamp(channel.duration, 5, 600, 25),
    start: clamp(channel.start, 0, 3600, 60),
    pitch: clamp(channel.pitch, -24, 24, 0),
    pitch_mode: 'no-change',
    instrumental_volume: channel.instrumental ? -6 : -60,
    backup_vocals_volume: -60,
  }
}

/** 提交翻唱任务，返回任务 id */
export const submitSingJob = async (
  channel: SingChannelConfig,
  song: string,
  signal?: AbortSignal
): Promise<string> => {
  const response = await request(joinApiPath(apiRoot(channel), '/sing/v1/jobs'), {
    method: 'POST',
    headers: { ...authHeaders(channel), 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSingJobBody(channel, song)),
    signal,
  })
  if (!response.ok) {
    throw await errorFromResponse(response)
  }
  const raw = await response.text()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new ApiError('protocol', raw.slice(0, 300))
  }
  const jobId =
    typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'string'
      ? (data as { id: string }).id.trim()
      : ''
  if (!jobId) {
    throw new ApiError('protocol', 'sing-gateway 未返回任务 ID')
  }
  return jobId
}

/** 轮询任务直到成功或失败；默认最长等待 300 秒 */
export const pollSingJob = async (
  channel: SingChannelConfig,
  jobId: string,
  options: { signal?: AbortSignal; onProgress?: SingProgress; deadlineMs?: number } = {}
): Promise<SingResult> => {
  const { signal, onProgress } = options
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  const started = Date.now()
  for (;;) {
    signal?.throwIfAborted()
    const waitedMs = Date.now() - started
    if (waitedMs > deadlineMs) {
      throw new ApiError('stream', `唱歌任务 ${jobId} 超时（${Math.round(deadlineMs / 1000)} 秒）`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    signal?.throwIfAborted()
    const response = await request(joinApiPath(apiRoot(channel), `/sing/v1/jobs/${encodeURIComponent(jobId)}`), {
      headers: authHeaders(channel),
      signal,
    })
    if (!response.ok) {
      throw await errorFromResponse(response)
    }
    const raw = await response.text()
    let data: Record<string, unknown>
    try {
      data = JSON.parse(raw) as Record<string, unknown>
    } catch {
      throw new ApiError('protocol', raw.slice(0, 300))
    }
    const status = typeof data.status === 'string' ? data.status : ''
    if (status === 'succeeded' && typeof data.audio_url === 'string' && data.audio_url) {
      return {
        audioUrl: data.audio_url,
        title: typeof data.title === 'string' ? data.title : '',
        artist: typeof data.artist === 'string' ? data.artist : '',
        durationSeconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : 0,
        cached: data.cached === true,
      }
    }
    if (status === 'failed') {
      throw new ApiError(
        'stream',
        typeof data.error === 'string' && data.error ? data.error : '生成失败'
      )
    }
    onProgress?.(waitedMs / 1000, status)
  }
}
