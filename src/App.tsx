import { useCallback, useMemo, useState } from 'react'
import {
  FIELD_DEFINITIONS,
  createEmptyForm,
  mergeFields,
  type MonshinFieldKey,
  type MonshinFields,
} from './domain/monshin'
import { useTranscriber } from './hooks/useTranscriber'
import { useExtractor } from './hooks/useExtractor'
import {
  AVAILABLE_MODELS,
  findModel,
  loadSelectedModelId,
  saveSelectedModelId,
} from './extractor/models'
import { styles, colors } from './styles'

const SAMPLE_TEXT =
  'えーと、山田太郎です。45歳、男性です。3日前くらいから頭が痛くて、昨日から38度くらいの熱も出てきました。痛みは結構ひどくて、寝てても辛いです。普段はロキソニンを飲んでいて、あと血圧の薬も飲んでます。アレルギーは花粉症があります。昔、高血圧って言われたことがあります。'

function App() {
  const [form, setForm] = useState<MonshinFields>(() => createEmptyForm())
  const [editingField, setEditingField] = useState<MonshinFieldKey | null>(null)
  const [status, setStatus] = useState('')
  const [modelId, setModelId] = useState<string>(() => loadSelectedModelId())

  const transcriber = useTranscriber()
  const extractor = useExtractor(modelId)
  const selectedModel = findModel(modelId)

  // 録音中は interim を finalText の末尾に連結して表示 (リアルタイムフィードバック)
  const displayedTranscript = transcriber.finalText + transcriber.interim
  const transcript = transcriber.finalText

  const isListening = transcriber.state === 'listening'
  const canExtract =
    extractor.state === 'ready' && transcript.trim().length > 0
  const isDownloading = extractor.state === 'downloading'
  const isInferencing = extractor.state === 'inferencing'

  const extractorReady = extractor.state === 'ready'
  const extractorUnsupported =
    extractor.state === 'unsupported' || !extractor.supported

  const flashStatus = useCallback((text: string, ms = 2500) => {
    setStatus(text)
    window.setTimeout(() => setStatus(''), ms)
  }, [])

  const handleToggleRecording = useCallback(() => {
    if (isListening) transcriber.stop()
    else transcriber.start()
  }, [isListening, transcriber])

  const handleLoadModel = useCallback(async () => {
    try {
      await extractor.load()
      flashStatus('✅ モデルのロードが完了しました')
    } catch {
      // エラーは extractor.error に反映されている
    }
  }, [extractor, flashStatus])

  const handleExtract = useCallback(async () => {
    if (!transcript.trim()) return
    try {
      const result = await extractor.extract(transcript)
      setForm((prev) => mergeFields(prev, result.fields))
      flashStatus('✅ フィールドの抽出が完了しました')
    } catch {
      // extractor.error に反映
    }
  }, [extractor, transcript, flashStatus])

  const handleLoadSample = useCallback(() => {
    transcriber.stop()
    transcriber.setFinalText(SAMPLE_TEXT)
    flashStatus('📋 サンプルテキストを読み込みました')
  }, [transcriber, flashStatus])

  const handleReset = useCallback(() => {
    transcriber.reset()
    setForm(createEmptyForm())
    setStatus('')
  }, [transcriber])

  const listeningMessage = useMemo(() => {
    if (isListening) return '🎙️ 録音中… 患者さんの症状を話してください'
    if (isInferencing) {
      const passLabel =
        extractor.stream.currentPass === 'summary'
          ? '2/2 要約を生成中'
          : '1/2 問診票を抽出中'
      const secs =
        extractor.stream.elapsedMs !== null
          ? ` · ${(extractor.stream.elapsedMs / 1000).toFixed(1)}秒経過`
          : ''
      return `🧠 ${passLabel}${secs}`
    }
    if (isDownloading) {
      const pct =
        extractor.progress?.progress !== null && extractor.progress?.progress !== undefined
          ? ` (${Math.round(extractor.progress.progress * 100)}%)`
          : ''
      return `⬇️ モデルをロード中…${pct}`
    }
    return status
  }, [
    isListening,
    isInferencing,
    isDownloading,
    extractor.progress,
    extractor.stream.currentPass,
    extractor.stream.elapsedMs,
    status,
  ])

  const error = transcriber.error?.message ?? extractor.error?.message ?? null

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logoArea}>
            <div style={styles.logoIcon}>問</div>
            <div>
              <h1 style={styles.title}>問診アシスタント</h1>
              <p style={styles.subtitle}>
                音声 → 文字起こし → ブラウザローカル AI で自動入力
              </p>
            </div>
          </div>
          <div style={styles.badge}>
            <span style={styles.badgeDot} />
            WebLLM · {selectedModel?.label ?? modelId}
          </div>
        </div>
      </header>

      <main style={styles.main}>
        {listeningMessage && <div style={styles.statusBar}>{listeningMessage}</div>}
        {isInferencing && extractor.stream.partialText && (
          <div style={styles.streamPreview}>
            <div style={styles.streamPreviewLabel}>
              {extractor.stream.currentPass === 'summary'
                ? '要約プレビュー'
                : 'フィールド抽出プレビュー'}
            </div>
            <pre style={styles.streamPreviewBody}>
              {extractor.stream.partialText}
              <span style={styles.streamCaret}>▊</span>
            </pre>
          </div>
        )}
        {isInferencing &&
          extractor.stream.elapsedMs !== null &&
          extractor.stream.elapsedMs > 30000 && (
            <div style={styles.warningBar}>
              ⏳ 30 秒以上経過しています。お使いの GPU の性能によっては 1〜2 分かかる場合があります。
              キャンセルしてテキストを短くするか、そのままお待ちください。
            </div>
          )}
        {error && <div style={styles.errorBar}>{error}</div>}
        {extractorUnsupported && (
          <div style={styles.warningBar}>
            ⚠️ お使いのブラウザは WebGPU 未対応のため、AI 自動入力は使えません。
            手動での入力は可能です。Chrome 113+ / Edge 113+ / Safari 18+ を推奨します。
          </div>
        )}

        {/* モデル選択 + ロードパネル */}
        {!extractorUnsupported && !extractorReady && (
          <section style={styles.modelPanel}>
            <div style={styles.modelPanelInfo}>
              <label style={styles.modelSelectLabel}>
                モデル
                <select
                  value={modelId}
                  onChange={(e) => {
                    setModelId(e.target.value)
                    saveSelectedModelId(e.target.value)
                  }}
                  disabled={isDownloading}
                  style={styles.modelSelect}
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.size} (日本語 {m.japanese})
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                {isDownloading ? (
                  <>
                    <strong style={{ color: colors.text }}>ロード中…</strong>{' '}
                    {extractor.progress?.text ?? ''}
                  </>
                ) : (
                  <>
                    {selectedModel?.note ?? ''} ·
                    初回は {selectedModel?.size ?? '約 1GB'} のダウンロード (キャッシュ有)
                  </>
                )}
              </div>
            </div>
            {isDownloading && (
              <div style={styles.progressBarOuter}>
                <div
                  style={{
                    ...styles.progressBarInner,
                    width: `${Math.round(
                      (extractor.progress?.progress ?? 0) * 100,
                    )}%`,
                  }}
                />
              </div>
            )}
            {!isDownloading ? (
              <button
                onClick={() => void handleLoadModel()}
                style={{ ...styles.btn, ...styles.btnPrimary, padding: '10px 16px' }}
              >
                🧠 モデルをロード
              </button>
            ) : (
              <button
                onClick={() => extractor.cancel()}
                style={{ ...styles.btn, ...styles.btnGhost, padding: '10px 16px' }}
              >
                キャンセル
              </button>
            )}
          </section>
        )}

        {/* コントロール */}
        <section style={styles.controlSection}>
          <div style={styles.controlGrid}>
            <button
              onClick={handleToggleRecording}
              disabled={!transcriber.supported}
              style={{
                ...styles.btn,
                ...(isListening ? styles.btnRecording : styles.btnPrimary),
                opacity: transcriber.supported ? 1 : 0.4,
              }}
            >
              <span style={styles.btnIcon}>{isListening ? '⏹' : '🎙️'}</span>
              <span>{isListening ? '録音停止' : '録音開始'}</span>
              {isListening && <span style={styles.pulse} />}
            </button>

            {isInferencing ? (
              <button
                onClick={() => extractor.cancel()}
                style={{ ...styles.btn, ...styles.btnRecording }}
              >
                <span style={styles.btnIcon}>⏹</span>
                <span>解析を中止</span>
              </button>
            ) : (
              <button
                onClick={() => void handleExtract()}
                disabled={!canExtract}
                style={{
                  ...styles.btn,
                  ...styles.btnAccent,
                  opacity: canExtract ? 1 : 0.5,
                }}
              >
                <span style={styles.btnIcon}>🧠</span>
                <span>AI 解析</span>
              </button>
            )}

            <button
              onClick={handleLoadSample}
              style={{ ...styles.btn, ...styles.btnGhost }}
            >
              <span style={styles.btnIcon}>📋</span>
              <span>サンプル</span>
            </button>

            <button onClick={handleReset} style={{ ...styles.btn, ...styles.btnGhost }}>
              <span style={styles.btnIcon}>🔄</span>
              <span>リセット</span>
            </button>
          </div>
        </section>

        {/* 文字起こし (常時表示・編集可) */}
        <section style={styles.transcriptSection}>
          <div style={styles.transcriptHeader}>
            <span style={styles.sectionTitle}>
              <span style={{ opacity: 0.6 }}>💬</span> 発話テキスト
              {isListening && (
                <span style={styles.liveBadge}>
                  <span style={styles.liveDot} /> LIVE
                </span>
              )}
            </span>
            {displayedTranscript && (
              <span style={styles.charCount}>
                {displayedTranscript.length}文字
              </span>
            )}
          </div>
          <textarea
            value={displayedTranscript}
            onChange={(e) => transcriber.setFinalText(e.target.value)}
            readOnly={isListening}
            placeholder={
              transcriber.supported
                ? '録音ボタンを押して話しかけるか、ここに直接入力してください'
                : 'お使いのブラウザは音声認識未対応です。ここに手動で入力してください'
            }
            style={{
              ...styles.transcriptTextarea,
              ...(isListening ? styles.transcriptTextareaRecording : {}),
            }}
            rows={6}
          />
        </section>

        {/* 問診票 */}
        <section style={styles.formSection}>
          <h2 style={styles.formTitle}>
            <span style={{ opacity: 0.6 }}>📄</span> 問診票
          </h2>
          <div style={styles.fieldGrid}>
            {FIELD_DEFINITIONS.map((field) => {
              const isEditing = editingField === field.key
              const value = form[field.key]
              const hasValue = value.length > 0
              const isSummary = field.key === 'summary'

              return (
                <div
                  key={field.key}
                  style={{
                    ...styles.fieldCard,
                    ...(isSummary ? styles.fieldCardFull : {}),
                    ...(hasValue ? styles.fieldCardFilled : {}),
                  }}
                  onClick={() => setEditingField(field.key)}
                >
                  <div style={styles.fieldHeader}>
                    <span style={styles.fieldIcon}>{field.icon}</span>
                    <span style={styles.fieldLabel}>{field.label}</span>
                    {hasValue && <span style={styles.filledDot} />}
                  </div>
                  {isEditing ? (
                    isSummary ? (
                      <textarea
                        autoFocus
                        value={value}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        onBlur={() => setEditingField(null)}
                        style={styles.fieldTextarea}
                        rows={3}
                      />
                    ) : (
                      <input
                        autoFocus
                        type="text"
                        value={value}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        onBlur={() => setEditingField(null)}
                        style={styles.fieldInput}
                      />
                    )
                  ) : (
                    <p style={hasValue ? styles.fieldValue : styles.fieldPlaceholder}>
                      {value || field.placeholder}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* アーキテクチャ説明 */}
        <section style={styles.archSection}>
          <h3 style={styles.archTitle}>アーキテクチャ</h3>
          <div style={styles.archFlow}>
            {[
              { icon: '🎙️', label: '音声入力', tech: 'Web Speech API', desc: 'ブラウザ内蔵' },
              { icon: '📝', label: '文字起こし', tech: 'SpeechRecognition', desc: 'リアルタイム' },
              { icon: '🧠', label: 'AI 解析', tech: 'WebLLM + Qwen3-1.7B', desc: 'WebGPU ローカル推論' },
              { icon: '📄', label: '問診票', tech: '自動入力', desc: '手動編集可' },
            ].map((step, i) => (
              <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={styles.archStep}>
                  <div style={styles.archStepIcon}>{step.icon}</div>
                  <div style={styles.archStepLabel}>{step.label}</div>
                  <div style={styles.archStepTech}>{step.tech}</div>
                  <div style={styles.archStepDesc}>{step.desc}</div>
                </div>
                {i < 3 && <div style={styles.archArrow}>→</div>}
              </div>
            ))}
          </div>
          <div style={styles.archNote}>
            <p style={{ margin: 0, fontWeight: 600, marginBottom: 4 }}>
              💡 完全ブラウザローカルで動作
            </p>
            <p style={{ margin: 0, opacity: 0.8, fontSize: 13, lineHeight: 1.6 }}>
              AI 解析は <code style={styles.code}>@mlc-ai/web-llm + Qwen3-1.7B</code>{' '}
              を WebGPU で実行。サーバへのデータ送信は行われません。
              初回の約 1GB のモデルダウンロード後はオフラインでも動作します。
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
