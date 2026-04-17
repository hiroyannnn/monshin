// Transformers.js Extractor の単体テスト。
// 実際の ONNX/WebGPU パイプラインは起動せず、MockWorker でメッセージプロトコル
// 往復と状態遷移のみを検証する。
// PR #9 レビュー指摘の回帰テストをあわせて含む。

import { describe, it, expect, afterEach } from 'vitest'
import { createTransformersExtractor } from './transformers'
import type { ExtractorState } from './types'
import type { WorkerRequest, WorkerEvent } from './worker-protocol'

function setNavigatorGpu(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: Object.assign({}, globalThis.navigator, { gpu: value }),
    configurable: true,
  })
}

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
  const ext = createTransformersExtractor({
    createWorker: () => worker as unknown as Worker,
  })
  return { ext, worker }
}

describe('createTransformersExtractor', () => {
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
        progress: { progress: 0.5, text: 'モデルをダウンロード中…' },
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
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      const extractP = ext.extract('頭が痛い。山田太郎、45歳。')
      expect(worker.posted.at(-1)).toMatchObject({ type: 'extract', mode: 'fields' })
      worker.emit({
        type: 'result',
        raw: '{"name":"山田太郎","age":"45歳","chief_complaint":"頭痛"}',
      })
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
      // summary の worker error 経由で state は failed に遷移済み。
      // extractImpl はそれを上書きしない (PR #9 review 回帰防止)。
      expect(ext.state).toBe('failed')
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

    // 回帰テスト: PR #9 devin #7
    it('transitions state to failed and emits error when fields raw is not valid JSON', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      const errors: Array<{ code: string; message: string }> = []
      ext.setListeners({ onError: (err) => errors.push(err) })

      const extractP = ext.extract('x')
      // JSON で始まらない出力: parseExtractionResponse が throw する。
      worker.emit({ type: 'result', raw: 'this is not json at all' })
      await expect(extractP).rejects.toThrow()
      expect(ext.state).toBe('failed')
      expect(errors[0]?.code).toBe('inference_failed')
      expect(errors[0]?.message).toMatch(/JSON/)
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
      expect(ext.state).toBe('idle')
    })

    // 回帰テスト: PR #9 devin #6
    it('keeps state at idle when canceled during summary pass (does not revert to ready)', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      const loadP = ext.load()
      worker.emit({ type: 'loaded' })
      await loadP

      const extractP = ext.extract('x')
      // fields 成功
      worker.emit({ type: 'result', raw: '{"name":"太郎"}' })
      await Promise.resolve()
      await Promise.resolve()
      // summary 中にキャンセル (summary pending を reject させ、fields のみで解決)
      ext.cancel()
      const result = await extractP
      expect(result.fields.name).toBe('太郎')
      expect(result.fields.summary).toBeUndefined()
      // cancel で state=idle になっているはず。extractImpl が setState("ready") で
      // 上書きしていないこと。
      expect(ext.state).toBe('idle')
    })
  })

  describe('pending slot supersession', () => {
    // 回帰テスト: PR #9 coderabbit #2
    it('rejects the previous pending promise when a new request starts', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
      // load の pending を立てたまま、もう一度 load を呼ぶ
      const first = ext.load()
      const second = ext.load()
      // 2 つ目を settle させる
      worker.emit({ type: 'loaded' })
      await expect(first).rejects.toThrow(/superseded/)
      await expect(second).resolves.toBeUndefined()
    })
  })

  describe('dispose()', () => {
    it('terminates the worker and sets state disposed', async () => {
      setNavigatorGpu({})
      const { ext, worker } = makeExtractor()
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
