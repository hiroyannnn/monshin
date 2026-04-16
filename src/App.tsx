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
import { styles, colors } from './styles'

const SAMPLE_TEXT =
  'えーと、山田太郎です。45歳、男性です。3日前くらいから頭が痛くて、昨日から38度くらいの熱も出てきました。痛みは結構ひどくて、寝てても辛いです。普段はロキソニンを飲んでいて、あと血圧の薬も飲んでます。アレルギーは花粉症があります。昔、高血圧って言われたことがあります。'

function App() {
  const [form, setForm] = useState<MonshinFields>(() => createEmptyForm())
  const [editingField, setEditingField] = useState<MonshinFieldKey | null>(null)
  const [status, setStatus] = useState('')

  const transcriber = useTranscriber()
  const extractor = useExtractor()

  const displayedTranscript = transcriber.finalText + transcriber.interim
  const transcript = transcriber.finalText

  const isListening = transcriber.state === 'listening'
  const canExtract = extractor.state === 'ready' && transcript.trim().length > 0
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
      flashStatus('モデルのロードが完了しました')
    } catch {
      // extractor.error に反映
    }
  }, [extractor, flashStatus])

  const handleExtract = useCallback(async () => {
    if (!transcript.trim()) return
    try {
      const result = await extractor.extract(transcript)
      setForm((prev) => mergeFields(prev, result.fields))
      flashStatus('フィールドの抽出が完了しました')
    } catch {
      // extractor.error に反映
    }
  }, [extractor, transcript, flashStatus])

  const handleLoadSample = useCallback(() => {
    transcriber.stop()
    transcriber.setFinalText(SAMPLE_TEXT)
    flashStatus('サンプルテキストを読み込みました')
  }, [transcriber, flashStatus])

  const handleReset = useCallback(() => {
    transcriber.reset()
    setForm(createEmptyForm())
    setStatus('')
  }, [transcriber])

  const listeningMessage = useMemo(() => {
    if (isListening) return '録音中 — 患者さんの症状を話してください'
    if (isInferencing) return 'AI が問診内容を解析中…'
    if (isDownloading) {
      const pct =
        extractor.progress?.progress != null
          ? ` (${Math.round(extractor.progress.progress * 100)}%)`
          : ''
      return `モデルをロード中…${pct}`
    }
    return status
  }, [isListening, isInferencing, isDownloading, extractor.progress, status])

  const error = transcriber.error?.message ?? extractor.error?.message ?? null

  const filledCount = Object.values(form).filter((v) => v.length > 0).length

  return (
    <div style={styles.container}>
      {/* ── Header ── */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logoArea}>
            <div style={styles.logoIcon}>問</div>
            <div style={styles.logoDivider} />
            <h1 style={styles.title}>問診アシスタント</h1>
          </div>
          <div style={styles.badge}>
            <span style={styles.badgeDot} />
            WebLLM · Qwen3-1.7B
          </div>
        </div>
      </header>

      {/* ── 2-col main ── */}
      <main style={styles.main}>
        {/* ── Left: controls + transcript ── */}
        <div style={styles.leftCol}>
          {/* Status / error / warning banners */}
          {listeningMessage && (
            <div style={styles.statusBar}>{listeningMessage}</div>
          )}
          {error && <div style={styles.errorBar}>{error}</div>}
          {extractorUnsupported && (
            <div style={styles.warningBar}>
              WebGPU 未対応のため AI 解析は使えません。Chrome 113+ / Edge 113+ / Safari 18+ を推奨します。手動入力は可能です。
            </div>
          )}

          {/* モデルロードパネル */}
          {!extractorUnsupported && !extractorReady && (
            <div style={styles.modelPanel}>
              <div style={{ fontSize: 12, flex: 1, color: colors.text }}>
                {isDownloading ? (
                  <>
                    <span style={{ fontWeight: 600 }}>モデルロード中</span>
                    <span style={{ color: colors.textMuted, marginLeft: 8 }}>
                      {extractor.progress?.text ?? '初回は約 1GB が必要'}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 600 }}>AI 自動入力</span>
                    <span style={{ color: colors.textMuted, marginLeft: 8 }}>
                      初回のみ約 1GB をダウンロード（以降はキャッシュ）
                    </span>
                  </>
                )}
              </div>
              {isDownloading && (
                <div style={styles.progressBarOuter}>
                  <div
                    style={{
                      ...styles.progressBarInner,
                      width: `${Math.round((extractor.progress?.progress ?? 0) * 100)}%`,
                    }}
                  />
                </div>
              )}
              {!isDownloading ? (
                <button
                  onClick={() => void handleLoadModel()}
                  style={{ ...styles.btn, ...styles.btnPrimary }}
                >
                  モデルをロード
                </button>
              ) : (
                <button
                  onClick={() => extractor.cancel()}
                  style={{ ...styles.btn, ...styles.btnGhost }}
                >
                  キャンセル
                </button>
              )}
            </div>
          )}

          {/* コントロール */}
          <div style={styles.controlGrid}>
            <button
              onClick={handleToggleRecording}
              disabled={!transcriber.supported}
              style={{
                ...styles.btn,
                ...(isListening ? styles.btnRecording : styles.btnPrimary),
                opacity: transcriber.supported ? 1 : 0.35,
              }}
            >
              <RecordIcon isRecording={isListening} />
              {isListening ? '停止' : '録音'}
              {isListening && <span style={styles.pulse} />}
            </button>

            <button
              onClick={() => void handleExtract()}
              disabled={!canExtract || isInferencing}
              style={{
                ...styles.btn,
                ...styles.btnAccent,
                opacity: canExtract && !isInferencing ? 1 : 0.4,
              }}
            >
              <SparkIcon />
              {isInferencing ? '解析中…' : 'AI 解析'}
            </button>

            <button
              onClick={handleLoadSample}
              style={{ ...styles.btn, ...styles.btnGhost }}
            >
              サンプル
            </button>

            <button
              onClick={handleReset}
              style={{ ...styles.btn, ...styles.btnGhost }}
            >
              リセット
            </button>
          </div>

          {/* 文字起こし */}
          <div style={styles.transcriptSection}>
            <div style={styles.transcriptHeader}>
              <span style={styles.sectionTitle}>
                transcript
                {isListening && (
                  <span style={styles.liveBadge}>
                    <span style={styles.liveDot} />
                    LIVE
                  </span>
                )}
              </span>
              {displayedTranscript && (
                <span style={styles.charCount}>
                  {displayedTranscript.length} chars
                </span>
              )}
            </div>
            <div style={{ padding: '0 14px 2px' }}>
              <textarea
                value={displayedTranscript}
                onChange={(e) => transcriber.setFinalText(e.target.value)}
                readOnly={isListening}
                placeholder={
                  transcriber.supported
                    ? '録音ボタンを押して話しかけるか、ここに直接テキストを入力'
                    : '音声認識未対応。ここに手動で入力してください'
                }
                style={{
                  ...styles.transcriptTextarea,
                  ...(isListening
                    ? {
                        borderLeft: `2px solid ${colors.recording}`,
                        paddingLeft: 10,
                      }
                    : {}),
                }}
                rows={8}
              />
            </div>
          </div>

          {/* アーキテクチャ */}
          <div style={styles.archSection}>
            <h3 style={styles.archTitle}>アーキテクチャ</h3>
            <div style={styles.archFlow}>
              {[
                { icon: 'MIC', label: '音声入力', tech: 'Web Speech API', desc: 'ブラウザ内蔵' },
                { icon: 'TXT', label: '文字起こし', tech: 'SpeechRecognition', desc: 'リアルタイム' },
                { icon: 'AI', label: 'AI 解析', tech: 'WebLLM · Qwen3', desc: 'WebGPU' },
                { icon: 'FRM', label: '問診票', tech: '自動入力', desc: '手動編集可' },
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
              <span style={{ color: colors.text, fontWeight: 500 }}>完全ブラウザローカル。</span>
              {' '}
              <code style={styles.code}>@mlc-ai/web-llm</code> + <code style={styles.code}>Qwen3-1.7B</code> を WebGPU で実行。サーバへのデータ送信なし。
            </div>
          </div>
        </div>

        {/* ── Right: form ── */}
        <div style={styles.rightCol}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 2,
            }}
          >
            <h2 style={{ ...styles.formTitle, marginBottom: 0 }}>問診票</h2>
            <span
              style={{
                fontSize: 10,
                color: filledCount > 0 ? colors.accent : colors.textMuted,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {filledCount} / {FIELD_DEFINITIONS.length} 項目
            </span>
          </div>

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
                  {/* Label col */}
                  <div style={styles.fieldHeader}>
                    <span style={styles.fieldLabel}>{field.label}</span>
                    {hasValue && <span style={styles.filledDot} />}
                  </div>

                  {/* Value col */}
                  {isEditing ? (
                    isSummary ? (
                      <textarea
                        autoFocus
                        value={value}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        onBlur={() => setEditingField(null)}
                        style={{ ...styles.fieldTextarea, width: '100%' }}
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
        </div>
      </main>
    </div>
  )
}

// ── Inline SVG icons ──────────────────────────────────────────

function RecordIcon({ isRecording }: { isRecording: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="currentColor"
      style={{ flexShrink: 0 }}
    >
      {isRecording ? (
        <rect x="2" y="2" width="8" height="8" rx="1" />
      ) : (
        <circle cx="6" cy="6" r="4" />
      )}
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ flexShrink: 0 }}
    >
      <path d="M6 1 L7 5 L11 6 L7 7 L6 11 L5 7 L1 6 L5 5 Z" />
    </svg>
  )
}

export default App
