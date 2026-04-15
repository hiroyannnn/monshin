# 問診アシスタント (monshin-assistant)

音声入力 → ブラウザローカル AI (WebLLM + Qwen3-1.7B) で問診票を自動入力する Web アプリ。

- **フロント**: React 19 + TypeScript + Vite+
- **音声認識**: Web Speech API (将来 Transformers.js + Whisper に差し替え可能な設計)
- **AI 抽出**: @mlc-ai/web-llm + Qwen3-1.7B (WebGPU、完全ブラウザローカル推論)
- **デプロイ**: Vercel

## セットアップ

```bash
# Vite+ CLI (vp) の導入 (初回のみ)
curl -fsSL https://vite.plus | bash
source ~/.zshrc

# 依存インストール
vp install

# 開発サーバ
pnpm dev

# テスト
pnpm test

# ビルド
pnpm build
```

## 動作要件

- **WebGPU 対応ブラウザ** (Chrome 113+, Edge 113+, Safari 18+)
- 初回は Qwen3-1.7B モデル (~1GB) をダウンロード
- Web Speech API 対応ブラウザ (Chrome 推奨)

## Acknowledgments

- [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) — Apache 2.0
- [Qwen3](https://github.com/QwenLM/Qwen3) — Apache 2.0
- [Vite+](https://viteplus.dev/) — MIT
