// WebGPU サポート判定 (軽量、同期)。実際のアダプタ取得は load() で行う。

interface MaybeGpuNavigator {
  gpu?: unknown
}

export function supportsWebGPU(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as unknown as MaybeGpuNavigator
  return nav.gpu !== undefined && nav.gpu !== null
}
