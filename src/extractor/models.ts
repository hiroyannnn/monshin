// 選択可能な Transformers.js (ONNX) モデル一覧。
// ID は HuggingFace Hub の onnx-community org で配布されている ONNX 変換済モデル。
// Qwen3 / Qwen3.5 シリーズをサイズ昇順で並べる。

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
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    label: 'Qwen3 0.6B',
    size: '約 600MB',
    sizeGb: 0.6,
    japanese: '◯',
    note: '最軽量。内蔵 GPU でも動きやすい',
  },
  {
    id: 'onnx-community/Qwen3.5-0.8B-ONNX',
    label: 'Qwen3.5 0.8B (推奨)',
    size: '約 1.3GB',
    sizeGb: 1.3,
    japanese: '◎',
    note: '最新世代・軽量。デフォルト',
  },
  {
    id: 'onnx-community/Qwen3.5-2B-ONNX',
    label: 'Qwen3.5 2B',
    size: '約 2.5GB',
    sizeGb: 2.5,
    japanese: '◎',
    note: '高品質。指示追従が安定',
  },
  {
    id: 'onnx-community/Qwen3.5-4B-ONNX',
    label: 'Qwen3.5 4B',
    size: '約 4.5GB',
    sizeGb: 4.5,
    japanese: '◎',
    note: '最高精度。ディスクリート GPU 推奨',
  },
]

export const DEFAULT_MODEL_ID = 'onnx-community/Qwen3.5-0.8B-ONNX'

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
