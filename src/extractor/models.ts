// 選択可能な WebLLM モデル一覧。
// ID は @mlc-ai/web-llm の prebuilt app config に登録されているものを利用する。
// 新世代 (Qwen3.5 / Qwen3) を中心に、サイズの昇順で並べる。

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
    id: 'Qwen3.5-0.8B-q4f16_1-MLC',
    label: 'Qwen3.5 0.8B',
    size: '約 500MB',
    sizeGb: 0.5,
    japanese: '◎',
    note: '最新世代・最軽量。内蔵 GPU でも快適',
  },
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    label: 'Qwen3 1.7B',
    size: '約 1.0GB',
    sizeGb: 1.0,
    japanese: '◎',
    note: 'thinking 対応の定番サイズ',
  },
  {
    id: 'Qwen3.5-2B-q4f16_1-MLC',
    label: 'Qwen3.5 2B (推奨)',
    size: '約 1.2GB',
    sizeGb: 1.2,
    japanese: '◎',
    note: '最新世代・バランス型。デフォルト',
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen3 4B',
    size: '約 2.5GB',
    sizeGb: 2.5,
    japanese: '◎',
    note: '高精度。ディスクリート GPU 推奨',
  },
]

export const DEFAULT_MODEL_ID = 'Qwen3.5-2B-q4f16_1-MLC'

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
