// Web Speech API による Transcriber 実装。
// Chrome/Edge の SpeechRecognition を使う。Safari (desktop) もサポート済み。
// continuous: true でも途中で切れるので onend で再開する。

import type {
  Transcriber,
  TranscriberError,
  TranscriberErrorCode,
  TranscriberListeners,
  TranscriberState,
} from './types'

// ── Web Speech API の最小型定義 (lib.dom.d.ts の SpeechRecognition は
// 旧来で互換性が弱いため、必要な最小限だけを定義する) ──
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike extends ArrayLike<SpeechRecognitionAlternativeLike> {
  isFinal: boolean
}
type SpeechRecognitionResultListLike = ArrayLike<SpeechRecognitionResultLike>

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}
interface SpeechRecognitionErrorEventLike {
  error: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike
}

interface MaybeSpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = globalThis as unknown as MaybeSpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function mapErrorCode(raw: string): TranscriberErrorCode {
  switch (raw) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not_allowed'
    case 'audio-capture':
      return 'audio_capture'
    case 'network':
      return 'network'
    case 'aborted':
      return 'aborted'
    default:
      return 'unknown'
  }
}

interface WebSpeechTranscriberOptions {
  lang?: string
}

export function createWebSpeechTranscriber(
  options: WebSpeechTranscriberOptions = {},
): Transcriber {
  const lang = options.lang ?? 'ja-JP'
  const Ctor = getSpeechRecognitionCtor()

  let listeners: TranscriberListeners = {}
  let recognition: SpeechRecognitionLike | null = null
  let state: TranscriberState = Ctor ? 'idle' : 'unsupported'
  let stopRequested = false

  function setState(next: TranscriberState) {
    if (state === next) return
    state = next
    listeners.onStateChange?.(next)
  }

  function emitError(err: TranscriberError) {
    listeners.onError?.(err)
  }

  function createRecognition(): SpeechRecognitionLike {
    if (!Ctor) {
      throw new Error('SpeechRecognition is not available')
    }
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (event) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result) continue
        const alt = result[0]
        if (!alt) continue
        if (result.isFinal) {
          final += alt.transcript
        } else {
          interim += alt.transcript
        }
      }
      if (final) {
        listeners.onFinal?.(final)
      }
      if (interim) {
        listeners.onPartial?.(interim)
      }
    }

    rec.onerror = (event) => {
      if (event.error === 'no-speech') return
      const code = mapErrorCode(event.error)
      emitError({ code, message: `SpeechRecognition error: ${event.error}` })
      if (code !== 'aborted') {
        setState('failed')
      }
    }

    rec.onend = () => {
      if (stopRequested || state === 'disposed' || state === 'failed') {
        if (state === 'listening') setState('idle')
        return
      }
      // 意図しない終了: 再開
      try {
        rec.start()
      } catch {
        // 既に start 済み、または状態不整合。状態を idle に戻す
        setState('idle')
      }
    }

    return rec
  }

  return {
    get state() {
      return state
    },
    supports() {
      return Ctor !== null
    },
    setListeners(next) {
      listeners = { ...next }
    },
    start() {
      if (!Ctor) {
        emitError({ code: 'unsupported', message: 'SpeechRecognition 未対応です' })
        return
      }
      if (state === 'listening' || state === 'disposed') return
      stopRequested = false
      // 前回のインスタンスが残っていれば一度 abort して破棄する。
      // 同じインスタンスの stop/start 循環はブラウザによって挙動が不安定
      if (recognition) {
        try {
          recognition.abort()
        } catch {
          // ignore
        }
        recognition = null
      }
      recognition = createRecognition()
      try {
        recognition.start()
        setState('listening')
      } catch (e) {
        emitError({
          code: 'unknown',
          message: e instanceof Error ? e.message : String(e),
        })
        setState('failed')
      }
    },
    stop() {
      if (state !== 'listening') {
        if (state !== 'disposed') setState('idle')
        return
      }
      stopRequested = true
      try {
        recognition?.stop()
      } catch {
        // ignore
      }
      setState('idle')
    },
    dispose() {
      stopRequested = true
      try {
        recognition?.abort()
      } catch {
        // ignore
      }
      recognition = null
      listeners = {}
      setState('disposed')
    },
  }
}
