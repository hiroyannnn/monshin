# Spike: Transformers.js v4 への移行検討

issue: #8
branch: `spike/transformers-js-v4`
date: 2026-04-17

## 背景

`@mlc-ai/web-llm@0.2.82` (2026-03-13) は 2026 年リリースのモデル（Qwen3.5 / Gemma 4 / Qwen3-Coder-Next）に未対応。
**Transformers.js v4** (2026-02 リリース) は Qwen3.5 / Qwen3-VL / Qwen3.5-MoE 対応済み。

## 実装

- `src/extractor/transformers.ts` / `transformers.worker.ts` を新設
- 既存 `Extractor` インターフェースを満たすので UI 側の変更は最小
- `useExtractor` に `?extractor=transformers` クエリでの切替を仕込み WebLLM と並走

## PoC 結果（`onnx-community/Qwen3.5-0.8B-ONNX`, WebGPU）

Chrome 147 + macOS でサンプル発話（135 文字）を抽出した結果:

| 項目 | 結果 |
|---|---|
| モデルロード | ✅ 成功 (進捗 onProgress → UI 伝搬) |
| WebGPU 使用 | ✅ `device: 'webgpu'` で起動 |
| ストリーミング | ✅ TextStreamer → `stream_chunk` → UI 逐次表示 |
| fields 抽出 9/9 埋まる | ✅ |
| fields 内容の妥当性 | 8 良 / 1 要調整（重症度が「軽度」と過小評価） |
| `<think>` タグ漏れ | 観測なし（Qwen3.5-0.8B は thinking デフォルト off） |
| 要約パスの形式遵守 | ❌ JSON で返してしまう（0.8B の指示追従が弱い） |

抽出結果の一例:

| フィールド | 抽出値 |
|---|---|
| 氏名 | 山田太郎 |
| 年齢 | 45歳 |
| 性別 | 男性 |
| 主訴 | 頭が痛くて、熱が出ます |
| 発症時期 | 3日前から |
| 服用中の薬 | ロキソニン、血圧薬 |
| アレルギー | 花粉症 |
| 既往歴 | 高血圧の経験があります |

## API 差分

| 項目 | WebLLM | Transformers.js v4 |
|---|---|---|
| エンジン生成 | `CreateMLCEngine(modelId, { initProgressCallback })` | `pipeline('text-generation', modelId, { device, dtype, progress_callback })` |
| 推論呼出 | `engine.chat.completions.create({ messages, stream: true })` | `generator(messages, { max_new_tokens, streamer })` |
| ストリーム | AsyncIterable の `for await` | `TextStreamer` の `callback_function` |
| 応答取得 | `chunk.choices[0].delta.content` | `output[0].generated_text` (最後の assistant メッセージ) |
| JSON mode | XGrammar（不安定。以前バグ回避のため無効化） | **無し**（プロンプト + 後処理 or LogitsProcessor） |
| アンロード | `engine.unload()` | `generator.dispose()` |
| モデル配布 | MLC 独自（prebuilt config） | HuggingFace Hub（ONNX 変換済）|
| 量子化 | q4f16_1 等 MLC 形式 | q4 / q4f16 / fp16 / q8 / fp32 |

## サイズ比較（production build）

| 成果物 | Transformers.js | WebLLM |
|---|---|---|
| worker JS | **522 KB** | 5,988 KB |
| WebGPU ランタイム | ort-wasm-simd-threaded.asyncify.wasm **23.5 MB** (gzip 5.8 MB) ※CDN ロード | worker に内包 |
| 初回モデル DL（Q4） | 約 1.3 GB（Qwen3.5-0.8B）| 約 1 GB（Qwen3-1.7B） |

## Go/No-Go 判断

### ✅ Go 側の材料

- **2026 年モデルが使える**: Qwen3.5 / 将来の Qwen4 / Gemma 4 も対応予定
- **worker JS が 1/11**: 将来 WebLLM を削れば JS サイズ大幅削減
- **ONNX Runtime WASM は CDN 共有キャッシュ**: 複数サイト訪問で効く
- **HuggingFace Hub 直 DL**: prebuilt config 待ちが不要
- **API 差分は小さい**: 既存 `Extractor` 抽象がきれいに効く

### ⚠️ 懸念材料

- **JSON mode が無い**: XGrammar 相当は未整備。プロンプト + `parseExtractionResponse` 依存のまま
  - ただ WebLLM 版も XGrammar バグで結局プロンプト依存なので実質イーブン
- **要約パスの指示追従が 0.8B だと弱い**: Qwen3-4B / Qwen3.5-4B（ONNX 版が出れば）で要再検証
- **モデル DL サイズは若干大きい**: MLC 形式が q4f16_1 で最適化されているため
- **ONNX ランタイム WASM 追加**: 初回 23.5 MB (gzip 5.8 MB) が上乗せ
- **Safari 対応**: WebGPU 配布は 2025-11 だが ort-web の Safari 安定性は未検証

### 推奨

**Go。ただし段階移行**:

1. **Phase 1**: このスパイク PR（spike/transformers-js-v4）を feature flag 付きで merge
2. **Phase 2**: モデルラインナップに Transformers.js 経由の Qwen3.5 / Qwen3 を追加（UI で切替可能に）
3. **Phase 3**: 1〜2 週のドッグフーディングで問題なければ Transformers.js をデフォルトに
4. **Phase 4**: 問題なく稼働したら WebLLM 依存を削除（JS バンドル 5.5 MB 削減）

## 次ステップ（新 issue 候補）

- [ ] Qwen3.5-4B ONNX が `onnx-community` に公開されたら要約品質を再検証
- [ ] LogitsProcessor ベースの JSON 制約生成を試す（構造化出力の精度向上）
- [ ] Safari / iOS Safari での動作確認
- [ ] 既存 `AVAILABLE_MODELS` に Transformers.js 系 ID を併記（UI で切替）
- [ ] `@huggingface/transformers` の caching 戦略（OPFS / Cache API）を確認
