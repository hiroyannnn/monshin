import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createWebSpeechTranscriber } from './webspeech'
import type { TranscriberError, TranscriberState } from './types'

// ── Web Speech API のモック ──
interface MockResult {
  transcript: string
  isFinal: boolean
}

interface MockSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: { resultIndex: number; results: MockResult[][] & { [Symbol.iterator](): unknown } }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function makeMockRecognition(): MockSpeechRecognition {
  return {
    lang: '',
    continuous: false,
    interimResults: false,
    maxAlternatives: 0,
    onresult: null,
    onerror: null,
    onend: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  }
}

function installMockSpeechRecognition(instance: MockSpeechRecognition) {
  // Ctor は new で呼び出し可能でないといけないため function として実装
  function Ctor(this: MockSpeechRecognition) {
    Object.assign(this, instance)
    // インスタンス側とモック側で参照を共有するため、プロキシ的に同期する
    return instance as unknown as MockSpeechRecognition
  }
  Object.defineProperty(globalThis, 'SpeechRecognition', {
    value: Ctor,
    configurable: true,
    writable: true,
  })
}

function uninstallMockSpeechRecognition() {
  Object.defineProperty(globalThis, 'SpeechRecognition', {
    value: undefined,
    configurable: true,
    writable: true,
  })
}

// モックの resultIndex+results を作るヘルパ
function makeResults(items: MockResult[]) {
  const results = items.map((r) => {
    const entry = [{ transcript: r.transcript }] as unknown as MockResult[] & {
      isFinal: boolean
    }
    entry.isFinal = r.isFinal
    return entry
  })
  return { resultIndex: 0, results }
}

describe('createWebSpeechTranscriber', () => {
  beforeEach(() => {
    uninstallMockSpeechRecognition()
  })

  describe('supports()', () => {
    it('returns false when SpeechRecognition is unavailable', () => {
      const t = createWebSpeechTranscriber()
      expect(t.supports()).toBe(false)
      expect(t.state).toBe('unsupported')
    })

    it('returns true when SpeechRecognition is present', () => {
      installMockSpeechRecognition(makeMockRecognition())
      const t = createWebSpeechTranscriber()
      expect(t.supports()).toBe(true)
      expect(t.state).toBe('idle')
    })
  })

  describe('start()/stop()', () => {
    it('transitions states: idle → listening → idle and notifies listeners', () => {
      const mock = makeMockRecognition()
      installMockSpeechRecognition(mock)
      const states: TranscriberState[] = []
      const t = createWebSpeechTranscriber()
      t.setListeners({ onStateChange: (s) => states.push(s) })

      t.start()
      expect(mock.start).toHaveBeenCalled()
      expect(t.state).toBe('listening')

      // モックは onend 発火で natural stop を模す
      mock.onend?.()
      // stopRequested フラグがない状態での onend は再開されるが、
      // ユーザーが明示的に stop() した後は再開しない仕様
      t.stop()
      expect(t.state).toBe('idle')
      expect(states).toContain('listening')
      expect(states).toContain('idle')
    })

    it('reports partial and final transcripts via listeners', () => {
      const mock = makeMockRecognition()
      installMockSpeechRecognition(mock)
      const partials: string[] = []
      const finals: string[] = []
      const t = createWebSpeechTranscriber()
      t.setListeners({
        onPartial: (s) => partials.push(s),
        onFinal: (s) => finals.push(s),
      })
      t.start()

      mock.onresult?.(
        makeResults([
          { transcript: '頭が', isFinal: false },
          { transcript: '痛い', isFinal: false },
        ]),
      )
      expect(partials).toContain('頭が痛い')

      mock.onresult?.(
        makeResults([{ transcript: '頭が痛いです', isFinal: true }]),
      )
      expect(finals).toContain('頭が痛いです')
    })

    it('emits error via onError for recognition errors other than no-speech', () => {
      const mock = makeMockRecognition()
      installMockSpeechRecognition(mock)
      const errors: TranscriberError[] = []
      const t = createWebSpeechTranscriber()
      t.setListeners({ onError: (e) => errors.push(e) })
      t.start()

      mock.onerror?.({ error: 'not-allowed' })
      expect(errors[0]?.code).toBe('not_allowed')

      t.dispose()
    })

    it('ignores no-speech errors (browsers fire them harmlessly)', () => {
      const mock = makeMockRecognition()
      installMockSpeechRecognition(mock)
      const errors: TranscriberError[] = []
      const t = createWebSpeechTranscriber()
      t.setListeners({ onError: (e) => errors.push(e) })
      t.start()

      mock.onerror?.({ error: 'no-speech' })
      expect(errors).toHaveLength(0)
    })

    it('auto-restarts on unintentional onend during listening', () => {
      const mock = makeMockRecognition()
      installMockSpeechRecognition(mock)
      const t = createWebSpeechTranscriber()
      t.start()
      expect(mock.start).toHaveBeenCalledTimes(1)

      mock.onend?.()
      // listening 状態の自然終了は再開される
      expect(mock.start).toHaveBeenCalledTimes(2)

      t.stop()
    })

    it('does not restart after stop() is called', () => {
      const mock = makeMockRecognition()
      installMockSpeechRecognition(mock)
      const t = createWebSpeechTranscriber()
      t.start()
      t.stop()
      const callsBefore = (mock.start as ReturnType<typeof vi.fn>).mock.calls.length
      mock.onend?.()
      const callsAfter = (mock.start as ReturnType<typeof vi.fn>).mock.calls.length
      expect(callsAfter).toBe(callsBefore)
    })
  })

  describe('dispose()', () => {
    it('aborts the recognition and marks state as disposed', () => {
      const mock = makeMockRecognition()
      installMockSpeechRecognition(mock)
      const t = createWebSpeechTranscriber()
      t.start()
      t.dispose()
      expect(mock.abort).toHaveBeenCalled()
      expect(t.state).toBe('disposed')
    })
  })
})
