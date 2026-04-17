// Transformers.js Extractor を React ライフサイクルに繋ぎこむフック。
// load() は明示的ボタンで呼ぶ (ページ開いた瞬間にダウンロードしないため)。

import { useEffect, useRef, useState } from 'react'
import { createTransformersExtractor } from '../extractor/transformers'
import type {
  ExtractionPass,
  ExtractionProgress,
  ExtractionResult,
  Extractor,
  ExtractorError,
  ExtractorState,
} from '../extractor/types'

export interface ExtractorStreamState {
  currentPass: ExtractionPass | null
  partialText: string
  elapsedMs: number | null
}

export interface UseExtractorResult {
  supported: boolean
  state: ExtractorState
  progress: ExtractionProgress | null
  error: ExtractorError | null
  stream: ExtractorStreamState
  load: () => Promise<void>
  extract: (transcript: string) => Promise<ExtractionResult>
  cancel: () => void
}

const EMPTY_STREAM: ExtractorStreamState = {
  currentPass: null,
  partialText: '',
  elapsedMs: null,
}

/**
 * @param modelId 使用する Transformers.js モデル ID (ONNX Hub)。変わると Extractor を作り直す。
 */
export function useExtractor(modelId: string): UseExtractorResult {
  const extractorRef = useRef<Extractor | null>(null)
  const [state, setState] = useState<ExtractorState>('idle')
  const [progress, setProgress] = useState<ExtractionProgress | null>(null)
  const [error, setError] = useState<ExtractorError | null>(null)
  const [supported, setSupported] = useState(false)
  const [stream, setStream] = useState<ExtractorStreamState>(EMPTY_STREAM)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    const ext = createTransformersExtractor({ modelId })
    extractorRef.current = ext
    setSupported(ext.supports())
    setState(ext.state)
    setProgress(null)
    setError(null)
    setStream(EMPTY_STREAM)
    ext.setListeners({
      onStateChange: (s) => {
        setState(s)
        if (s === 'inferencing') {
          startedAtRef.current = Date.now()
          setElapsedMs(0)
        } else {
          startedAtRef.current = null
          setElapsedMs(null)
          setStream(EMPTY_STREAM)
        }
      },
      onProgress: (p) => setProgress(p),
      onPassStart: (pass) => {
        setStream({ currentPass: pass, partialText: '', elapsedMs: 0 })
      },
      onStreamChunk: (_pass, delta) => {
        setStream((prev) => ({
          ...prev,
          partialText: prev.partialText + delta,
        }))
      },
      onError: (err) => setError(err),
    })
    return () => {
      ext.dispose()
      extractorRef.current = null
    }
  }, [modelId])

  useEffect(() => {
    if (state !== 'inferencing') return
    const id = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(Date.now() - startedAtRef.current)
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [state])

  return {
    supported,
    state,
    progress,
    error,
    stream: {
      currentPass: stream.currentPass,
      partialText: stream.partialText,
      elapsedMs,
    },
    load: async () => {
      setError(null)
      if (extractorRef.current) await extractorRef.current.load()
    },
    extract: async (transcript) => {
      setError(null)
      const ext = extractorRef.current
      if (!ext) throw new Error('Extractor が初期化されていません')
      return ext.extract(transcript)
    },
    cancel: () => {
      extractorRef.current?.cancel()
    },
  }
}
