// Transcriber を React のライフサイクルに繋ぎこむフック。

import { useEffect, useRef, useState } from 'react'
import { createWebSpeechTranscriber } from '../transcriber/webspeech'
import type { Transcriber, TranscriberError, TranscriberState } from '../transcriber/types'

export interface UseTranscriberResult {
  supported: boolean
  state: TranscriberState
  interim: string
  finalText: string
  error: TranscriberError | null
  start: () => void
  stop: () => void
  reset: () => void
  appendFinal: (text: string) => void
  /** ユーザーのテキストエリア編集など、外部から finalText を置き換える */
  setFinalText: (text: string) => void
}

export function useTranscriber(): UseTranscriberResult {
  const transcriberRef = useRef<Transcriber | null>(null)
  const [state, setState] = useState<TranscriberState>('idle')
  const [interim, setInterim] = useState('')
  const [finalText, setFinalText] = useState('')
  const [error, setError] = useState<TranscriberError | null>(null)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    const t = createWebSpeechTranscriber()
    transcriberRef.current = t
    setSupported(t.supports())
    setState(t.state)
    t.setListeners({
      onStateChange: (s) => setState(s),
      onPartial: (text) => setInterim(text),
      onFinal: (text) => {
        setInterim('')
        setFinalText((prev) => prev + text)
      },
      onError: (err) => setError(err),
    })
    return () => {
      t.dispose()
      transcriberRef.current = null
    }
  }, [])

  return {
    supported,
    state,
    interim,
    finalText,
    error,
    start: () => {
      setError(null)
      transcriberRef.current?.start()
    },
    stop: () => {
      transcriberRef.current?.stop()
    },
    reset: () => {
      transcriberRef.current?.stop()
      setInterim('')
      setFinalText('')
      setError(null)
    },
    appendFinal: (text) => {
      setFinalText((prev) => prev + text)
    },
    setFinalText: (text) => {
      setFinalText(text)
    },
  }
}
