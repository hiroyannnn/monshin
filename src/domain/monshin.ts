// 問診票ドメイン型と純粋関数

export const FIELD_DEFINITIONS = [
  { key: 'name', label: '氏名', icon: '', placeholder: '山田 太郎' },
  { key: 'age', label: '年齢', icon: '', placeholder: '45歳' },
  { key: 'gender', label: '性別', icon: '', placeholder: '男性 / 女性 / その他' },
  {
    key: 'chief_complaint',
    label: '主訴',
    icon: '',
    placeholder: '頭痛、発熱など',
  },
  { key: 'onset', label: '発症時期', icon: '', placeholder: '3日前から' },
  {
    key: 'severity',
    label: '重症度',
    icon: '',
    placeholder: '軽度 / 中等度 / 重度',
  },
  {
    key: 'medications',
    label: '服用中の薬',
    icon: '',
    placeholder: 'ロキソニン、降圧剤など',
  },
  {
    key: 'allergies',
    label: 'アレルギー',
    icon: '',
    placeholder: '花粉症、ペニシリンなど',
  },
  {
    key: 'history',
    label: '既往歴',
    icon: '',
    placeholder: '高血圧、糖尿病など',
  },
  { key: 'summary', label: '要約', icon: '', placeholder: 'AI が生成した要約' },
] as const satisfies readonly {
  key: string
  label: string
  icon: string
  placeholder: string
}[]

export type MonshinFieldDefinition = (typeof FIELD_DEFINITIONS)[number]
export type MonshinFieldKey = MonshinFieldDefinition['key']
export type MonshinFields = Record<MonshinFieldKey, string>

const FIELD_KEYS: readonly MonshinFieldKey[] = FIELD_DEFINITIONS.map((f) => f.key)
const FIELD_KEY_SET = new Set<string>(FIELD_KEYS)

export function isMonshinFieldKey(key: string): key is MonshinFieldKey {
  return FIELD_KEY_SET.has(key)
}

export function createEmptyForm(): MonshinFields {
  const form = {} as MonshinFields
  for (const key of FIELD_KEYS) {
    form[key] = ''
  }
  return form
}

// base と patch をマージ。patch の空文字列・非文字列・未知キーは無視する。
// LLM の出力は型安全ではないので patch は unknown 由来の任意オブジェクトを受ける。
// 非破壊: base を変更しない。
export function mergeFields(
  base: MonshinFields,
  patch: Readonly<Record<string, unknown>>,
): MonshinFields {
  const merged = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (!isMonshinFieldKey(key)) continue
    if (typeof value !== 'string') continue
    if (value.length === 0) continue
    merged[key] = value
  }
  return merged
}
