// WebLLMExtractor の単体テスト。
// Worker は MockWorker に差し替えて、メッセージプロトコルの往復だけを検証する。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createWebLLMExtractor } from './webllm'
import type { ExtractorState } from './types'
import type { WorkerRequest, WorkerEvent } from './worker-protocol'

interface MaybeGpuNavigator {
  gpu?: unknown
}
function setNavigatorGpu(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: Object.assign({}, globalThis.navigator, { gpu: value }),
    configurable: true,
  })
}

// ── Worker 風オブジェクト ──
class MockWorker {
  onmessage: ((e: { data: WorkerEvent }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  posted: WorkerRequest[] = []
  terminated = false

  postMessage(data: WorkerRequest) {
    this.posted.push(data)
  }
  terminate() {
    this.terminated = true
  }
  emit(event: WorkerEvent) {
    this.onmessage?.({ data: event })
  }
}

function makeExtractor() {
  const worker = new MockWorker()
  const ext = createWebLLMExtractor({
    createWorker: () => worker as unknown as Worker,
  })
  return { ext, worker }
}

describe('createWebLLMExtractor', () => {
  afterEach(() => {
    setNavigatorGpu(undefined)
  })

  describe('supports()', () => {
    it('returns false when WebGPU is unavailable', () => {
      setNavigatorGpu(undefined)
      const { ext } = makeExtractor()
      expect(ext.supports()).toBe(false)
      expect(ext.state).toBe('unsupported')
    })

    it('returns true when navigator.gpu exists', () => {
      setNavigatorGpu({})
      const { ext } = makeExtractor()
      expect(ext.supports()).toBe(true)
      expect(ext.state).toBe('idle')
    })
  })

  describe('load()', () => {
    it('transitions idle → downloading → ready and posts a load message', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const states: ExtractorState[] = []
      ext.setListeners({ onStateChange: (s) => states.push(s) })

      const loadPromise = ext.load()
      expect(worker.posted[0]?.type).toBe('load')
      expect(ext.state).toBe('downloading')

      worker.emit({ type: 'loaded' })
      await loadPromise
      expect(ext.state).toBe('ready')
      expect(states).toContain('downloading')
      expect(states).toContain('ready')
    })

    it('forwards progress events', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const progresses: number[] = []
      ext.setListeners({ onProgress: (p) => progresses.push(p.progress ?? -1) })

      const loadPromise = ext.load()
      worker.emit({
        type: 'progress',
        progress: { progress: 0.5, text: 'Downloading...' },
      })
      worker.emit({ type: 'loaded' })
      await loadPromise
      expect(progresses).toContain(0.5)
    })

    it('rejects and transitions to failed on worker error', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const loadPromise = ext.load()
      worker.emit({ type: 'error', code: 'load_failed', message: 'nope' })
      await expect(loadPromise).rejects.toThrow()
      expect(ext.state).toBe('failed')
    })

    it('enters oom state on oom error', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const loadPromise = ext.load()
      worker.emit({ type: 'error', code: 'oom', message: 'out of memory' })
      await expect(loadPromise).rejects.toThrow()
      expect(ext.state).toBe('oom')
    })
  })

  describe('extract()', () => {
    it('runs 2-pass extraction (fields + summary) and merges result', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()

      // load
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      const extractP = ext.extract('頭が痛い。山田太郎、45歳。')
      // 最初のメッセージは load、続いて fields
      expect(worker.posted.at(-1)).toMatchObject({ type: 'extract', mode: 'fields' })
      worker.emit({
        type: 'result',
        raw: '{"name":"山田太郎","age":"45歳","chief_complaint":"頭痛"}',
      })
      // 続いて summary
      // (非同期タスクをフラッシュ)
      await Promise.resolve()
      await Promise.resolve()
      expect(worker.posted.at(-1)).toMatchObject({ type: 'extract', mode: 'summary' })
      worker.emit({ type: 'result', raw: '45歳男性が頭痛を訴えている。' })

      const result = await extractP
      expect(result.fields.name).toBe('山田太郎')
      expect(result.fields.chief_complaint).toBe('頭痛')
      expect(result.fields.summary).toBe('45歳男性が頭痛を訴えている。')
      expect(ext.state).toBe('ready')
    })

    it('succeeds even if summary pass fails (fields already extracted)', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      const extractP = ext.extract('x')
      worker.emit({ type: 'result', raw: '{"name":"太郎"}' })
      await Promise.resolve()
      worker.emit({ type: 'error', code: 'inference_failed', message: 'summary failed' })

      const result = await extractP
      expect(result.fields.name).toBe('太郎')
      expect(result.fields.summary).toBeUndefined()
      // fields が取れていれば ready に戻る
      expect(ext.state).toBe('ready')
    })

    it('rejects extract when fields pass fails', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      const extractP = ext.extract('x')
      worker.emit({ type: 'error', code: 'inference_failed', message: 'bad' })
      await expect(extractP).rejects.toThrow()
      expect(ext.state).toBe('failed')
    })

    it('rejects when called before load()', async () => {
      setNavigatorGpu({})
      const { ext } = makeExtractor()
      await expect(ext.extract('x')).rejects.toThrow()
    })
  })

  describe('streaming', () => {
    it('forwards stream_chunk events and fires onPassStart per pass', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      const chunks: Array<{ pass: string; delta: string }> = []
      const passes: string[] = []
      ext.setListeners({
        onStreamChunk: (pass, delta) => chunks.push({ pass, delta }),
        onPassStart: (pass) => passes.push(pass),
      })

      const extractP = ext.extract('頭痛。')
      // fields pass: 複数チャンクで JSON を送出
      worker.emit({ type: 'stream_chunk', mode: 'fields', delta: '{"name":"太' })
      worker.emit({ type: 'stream_chunk', mode: 'fields', delta: '郎"}' })
      worker.emit({ type: 'result', raw: '{"name":"太郎"}' })
      await Promise.resolve()
      // summary pass
      worker.emit({ type: 'stream_chunk', mode: 'summary', delta: '頭痛を' })
      worker.emit({ type: 'stream_chunk', mode: 'summary', delta: '訴える' })
      worker.emit({ type: 'result', raw: '頭痛を訴える' })

      await extractP
      expect(passes).toEqual(['fields', 'summary'])
      expect(chunks.map((c) => c.delta).join('')).toBe(
        '{"name":"太郎"}頭痛を訴える',
      )
    })
  })

  describe('cancel()', () => {
    it('terminates the worker and rejects in-flight extract', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      const extractP = ext.extract('x')
      ext.cancel()
      await expect(extractP).rejects.toThrow()
      expect(worker.terminated).toBe(true)
      // cancel 後は idle に戻す (再 load を促す)
      expect(ext.state).toBe('idle')
    })
  })

  describe('dispose()', () => {
    it('terminates the worker and sets state disposed', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      // Worker は lazy 生成なので load 経由で作らせる
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      ext.dispose()
      expect(worker.terminated).toBe(true)
      expect(ext.state).toBe('disposed')
    })

    it('is safe to call when worker was never created', () => {
      setNavigatorGpu({})
      const { ext } = makeExtractor()
      ext.dispose()
      expect(ext.state).toBe('disposed')
    })
  })
})

// vi.fn の参照だけ使うためのダミー (lint 回避)
void vi
void ({} as MaybeGpuNavigator)
