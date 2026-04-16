// 選択可能な WebLLM モデル一覧。
// ID は @mlc-ai/web-llm の prebuilt app config に登録されているものを利用する。
// 小さいモデルから順に並べて UX 上分かりやすくする。

export interface ModelOption {
  id: string
  label: string
  size: string
  note: string
  /** サイズ目安 (GB、ダウンロード量) */
  sizeGb: number
  /** 日本語性能の目安 ('◎'/'◯'/'△') */
  japanese: '◎' | '◯' | '△'
}

export const AVAILABLE_MODELS: readonly ModelOption[] = [
  {
    id: 'Qwen3-0.6B-q4f16_1-MLC',
    label: 'Qwen3 0.6B',
    size: '約 400MB',
    sizeGb: 0.4,
    japanese: '◯',
    note: '最軽量。内蔵 GPU でも動きやすい',
  },
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    label: 'Qwen3 1.7B (推奨)',
    size: '約 1.0GB',
    sizeGb: 1.0,
    japanese: '◎',
    note: 'バランス型。デフォルト',
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen3 4B',
    size: '約 2.5GB',
    sizeGb: 2.5,
    japanese: '◎',
    note: '高精度。ディスクリート GPU 推奨',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B Instruct',
    size: '約 1.0GB',
    sizeGb: 1.0,
    japanese: '◯',
    note: 'thinking 無しの旧世代。安定志向',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B Instruct',
    size: '約 0.8GB',
    sizeGb: 0.8,
    japanese: '△',
    note: '軽量・高速。英語寄り',
  },
]

export const DEFAULT_MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC'

export function findModel(id: string): ModelOption | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === id)
}

const STORAGE_KEY = 'monshin.selectedModelId'

export function loadSelectedModelId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && findModel(saved)) return saved
  } catch {
    // SSR/プライベートブラウジング等で localStorage が使えない場合
  }
  return DEFAULT_MODEL_ID
}

export function saveSelectedModelId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // ignore
  }
}
