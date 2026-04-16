// WebLLM ベースの Extractor。Worker 分離で推論する。
// 2 パス抽出: fields (JSON) → summary (テキスト)。

import { supportsWebGPU } from './webgpu'
import { parseExtractionResponse, stripThinkTags } from './prompt'
import type {
  Extractor,
  ExtractorError,
  ExtractorListeners,
  ExtractorState,
  ExtractionResult,
} from './types'
import {
  DEFAULT_MODEL_ID,
  type WorkerEvent,
  type WorkerRequest,
} from './worker-protocol'
import type { MonshinFields } from '../domain/monshin'

export interface WebLLMExtractorOptions {
  modelId?: string
  /** Worker を差し替え可能にするフック (テスト用) */
  createWorker?: () => Worker
}

// default: production で実際の Worker モジュールをロード
function defaultCreateWorker(): Worker {
  return new Worker(new URL('./webllm.worker.ts', import.meta.url), {
    type: 'module',
  })
}

type PendingRequest =
  | {
      kind: 'load'
      resolve: () => void
      reject: (err: Error) => void
    }
  | {
      kind: 'extract'
      resolve: (raw: string) => void
      reject: (err: Error) => void
    }
  | {
      kind: 'unload'
      resolve: () => void
      reject: (err: Error) => void
    }

export function createWebLLMExtractor(
  options: WebLLMExtractorOptions = {},
): Extractor {
  const modelId = options.modelId ?? DEFAULT_MODEL_ID
  const createWorker = options.createWorker ?? defaultCreateWorker

  let listeners: ExtractorListeners = {}
  let worker: Worker | null = null
  let pending: PendingRequest | null = null
  let state: ExtractorState = supportsWebGPU() ? 'idle' : 'unsupported'

  function setState(next: ExtractorState) {
    if (state === next) return
    state = next
    listeners.onStateChange?.(next)
  }

  function emitError(err: ExtractorError) {
    listeners.onError?.(err)
  }

  function ensureWorker(): Worker {
    if (!worker) {
      worker = createWorker()
      worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
        handleWorkerEvent(ev.data)
      }
      worker.onerror = () => {
        failPending('inference_failed', 'Worker runtime error')
      }
    }
    return worker
  }

  function send(req: WorkerRequest) {
    const w = ensureWorker()
    w.postMessage(req)
  }

  function failPending(
    code: ExtractorError['code'],
    message: string,
  ) {
    const p = pending
    pending = null
    const err = new Error(message)
    if (p) {
      p.reject(err)
    }
    emitError({ code, message })
  }

  function handleWorkerEvent(event: WorkerEvent) {
    switch (event.type) {
      case 'progress':
        listeners.onProgress?.(event.progress)
        return
      case 'stream_chunk':
        listeners.onStreamChunk?.(event.mode, event.delta)
        return
      case 'loaded': {
        const p = pending
        pending = null
        if (p?.kind === 'load') {
          setState('ready')
          p.resolve()
        }
        return
      }
      case 'result': {
        const p = pending
        pending = null
        if (p?.kind === 'extract') {
          p.resolve(event.raw)
        }
        return
      }
      case 'unloaded': {
        const p = pending
        pending = null
        setState('idle')
        if (p?.kind === 'unload') p.resolve()
        return
      }
      case 'error': {
        const p = pending
        pending = null
        const err = new Error(event.message)
        if (event.code === 'oom') setState('oom')
        else setState('failed')
        if (p) p.reject(err)
        emitError({ code: event.code, message: event.message })
        return
      }
    }
  }

  async function loadImpl(): Promise<void> {
    if (!supportsWebGPU()) {
      const err: ExtractorError = {
        code: 'unsupported',
        message: 'WebGPU 未対応のブラウザです',
      }
      emitError(err)
      throw new Error(err.message)
    }
    if (state === 'ready') return
    setState('downloading')
    return new Promise<void>((resolve, reject) => {
      pending = { kind: 'load', resolve, reject }
      send({ type: 'load', modelId })
    })
  }

  function extractSingle(text: string, mode: 'fields' | 'summary'): Promise<string> {
    listeners.onPassStart?.(mode)
    return new Promise<string>((resolve, reject) => {
      pending = { kind: 'extract', resolve, reject }
      send({ type: 'extract', transcript: text, mode })
    })
  }

  async function extractImpl(text: string): Promise<ExtractionResult> {
    if (state !== 'ready' && state !== 'inferencing') {
      throw new Error(`Extractor が ready ではありません (state=${state})`)
    }
    setState('inferencing')
    let fieldsRaw: string
    try {
      fieldsRaw = await extractSingle(text, 'fields')
    } catch (e) {
      // fields 失敗 = 全体失敗 (setState は handleWorkerEvent で failed 済み)
      throw e instanceof Error ? e : new Error(String(e))
    }

    const parsed = parseExtractionResponse(fieldsRaw)
    const fields: Partial<MonshinFields> = { ...parsed.fields }

    // 2 パス目: summary。失敗しても fields は返す。
    // Qwen3 の <think>...</think> 漏れを除去してから格納する。
    try {
      const summaryRaw = await extractSingle(text, 'summary')
      const summary = stripThinkTags(summaryRaw)
      if (summary.length > 0) fields.summary = summary
    } catch {
      // summary は無くても問題ない
    }

    setState('ready')
    return { fields, rawJson: parsed.rawJson }
  }

  function cancelImpl() {
    if (worker) {
      worker.terminate()
      worker = null
    }
    const p = pending
    pending = null
    if (p) {
      p.reject(new Error('cancelled'))
    }
    // 再 load を促すため idle へ
    setState('idle')
  }

  async function unloadImpl(): Promise<void> {
    if (!worker) {
      setState('idle')
      return
    }
    return new Promise<void>((resolve, reject) => {
      pending = { kind: 'unload', resolve, reject }
      send({ type: 'unload' })
    })
  }

  function disposeImpl() {
    if (worker) {
      worker.terminate()
      worker = null
    }
    pending = null
    listeners = {}
    setState('disposed')
  }

  return {
    get state() {
      return state
    },
    supports() {
      return supportsWebGPU()
    },
    setListeners(next) {
      listeners = { ...next }
    },
    load: loadImpl,
    extract: extractImpl,
    cancel: cancelImpl,
    unload: unloadImpl,
    dispose: disposeImpl,
  }
}
