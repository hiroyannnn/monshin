import { describe, it, expect } from 'vitest'
import {
  FIELD_DEFINITIONS,
  createEmptyForm,
  isMonshinFieldKey,
  mergeFields,
} from './monshin'
import type { MonshinFields } from './monshin'

describe('FIELD_DEFINITIONS', () => {
  it('includes the 10 required fields in order', () => {
    const keys = FIELD_DEFINITIONS.map((f) => f.key)
    expect(keys).toEqual([
      'name',
      'age',
      'gender',
      'chief_complaint',
      'onset',
      'severity',
      'medications',
      'allergies',
      'history',
      'summary',
    ])
  })

  it('every field has a non-empty label and placeholder', () => {
    for (const field of FIELD_DEFINITIONS) {
      expect(field.label.length).toBeGreaterThan(0)
      expect(field.placeholder.length).toBeGreaterThan(0)
    }
  })
})

describe('createEmptyForm', () => {
  it('returns a form with every field set to an empty string', () => {
    const form = createEmptyForm()
    for (const field of FIELD_DEFINITIONS) {
      expect(form[field.key]).toBe('')
    }
  })

  it('returns a fresh object each call (no aliasing)', () => {
    const a = createEmptyForm()
    const b = createEmptyForm()
    a.name = 'テスト太郎'
    expect(b.name).toBe('')
  })
})

describe('isMonshinFieldKey', () => {
  it('returns true for known keys', () => {
    expect(isMonshinFieldKey('name')).toBe(true)
    expect(isMonshinFieldKey('summary')).toBe(true)
  })

  it('returns false for unknown keys', () => {
    expect(isMonshinFieldKey('unknown')).toBe(false)
    expect(isMonshinFieldKey('')).toBe(false)
  })

  it('narrows the type on unknown input', () => {
    const raw: unknown = 'name'
    if (typeof raw === 'string' && isMonshinFieldKey(raw)) {
      // compile-time check: raw should be MonshinFieldKey here
      const form: MonshinFields = createEmptyForm()
      form[raw] = 'ok'
      expect(form.name).toBe('ok')
    }
  })
})

describe('mergeFields', () => {
  it('overwrites keys present in the patch with non-empty string values', () => {
    const base = createEmptyForm()
    base.name = '既存'
    const merged = mergeFields(base, { name: '新規', age: '30歳' })
    expect(merged.name).toBe('新規')
    expect(merged.age).toBe('30歳')
  })

  it('ignores empty-string values in the patch (preserves base)', () => {
    const base = createEmptyForm()
    base.name = '既存'
    const merged = mergeFields(base, { name: '', age: '30歳' })
    expect(merged.name).toBe('既存')
    expect(merged.age).toBe('30歳')
  })

  it('ignores unknown keys in the patch', () => {
    const base = createEmptyForm()
    const merged = mergeFields(base, { name: '太郎', bogus: 'x' })
    expect(merged.name).toBe('太郎')
    const byKey: Record<string, string> = merged
    expect(byKey.bogus).toBeUndefined()
  })

  it('does not mutate the base form', () => {
    const base = createEmptyForm()
    const merged = mergeFields(base, { name: '太郎' })
    expect(base.name).toBe('')
    expect(merged.name).toBe('太郎')
  })

  it('coerces non-string values to empty (defensive against LLM junk)', () => {
    const base = createEmptyForm()
    // LLM が壊れた JSON を返したケースを模倣
    const merged = mergeFields(base, {
      name: '太郎',
      age: 45,
      gender: null,
    })
    expect(merged.name).toBe('太郎')
    expect(merged.age).toBe('')
    expect(merged.gender).toBe('')
  })
})
