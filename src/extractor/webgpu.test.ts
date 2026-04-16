import { describe, it, expect, afterEach } from 'vitest'
import { supportsWebGPU } from './webgpu'

interface MaybeGpuNavigator {
  gpu?: { requestAdapter?: () => unknown }
}

function setNavigatorGpu(value: MaybeGpuNavigator['gpu']) {
  Object.defineProperty(globalThis, 'navigator', {
    value: Object.assign({}, globalThis.navigator, { gpu: value }),
    configurable: true,
  })
}

describe('supportsWebGPU', () => {
  afterEach(() => {
    // jsdom の navigator を素に戻す
    setNavigatorGpu(undefined)
  })

  it('returns false when navigator.gpu is undefined', () => {
    setNavigatorGpu(undefined)
    expect(supportsWebGPU()).toBe(false)
  })

  it('returns true when navigator.gpu exists', () => {
    setNavigatorGpu({ requestAdapter: () => null })
    expect(supportsWebGPU()).toBe(true)
  })
})
