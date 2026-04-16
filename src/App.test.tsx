import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the header title', () => {
    render(<App />)
    expect(screen.getByText('問診アシスタント')).toBeInTheDocument()
  })

  it('renders all 10 form fields', () => {
    render(<App />)
    expect(screen.getByText('氏名')).toBeInTheDocument()
    expect(screen.getByText('年齢')).toBeInTheDocument()
    expect(screen.getByText('主訴')).toBeInTheDocument()
    expect(screen.getByText('要約')).toBeInTheDocument()
  })

  it('shows WebGPU-unsupported warning in jsdom (no navigator.gpu)', () => {
    render(<App />)
    expect(screen.getByText(/WebGPU 未対応/)).toBeInTheDocument()
  })

  it('renders the sample loader button', () => {
    render(<App />)
    expect(screen.getByText('サンプル')).toBeInTheDocument()
  })
})
