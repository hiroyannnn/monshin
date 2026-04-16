import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest globals を無効化しているため手動で cleanup を登録する
afterEach(() => {
  cleanup()
})
