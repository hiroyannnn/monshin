# 問診アシスタント実装 TODO

音声入力 → 文字起こし → WebLLM(Qwen3-1.7B) で問診票自動入力、Vercel デプロイ。

## タスク

- [x] 1. プロジェクト初期セットアップ (Vite+ + React + TS + Vitest)
- [ ] 2. ドメイン型定義 (MonshinFields / FIELD_DEFINITIONS)
- [ ] 3. Transcriber抽象 + WebSpeechAPI実装
- [ ] 4. Extractor抽象 + WebLLM実装 (Worker分離, 2パス抽出)
- [ ] 5. WebGPUサポート判定 + フォールバック
- [ ] 6. モデルロードUI (進捗表示、明示的開始)
- [ ] 7. 問診票UI移植 (JSX→TSX)
- [ ] 8. 録音ボタン・文字起こし連携
- [ ] 9. AI抽出ボタン・2パス抽出連携
- [ ] 10. Vercelデプロイ設定 (vercel.json, SPA rewrite)
- [ ] 11. README & 動作確認 & デプロイ

## 設計方針 (codex 相談結果のサマリ)

- **Vite+**: alpha なので `vite.config.ts` は通常の Vite と互換を保つ
- **WebLLM**: Dedicated Web Worker で分離、明示的 `load()` ボタン、キャンセルは Worker kill
- **状態マシン**: `unsupported / idle / downloading / ready / inferencing / failed / oom`
- **Qwen3-1.7B**: `enable_thinking: false`、`response_format` (JSON mode)、temperature 0-0.2
- **2パス抽出**: 9 フィールド抽出 → `summary` 生成
- **抽象化**: `Transcriber` / `Extractor` に `supports()` + `load/start/stop/dispose`
- **Vercel**: COOP/COEP 不要、SPA rewrite のみ。モデル配信は HuggingFace CDN
