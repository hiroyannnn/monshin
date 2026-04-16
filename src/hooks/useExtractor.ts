// WebLLM Extractor を React ライフサイクルに繋ぎこむフック。
// load() は明示的ボタンで呼ぶ (ページ開いた瞬間にダウンロードしないため)。

import { useEffect, useRef, useState } from 'react'
import { createWebLLMExtractor } from '../extractor/webllm'
import type {
  ExtractionProgress,
  ExtractionResult,
  Extractor,
  ExtractorError,
  ExtractorState,
} from '../extractor/types'

export interface UseExtractorResult {
  supported: boolean
  state: ExtractorState
  progress: ExtractionProgress | null
  error: ExtractorError | null
  load: () => Promise<void>
  extract: (transcript: string) => Promise<ExtractionResult>
  cancel: () => void
}

export function useExtractor(): UseExtractorResult {
  const extractorRef = useRef<Extractor | null>(null)
  const [state, setState] = useState<ExtractorState>('idle')
  const [progress, setProgress] = useState<ExtractionProgress | null>(null)
  const [error, setError] = useState<ExtractorError | null>(null)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    const ext = createWebLLMExtractor()
    extractorRef.current = ext
    setSupported(ext.supports())
    setState(ext.state)
    ext.setListeners({
      onStateChange: (s) => setState(s),
      onProgress: (p) => setProgress(p),
      onError: (err) => setError(err),
    })
    return () => {
      ext.dispose()
      extractorRef.current = null
    }
  }, [])

  return {
    supported,
    state,
    progress,
    error,
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
