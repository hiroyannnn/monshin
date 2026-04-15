import { describe, it, expect } from 'vitest'
import {
  buildExtractionMessages,
  buildSummaryMessages,
  parseExtractionResponse,
  EXTRACTION_JSON_SCHEMA,
} from './prompt'

describe('buildExtractionMessages', () => {
  it('embeds the user transcript in the user message', () => {
    const msgs = buildExtractionMessages('頭が痛いです')
    expect(msgs).toHaveLength(2)
    expect(msgs[0]?.role).toBe('system')
    expect(msgs[1]?.role).toBe('user')
    expect(msgs[1]?.content).toContain('頭が痛いです')
  })

  it('instructs the model to return empty strings for unknown fields', () => {
    const msgs = buildExtractionMessages('')
    expect(msgs[0]?.content).toMatch(/空文字/)
  })

  it('forbids markdown fences and extra prose', () => {
    const msgs = buildExtractionMessages('x')
    expect(msgs[0]?.content).toMatch(/JSON/)
  })
})

describe('buildSummaryMessages', () => {
  it('asks for a 2-3 sentence medical summary in Japanese', () => {
    const msgs = buildSummaryMessages('頭痛と発熱')
    expect(msgs[0]?.role).toBe('system')
    expect(msgs[0]?.content).toMatch(/日本語/)
    expect(msgs[1]?.content).toContain('頭痛と発熱')
  })
})

describe('EXTRACTION_JSON_SCHEMA', () => {
  it('declares all 9 extraction fields (summary is a 2nd pass)', () => {
    const props = EXTRACTION_JSON_SCHEMA.properties
    const keys = Object.keys(props)
    expect(keys.sort()).toEqual(
      [
        'name',
        'age',
        'gender',
        'chief_complaint',
        'onset',
        'severity',
        'medications',
        'allergies',
        'history',
      ].sort(),
    )
  })

  it('declares type: object with string properties', () => {
    expect(EXTRACTION_JSON_SCHEMA.type).toBe('object')
    const props = EXTRACTION_JSON_SCHEMA.properties as Record<
      string,
      { type: string }
    >
    for (const key of Object.keys(props)) {
      expect(props[key]?.type).toBe('string')
    }
  })
})

describe('parseExtractionResponse', () => {
  it('parses a clean JSON response', () => {
    const raw = '{"name":"山田太郎","age":"45歳"}'
    const { fields, rawJson } = parseExtractionResponse(raw)
    expect(fields.name).toBe('山田太郎')
    expect(fields.age).toBe('45歳')
    expect(rawJson).toBe(raw)
  })

  it('strips markdown fences if the model forgets', () => {
    const raw = '```json\n{"name":"太郎"}\n```'
    const { fields } = parseExtractionResponse(raw)
    expect(fields.name).toBe('太郎')
  })

  it('extracts the first JSON object if the model prepends text', () => {
    const raw = 'Here is the JSON: {"name":"太郎"}. Thanks!'
    const { fields } = parseExtractionResponse(raw)
    expect(fields.name).toBe('太郎')
  })

  it('throws on unparseable output', () => {
    expect(() => parseExtractionResponse('not json at all')).toThrow()
  })

  it('drops unknown keys from the output', () => {
    const raw = '{"name":"太郎","bogus":"x"}'
    const { fields } = parseExtractionResponse(raw)
    expect(fields.name).toBe('太郎')
    const asRecord: Record<string, unknown> = fields
    expect(asRecord.bogus).toBeUndefined()
  })

  it('coerces null and non-string values to empty', () => {
    const raw = '{"name":"太郎","age":null,"gender":30}'
    const { fields } = parseExtractionResponse(raw)
    expect(fields.name).toBe('太郎')
    expect(fields.age).toBeUndefined()
    expect(fields.gender).toBeUndefined()
  })
})
