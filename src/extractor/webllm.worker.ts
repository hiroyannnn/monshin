// Web Worker: WebLLM (MLC-AI) による推論を別スレッドで実行する。
// メインスレッドからのリクエストを受け取り、結果/進捗を postMessage で返す。

/// <reference lib="webworker" />

import * as webllm from '@mlc-ai/web-llm'
import { buildExtractionMessages, buildSummaryMessages } from './prompt'
import type { WorkerEvent, WorkerRequest } from './worker-protocol'

type MLCEngine = webllm.MLCEngine

const ctx = self as unknown as DedicatedWorkerGlobalScope

let engine: MLCEngine | null = null
let loadedModelId: string | null = null

function post(event: WorkerEvent) {
  ctx.postMessage(event)
}

function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function classifyError(e: unknown): 'oom' | 'load_failed' | 'inference_failed' | 'unknown' {
  const msg = toErrorMessage(e).toLowerCase()
  if (msg.includes('out of memory') || msg.includes('oom') || msg.includes('allocation')) {
    return 'oom'
  }
  if (msg.includes('load') || msg.includes('download')) return 'load_failed'
  return 'inference_failed'
}

async function handleLoad(modelId: string) {
  try {
    if (engine && loadedModelId === modelId) {
      post({ type: 'loaded' })
      return
    }
    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        post({
          type: 'progress',
          progress: {
            progress: typeof report.progress === 'number' ? report.progress : null,
            text: report.text ?? '',
          },
        })
      },
    })
    loadedModelId = modelId
    post({ type: 'loaded' })
  } catch (e) {
    post({ type: 'error', code: classifyError(e), message: toErrorMessage(e) })
  }
}

async function handleExtract(transcript: string, mode: 'fields' | 'summary') {
  if (!engine) {
    post({ type: 'error', code: 'inference_failed', message: 'モデルが未ロードです' })
    return
  }
  try {
    const messages =
      mode === 'fields' ? buildExtractionMessages(transcript) : buildSummaryMessages(transcript)

    // Qwen3 thinking を抑制 + 低温度。
    // response_format は WebLLM/XGrammar のバグ (CompileJSONSchema で
    // BindingError: Cannot pass non-string to std::string) を踏むため指定しない。
    // プロンプトで JSON 形式を明示し、parseExtractionResponse で緩く復元する。
    // stream: true でトークンを逐次送出し UI の進捗表示に利用する。
    const stream = await engine.chat.completions.create({
      messages,
      temperature: 0.1,
      max_tokens: mode === 'fields' ? 600 : 300,
      stream: true,
      extra_body: {
        enable_thinking: false,
      },
    })

    let content = ''
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        content += delta
        post({ type: 'stream_chunk', mode, delta })
      }
    }
    post({ type: 'result', raw: content })
  } catch (e) {
    post({ type: 'error', code: classifyError(e), message: toErrorMessage(e) })
  }
}

async function handleUnload() {
  try {
    await engine?.unload()
  } catch {
    // ignore
  }
  engine = null
  loadedModelId = null
  post({ type: 'unloaded' })
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  switch (req.type) {
    case 'load':
      void handleLoad(req.modelId)
      break
    case 'extract':
      void handleExtract(req.transcript, req.mode)
      break
    case 'unload':
      void handleUnload()
      break
  }
})
