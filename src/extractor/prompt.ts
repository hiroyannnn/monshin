// LLM への指示 (プロンプト) とレスポンス解析。
// Qwen3-1.7B 向けに最適化: 短命令 + JSON スキーマ + 空文字指示。

import { isMonshinFieldKey, type MonshinFields } from '../domain/monshin'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// 1 パス目: 9 フィールドの事実抽出 (summary は 2 パス目で別扱い)
const EXTRACTION_SYSTEM_PROMPT = `あなたは問診票入力を補助するアシスタントです。
以下の9フィールドを患者の発話から抽出し、JSON のみを返してください。
- name: 氏名
- age: 年齢
- gender: 性別
- chief_complaint: 主訴 (症状)
- onset: 発症時期
- severity: 重症度 (軽度 / 中等度 / 重度)
- medications: 服用中の薬
- allergies: アレルギー
- history: 既往歴

ルール:
- 発話に無い情報は空文字にしてください。推測はしないでください。
- JSON オブジェクトのみを返してください。マークダウンや前置きは不要です。
- 値はすべて日本語の文字列です。`

const SUMMARY_SYSTEM_PROMPT = `あなたは医療系アシスタントです。
患者の発話を 2〜3 文の日本語で医療的に要約してください。
JSON や前置きは不要。要約本文のみを返してください。`

export const EXTRACTION_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    age: { type: 'string' as const },
    gender: { type: 'string' as const },
    chief_complaint: { type: 'string' as const },
    onset: { type: 'string' as const },
    severity: { type: 'string' as const },
    medications: { type: 'string' as const },
    allergies: { type: 'string' as const },
    history: { type: 'string' as const },
  },
  required: [
    'name',
    'age',
    'gender',
    'chief_complaint',
    'onset',
    'severity',
    'medications',
    'allergies',
    'history',
  ],
}

export function buildExtractionMessages(transcript: string): ChatMessage[] {
  return [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `患者の発話:\n${transcript}\n\n上記から 9 フィールドを抽出した JSON を返してください。`,
    },
  ]
}

export function buildSummaryMessages(transcript: string): ChatMessage[] {
  return [
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `次の患者発話を 2〜3 文で要約してください:\n${transcript}`,
    },
  ]
}

// ── レスポンス解析 ──

/**
 * Qwen3 等の reasoning モデルが吐く <think>...</think> を除去する。
 * generation_config で抑制してもモデル側の都合で漏れることがあるため
 * 後処理でも保険的に除去する。
 */
export function stripThinkTags(raw: string): string {
  // 閉じタグまで含むブロックを全削除
  let out = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // 閉じタグだけ残っていたらその直前までを think 領域と見なして削除
  const idx = out.toLowerCase().indexOf('</think>')
  if (idx !== -1) {
    out = out.slice(idx + '</think>'.length)
  }
  // 開始タグだけ残っている (閉じない) パターンは捨てようがないので、
  // タグ本体は消しておく
  out = out.replace(/<\/?think>/gi, '')
  return out.trim()
}

function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

function extractFirstJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  if (start === -1) throw new Error('JSON object not found in response')
  let depth = 0
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  throw new Error('Unterminated JSON object in response')
}

export interface ParsedExtraction {
  fields: Partial<MonshinFields>
  rawJson: string
}

export function parseExtractionResponse(raw: string): ParsedExtraction {
  const withoutThink = stripThinkTags(raw)
  const cleaned = stripFences(withoutThink)
  const jsonText = cleaned.startsWith('{') ? cleaned : extractFirstJsonObject(cleaned)
  const parsed: unknown = JSON.parse(jsonText)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Response is not a JSON object')
  }
  const record = parsed as Record<string, unknown>
  const fields: Partial<MonshinFields> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!isMonshinFieldKey(key)) continue
    if (typeof value !== 'string') continue
    if (value.length === 0) continue
    fields[key] = value
  }
  return { fields, rawJson: jsonText }
}
