// 音声文字起こしサービスの抽象。
// 実装: WebSpeechTranscriber (将来: WhisperTranscriber via Transformers.js)

export type TranscriberState =
  | 'unsupported'
  | 'idle'
  | 'listening'
  | 'failed'
  | 'disposed'

export type TranscriberErrorCode =
  | 'unsupported'
  | 'not_allowed'
  | 'audio_capture'
  | 'network'
  | 'aborted'
  | 'unknown'

export interface TranscriberError {
  code: TranscriberErrorCode
  message: string
}

export interface TranscriberListeners {
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (error: TranscriberError) => void
  onStateChange?: (state: TranscriberState) => void
}

export interface Transcriber {
  readonly state: TranscriberState
  supports(): boolean
  start(): void
  stop(): void
  dispose(): void
  setListeners(listeners: TranscriberListeners): void
}
