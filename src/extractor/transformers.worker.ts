// Web Worker: Transformers.js (Hugging Face) による推論を別スレッドで実行する。
// メインスレッドからのリクエストを受け取り、結果/進捗を postMessage で返す。

/// <reference lib="webworker" />

import {
  pipeline,
  TextStreamer,
  type PipelineType,
  type TextGenerationPipeline,
} from "@huggingface/transformers";
import { buildExtractionMessages, buildSummaryMessages } from "./prompt";
import type { WorkerEvent, WorkerRequest } from "./worker-protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let generator: TextGenerationPipeline | null = null;
let loadedModelId: string | null = null;

function post(event: WorkerEvent) {
  ctx.postMessage(event);
}

function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function classifyError(e: unknown): "oom" | "load_failed" | "inference_failed" | "unknown" {
  const msg = toErrorMessage(e).toLowerCase();
  if (msg.includes("out of memory") || msg.includes("oom") || msg.includes("allocation")) {
    return "oom";
  }
  if (msg.includes("load") || msg.includes("download") || msg.includes("fetch"))
    return "load_failed";
  return "inference_failed";
}

async function handleLoad(modelId: string) {
  try {
    if (generator && loadedModelId === modelId) {
      post({ type: "loaded" });
      return;
    }
    const task: PipelineType = "text-generation";
    generator = (await pipeline(task, modelId, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: (data: unknown) => {
        // Transformers.js の進捗ペイロードは { status, progress, name, file, ... }
        const rec = (data as Record<string, unknown>) ?? {};
        const status = typeof rec.status === "string" ? rec.status : "";
        const file = typeof rec.file === "string" ? rec.file : "";
        const raw = rec.progress;
        const progress = typeof raw === "number" && Number.isFinite(raw) ? raw / 100 : null;
        post({
          type: "progress",
          progress: {
            progress,
            text: file ? `${status} ${file}` : status,
          },
        });
      },
    })) as TextGenerationPipeline;
    loadedModelId = modelId;
    post({ type: "loaded" });
  } catch (e) {
    post({ type: "error", code: classifyError(e), message: toErrorMessage(e) });
  }
}

async function handleExtract(transcript: string, mode: "fields" | "summary") {
  if (!generator) {
    post({ type: "error", code: "inference_failed", message: "モデルが未ロードです" });
    return;
  }
  try {
    const messages =
      mode === "fields" ? buildExtractionMessages(transcript) : buildSummaryMessages(transcript);

    // トークン逐次送出用ストリーマー。UI の進捗表示に利用する。
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        if (text) post({ type: "stream_chunk", mode, delta: text });
      },
    });

    const output = await generator(messages, {
      max_new_tokens: mode === "fields" ? 600 : 300,
      do_sample: false,
      temperature: 0.1,
      streamer,
    });

    // generator は配列を返す。最後のメッセージ (assistant) の content を取得。
    let content = "";
    const first = Array.isArray(output) ? output[0] : output;
    const generated = (first as Record<string, unknown>)?.generated_text;
    if (Array.isArray(generated)) {
      const last = generated[generated.length - 1] as Record<string, unknown> | undefined;
      if (last && typeof last.content === "string") content = last.content;
    } else if (typeof generated === "string") {
      content = generated;
    }

    post({ type: "result", raw: content });
  } catch (e) {
    post({ type: "error", code: classifyError(e), message: toErrorMessage(e) });
  }
}

async function handleUnload() {
  try {
    await generator?.dispose();
  } catch {
    // ignore
  }
  generator = null;
  loadedModelId = null;
  post({ type: "unloaded" });
}

ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  switch (req.type) {
    case "load":
      void handleLoad(req.modelId);
      break;
    case "extract":
      void handleExtract(req.transcript, req.mode);
      break;
    case "unload":
      void handleUnload();
      break;
  }
});
