// 問診票フィールド抽出サービスの抽象。
// 実装: createTransformersExtractor (Hugging Face Transformers.js / WebGPU)

import type { MonshinFields } from '../domain/monshin'

export type ExtractorState =
  | 'unsupported' // WebGPU 等が未対応
  | 'idle' // ロード前
  | 'downloading' // モデルダウンロード/キャッシュロード中
  | 'ready' // 推論可能
  | 'inferencing' // 推論実行中
  | 'failed' // エラー状態 (unload で idle に戻せる)
  | 'oom' // メモリ不足。リロード推奨
  | 'disposed'

export type ExtractorErrorCode =
  | 'unsupported'
  | 'load_failed'
  | 'inference_failed'
  | 'oom'
  | 'cancelled'
  | 'unknown'

export interface ExtractorError {
  code: ExtractorErrorCode
  message: string
}

export interface ExtractionProgress {
  /** 0-1 の進捗率。不明な場合は null */
  progress: number | null
  /** 人間向けステータス文 */
  text: string
}

export interface ExtractionResult {
  fields: Partial<MonshinFields>
  /** モデルの生出力 (デバッグ用) */
  rawJson: string
}

export type ExtractionPass = 'fields' | 'summary'

export interface ExtractorListeners {
  onProgress?: (progress: ExtractionProgress) => void
  /** 推論中のトークンストリーム。mode ごとに届く。 */
  onStreamChunk?: (pass: ExtractionPass, delta: string) => void
  /** パスが切り替わったタイミング (パス開始時に発火) */
  onPassStart?: (pass: ExtractionPass) => void
  onError?: (error: ExtractorError) => void
  onStateChange?: (state: ExtractorState) => void
}

export interface Extractor {
  readonly state: ExtractorState
  /** 同期的にサポート可否を返す (navigator.gpu など) */
  supports(): boolean
  /** モデルをロードする。state: idle → downloading → ready */
  load(): Promise<void>
  /** 発話テキストから問診票フィールドを抽出する */
  extract(text: string): Promise<ExtractionResult>
  /** 推論中の処理をキャンセルする (Worker kill) */
  cancel(): void
  /** モデルをアンロードしメモリを解放する */
  unload(): Promise<void>
  /** Extractor を完全に破棄する (Worker terminate) */
  dispose(): void
  setListeners(listeners: ExtractorListeners): void
}
