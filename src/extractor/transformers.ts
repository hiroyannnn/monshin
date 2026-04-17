// Transformers.js (Hugging Face) ベースの Extractor。
// Worker 分離で WebGPU 推論を実行する。

import { supportsWebGPU } from "./webgpu";
import { DEFAULT_MODEL_ID } from "./models";
import { parseExtractionResponse, stripThinkTags } from "./prompt";
import type {
  Extractor,
  ExtractorError,
  ExtractorListeners,
  ExtractorState,
  ExtractionResult,
} from "./types";
import type { WorkerEvent, WorkerRequest } from "./worker-protocol";
import type { MonshinFields } from "../domain/monshin";

export interface TransformersExtractorOptions {
  modelId?: string;
  createWorker?: () => Worker;
}

function defaultCreateWorker(): Worker {
  return new Worker(new URL("./transformers.worker.ts", import.meta.url), {
    type: "module",
  });
}

type PendingRequest =
  | { kind: "load"; resolve: () => void; reject: (err: Error) => void }
  | { kind: "extract"; resolve: (raw: string) => void; reject: (err: Error) => void }
  | { kind: "unload"; resolve: () => void; reject: (err: Error) => void };

export function createTransformersExtractor(options: TransformersExtractorOptions = {}): Extractor {
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const createWorker = options.createWorker ?? defaultCreateWorker;

  let listeners: ExtractorListeners = {};
  let worker: Worker | null = null;
  let pending: PendingRequest | null = null;
  let state: ExtractorState = supportsWebGPU() ? "idle" : "unsupported";

  // pending は単一スロットなので、前の Promise を必ず settle させてから差替える。
  // これを怠ると呼び出し側の await が永久に保留する。
  function setPending(next: PendingRequest) {
    if (pending) {
      pending.reject(new Error("superseded by another extractor request"));
    }
    pending = next;
  }

  function setState(next: ExtractorState) {
    if (state === next) return;
    state = next;
    listeners.onStateChange?.(next);
  }

  function emitError(err: ExtractorError) {
    listeners.onError?.(err);
  }

  function ensureWorker(): Worker {
    if (!worker) {
      worker = createWorker();
      worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
        handleWorkerEvent(ev.data);
      };
      worker.onerror = () => {
        // message-based "error" 経路 (handleWorkerEvent) と挙動を揃え、
        // state も failed に遷移させることで後続 extract() のガードが効くようにする。
        failPending("inference_failed", "Worker runtime error");
        setState("failed");
      };
    }
    return worker;
  }

  function send(req: WorkerRequest) {
    const w = ensureWorker();
    w.postMessage(req);
  }

  function failPending(code: ExtractorError["code"], message: string) {
    const p = pending;
    pending = null;
    const err = new Error(message);
    if (p) p.reject(err);
    emitError({ code, message });
  }

  function handleWorkerEvent(event: WorkerEvent) {
    switch (event.type) {
      case "progress":
        listeners.onProgress?.(event.progress);
        return;
      case "stream_chunk":
        listeners.onStreamChunk?.(event.mode, event.delta);
        return;
      case "loaded": {
        const p = pending;
        pending = null;
        if (p?.kind === "load") {
          setState("ready");
          p.resolve();
        }
        return;
      }
      case "result": {
        const p = pending;
        pending = null;
        if (p?.kind === "extract") p.resolve(event.raw);
        return;
      }
      case "unloaded": {
        const p = pending;
        pending = null;
        setState("idle");
        if (p?.kind === "unload") p.resolve();
        return;
      }
      case "error": {
        const p = pending;
        pending = null;
        const err = new Error(event.message);
        if (event.code === "oom") setState("oom");
        else setState("failed");
        if (p) p.reject(err);
        emitError({ code: event.code, message: event.message });
        return;
      }
    }
  }

  async function loadImpl(): Promise<void> {
    if (!supportsWebGPU()) {
      const err: ExtractorError = { code: "unsupported", message: "WebGPU 未対応のブラウザです" };
      emitError(err);
      throw new Error(err.message);
    }
    if (state === "ready") return;
    setState("downloading");
    return new Promise<void>((resolve, reject) => {
      setPending({ kind: "load", resolve, reject });
      send({ type: "load", modelId });
    });
  }

  function extractSingle(text: string, mode: "fields" | "summary"): Promise<string> {
    listeners.onPassStart?.(mode);
    return new Promise<string>((resolve, reject) => {
      setPending({ kind: "extract", resolve, reject });
      send({ type: "extract", transcript: text, mode });
    });
  }

  async function extractImpl(text: string): Promise<ExtractionResult> {
    if (state !== "ready" && state !== "inferencing") {
      throw new Error(`Extractor が ready ではありません (state=${state})`);
    }
    setState("inferencing");

    // fields パスは必須。worker error / cancel 経路では handleWorkerEvent /
    // cancelImpl が既に state を failed / oom / idle に遷移させているので
    // ここでは追加の state 変更はしない。
    const fieldsRaw = await extractSingle(text, "fields");

    // parseExtractionResponse はメインスレッドで throw する可能性がある
    // (モデルが JSON 以外を返した場合等)。state がリセットされず永久に
    // inferencing になるのを防ぐ。
    let parsed: ReturnType<typeof parseExtractionResponse>;
    try {
      parsed = parseExtractionResponse(fieldsRaw);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState("failed");
      emitError({ code: "inference_failed", message: `JSON パース失敗: ${message}` });
      throw e;
    }
    const fields: Partial<MonshinFields> = { ...parsed.fields };

    try {
      const summaryRaw = await extractSingle(text, "summary");
      const summary = stripThinkTags(summaryRaw);
      if (summary.length > 0) fields.summary = summary;
    } catch {
      // summary は任意成功。worker error や cancel で state が
      // failed / oom / idle に遷移している場合はそれを尊重し上書きしない。
    }

    // inferencing のまま抜けてきた (summary も成功、もしくはローカル失敗のみ) 場合だけ ready に戻す。
    if (state === "inferencing") setState("ready");
    return { fields, rawJson: parsed.rawJson };
  }

  function cancelImpl() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    const p = pending;
    pending = null;
    if (p) p.reject(new Error("cancelled"));
    setState("idle");
  }

  async function unloadImpl(): Promise<void> {
    if (!worker) {
      setState("idle");
      return;
    }
    return new Promise<void>((resolve, reject) => {
      setPending({ kind: "unload", resolve, reject });
      send({ type: "unload" });
    });
  }

  function disposeImpl() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    pending = null;
    listeners = {};
    setState("disposed");
  }

  return {
    get state() {
      return state;
    },
    supports() {
      return supportsWebGPU();
    },
    setListeners(next) {
      listeners = { ...next };
    },
    load: loadImpl,
    extract: extractImpl,
    cancel: cancelImpl,
    unload: unloadImpl,
    dispose: disposeImpl,
  };
}
