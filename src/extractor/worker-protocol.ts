// メインスレッド ↔ Worker 間のメッセージ型。
// 1 スレッド 1 操作の前提 (同時推論しない)。

import type { ExtractionProgress } from './types'

export interface LoadRequest {
  type: 'load'
  modelId: string
}

export interface ExtractRequest {
  type: 'extract'
  transcript: string
  mode: 'fields' | 'summary'
}

export interface UnloadRequest {
  type: 'unload'
}

export type WorkerRequest = LoadRequest | ExtractRequest | UnloadRequest

export interface LoadedEvent {
  type: 'loaded'
}

export interface ProgressEvent {
  type: 'progress'
  progress: ExtractionProgress
}

export interface ExtractResultEvent {
  type: 'result'
  raw: string
}

export interface ErrorEvent {
  type: 'error'
  code: 'load_failed' | 'inference_failed' | 'oom' | 'unknown'
  message: string
}

export interface UnloadedEvent {
  type: 'unloaded'
}

export type WorkerEvent =
  | LoadedEvent
  | ProgressEvent
  | ExtractResultEvent
  | ErrorEvent
  | UnloadedEvent

export const DEFAULT_MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC'
