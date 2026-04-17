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

// 進捗集約: Transformers.js は file ごとに progress_callback が高頻度で発火する。
// ファイル単位に loaded/total を積算し、100ms に一度だけメインへ post することで
// UI の再レンダリング回数を抑え、ロード中のがたつきを防ぐ。
type FileProgress = { loaded: number; total: number };
const fileProgress = new Map<string, FileProgress>();
let lastProgressPost = 0;
let pendingProgressTimer: ReturnType<typeof setTimeout> | null = null;

const PROGRESS_THROTTLE_MS = 120;

function aggregateProgress(): number | null {
  let loaded = 0;
  let total = 0;
  for (const f of fileProgress.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  if (total <= 0) return null;
  return Math.min(1, loaded / total);
}

function postAggregatedProgress() {
  pendingProgressTimer = null;
  lastProgressPost = performance.now();
  const progress = aggregateProgress();
  post({
    type: "progress",
    progress: {
      progress,
      text: "モデルをダウンロード中…",
    },
  });
}

function scheduleProgressPost() {
  if (pendingProgressTimer !== null) return;
  const elapsed = performance.now() - lastProgressPost;
  const delay = Math.max(0, PROGRESS_THROTTLE_MS - elapsed);
  pendingProgressTimer = setTimeout(postAggregatedProgress, delay);
}

function resetProgressState() {
  fileProgress.clear();
  lastProgressPost = 0;
  if (pendingProgressTimer !== null) {
    clearTimeout(pendingProgressTimer);
    pendingProgressTimer = null;
  }
}

function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// エラー発生箇所 (load / inference) を明示的に受け取って分類する。
// keyword マッチだと inference 中の fetch/load 系メッセージが load_failed に誤分類されるため、
// OOM のみ優先判定しそれ以外は phase で決め打ちする。
function classifyError(e: unknown, phase: "load" | "inference"): "oom" | "load_failed" | "inference_failed" {
  const msg = toErrorMessage(e).toLowerCase();
  if (msg.includes("out of memory") || msg.includes("oom") || msg.includes("allocation")) {
    return "oom";
  }
  return phase === "load" ? "load_failed" : "inference_failed";
}

async function handleLoad(modelId: string) {
  try {
    if (generator && loadedModelId === modelId) {
      post({ type: "loaded" });
      return;
    }
    resetProgressState();
    const task: PipelineType = "text-generation";
    generator = (await pipeline(task, modelId, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: (data: unknown) => {
        // Transformers.js の進捗ペイロードは { status, progress, name, file, loaded, total, ... }
        const rec = (data as Record<string, unknown>) ?? {};
        const status = typeof rec.status === "string" ? rec.status : "";
        const file = typeof rec.file === "string" ? rec.file : "";
        const loaded = typeof rec.loaded === "number" ? rec.loaded : 0;
        const total = typeof rec.total === "number" ? rec.total : 0;
        if (file && total > 0) {
          if (status === "done") {
            fileProgress.set(file, { loaded: total, total });
          } else {
            fileProgress.set(file, { loaded, total });
          }
        }
        scheduleProgressPost();
      },
    })) as TextGenerationPipeline;
    // 残った throttle を吐き切って 100% を確実に送る
    postAggregatedProgress();
    loadedModelId = modelId;
    post({ type: "loaded" });
  } catch (e) {
    post({ type: "error", code: classifyError(e, "load"), message: toErrorMessage(e) });
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

    // do_sample: false で greedy デコード。temperature は greedy 時は無効かつ警告対象なので指定しない。
    const output = await generator(messages, {
      max_new_tokens: mode === "fields" ? 600 : 300,
      do_sample: false,
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
    post({ type: "error", code: classifyError(e, "inference"), message: toErrorMessage(e) });
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
