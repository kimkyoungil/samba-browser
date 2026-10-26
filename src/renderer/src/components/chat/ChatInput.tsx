import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, FileText, Square, X } from 'lucide-react'
import { useChatStore } from '@renderer/stores/chatStore'
import { filesOf, readDroppedFile } from '@renderer/lib/drop-file'
import {
  addToHistory,
  draftCursor,
  loadInputHistory,
  saveInputHistory,
  stepHistory,
  type HistoryCursor
} from '@renderer/lib/input-history'
import { draftOnQuit, loadDraft, saveDraft } from '@renderer/lib/input-draft'
import { AGENT_IMAGE_MAX_COUNT, agentImageDataUrl, type AgentImage } from '@shared/agent-image'
import {
  AGENT_FILE_MAX_COUNT,
  AGENT_TEXT_FILES_TOTAL_MAX_CHARS,
  type AgentFile
} from '@shared/agent-file'
import { PermissionMenu } from './PermissionMenu'
import { ModelEffortMenu } from './ModelEffortMenu'
import { EngineMenu } from './EngineMenu'
import { UsageRing } from './UsageRing'

// 입력칸이 글에 맞춰 늘어나는 최대 높이(px). 넘으면 칸 안에서 스크롤한다
const INPUT_MAX_HEIGHT = 200

export function ChatInput(): React.JSX.Element {
  const { t } = useTranslation()
  const { send, status, stop, queue, unqueue, injecting, sendWhileRunning, engine } = useChatStore()
  const runChatId = useChatStore((s) => s.runChatId)
  const activeChatId = useChatStore((s) => s.activeChatId)
  // 이 대화가 일하는 중인가. 다른 대화가 일하는 중이면 보낸 말은 그 일이 끝난 뒤 이 대화에서 돈다(대기)
  const running = status === 'running' && runChatId === activeChatId
  const busyElsewhere = status === 'running' && !running
  // Claude 대화는 일하는 중 보낸 말을 바로 끼워 넣고, Codex 는 끝난 뒤 이어서 보낸다(대기열)
  const canInject = engine === 'claude'
  // 쓰다 만 글은 앱을 껐다 켜도 남는다(이 화면의 저장소에 둔다)
  const [text, setText] = useState(loadDraft)
  // 클립보드에서 붙여 넣거나 끌어다 놓은 이미지. 보내면 비운다
  const [images, setImages] = useState<AgentImage[]>([])
  // 붙여 넣거나 끌어다 놓은 파일(PDF·글 파일). 보내면 비운다
  const [files, setFiles] = useState<AgentFile[]>([])
  const [note, setNote] = useState('')
  // 보낸 문장 이력 — ↑/↓ 로 다시 꺼낸다(터미널과 같은 동작)
  const [history, setHistory] = useState<string[]>(loadInputHistory)
  const [cursor, setCursor] = useState<HistoryCursor>(() => draftCursor(loadInputHistory()))
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => saveDraft(text), [text])
  // 앱을 끌 때 아직 못 보낸 대기열 글도 입력칸 글에 붙여 남긴다(다시 켜면 입력칸으로 돌아온다)
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  })
  useEffect(() => {
    const onUnload = (): void => {
      // AI 가 아직 집어 들지 못한 끼어든 말도 같이 남긴다
      const st = useChatStore.getState()
      const queued = [...st.injecting, ...st.queue].map((q) => q.text)
      if (queued.length > 0) saveDraft(draftOnQuit(textRef.current, queued))
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])
  // 글 길이에 맞춰 입력칸 높이를 늘린다
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`
  }, [text])
  // 중단·실패로 못 보낸 대기 글을 입력칸으로 돌려받는다(쓰던 글이 있으면 그 앞에 붙인다).
  // 스토어 구독으로 받는다 — 패널을 접어 둔 사이에 돌아온 글은 다시 열릴 때 한 번 챙긴다
  useEffect(() => {
    const take = (): void => {
      const d = useChatStore.getState().takeDraftReturn()
      if (!d) return
      setText((prev) => (prev.trim() === '' ? d.text : `${d.text}\n${prev}`))
      if (d.images && d.images.length > 0) {
        const back = d.images
        setImages((prev) => [...back, ...prev].slice(0, AGENT_IMAGE_MAX_COUNT))
      }
      if (d.files && d.files.length > 0) {
        const back = d.files
        setFiles((prev) => [...back, ...prev].slice(0, AGENT_FILE_MAX_COUNT))
      }
    }
    queueMicrotask(take)
    return useChatStore.subscribe((s) => {
      if (s.draftReturn) take()
    })
  }, [])
  // 붙여 넣거나 끌어다 놓은 파일을 첨부로 읽는다. 사진은 사진 칸, PDF·글 파일은 파일 칸으로.
  // 개수·크기를 넘거나 못 읽는 형식이면 붙이지 않고 이유를 한 줄 띄운다
  const attach = async (list: File[]): Promise<void> => {
    const addedImages: AgentImage[] = []
    const addedFiles: AgentFile[] = []
    let error = ''
    let textTotal = files.reduce((n, f) => n + (f.kind === 'text' ? f.text.length : 0), 0)
    for (const file of list) {
      const r = await readDroppedFile(file)
      if ('error' in r) {
        error = t(r.error === 'too-large' ? 'chat.fileTooLarge' : 'chat.fileUnsupported', {
          name: file.name
        })
        continue
      }
      if ('image' in r) {
        if (images.length + addedImages.length >= AGENT_IMAGE_MAX_COUNT) {
          error = t('chat.imageTooMany', { max: AGENT_IMAGE_MAX_COUNT })
          continue
        }
        addedImages.push(r.image)
        continue
      }
      if (files.length + addedFiles.length >= AGENT_FILE_MAX_COUNT) {
        error = t('chat.fileTooMany', { max: AGENT_FILE_MAX_COUNT })
        continue
      }
      if (r.file.kind === 'text') {
        if (textTotal + r.file.text.length > AGENT_TEXT_FILES_TOTAL_MAX_CHARS) {
          error = t('chat.fileTooLarge', { name: file.name })
          continue
        }
        textTotal += r.file.text.length
      }
      addedFiles.push(r.file)
    }
    if (addedImages.length > 0) setImages((prev) => [...prev, ...addedImages])
    if (addedFiles.length > 0) setFiles((prev) => [...prev, ...addedFiles])
    setNote(error)
  }
  // 대화창 아무 데나 끌어다 놓은 파일을 받는다(ChatPanel 이 스토어에 넣어 둔다)
  const attachRef = useRef(attach)
  useEffect(() => {
    attachRef.current = attach
  })
  useEffect(() => {
    const take = (): void => {
      const dropped = useChatStore.getState().takeDropped()
      if (dropped) void attachRef.current(dropped)
    }
    queueMicrotask(take)
    return useChatStore.subscribe((s) => {
      if (s.dropped) take()
    })
  }, [])
  const submit = (): void => {
    const v = text.trim()
    // 그림·파일만 붙이고 글이 없어도 보낼 수 있다(모델이 그것을 보고 묻게)
    if (!v && images.length === 0 && files.length === 0) return
    const nextHistory = addToHistory(history, v)
    setHistory(nextHistory)
    setCursor(draftCursor(nextHistory))
    saveInputHistory(nextHistory)
    setText('')
    setImages([])
    setFiles([])
    setNote('')
    const attached = images.length > 0 ? images : undefined
    const attachedFiles = files.length > 0 ? files : undefined
    // 일하는 중이면 지금 실행에 끼워 넣는다(못 넣으면 대기열 — 지금 작업이 끝나면 이어서 보낸다)
    if (running) void sendWhileRunning(v, attached, attachedFiles)
    else void send(v, undefined, attached, attachedFiles)
  }
  // 붙여넣기에 그림·파일이 들어 있으면 글 대신 첨부로 받는다(텍스트 붙여넣기는 그대로)
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = filesOf(e.clipboardData)
    if (pasted.length === 0) return
    e.preventDefault()
    void attach(pasted)
  }
  const canSend = text.trim() !== '' || images.length > 0 || files.length > 0
  // '/' 로 시작해 '/compact' 의 앞부분까지만 쳤을 때 명령 안내를 띄운다(다 친 뒤엔 숨긴다)
  const slashHint = /^\/[a-z]*$/i.test(text) && '/compact'.startsWith(text.toLowerCase())
  return (
    <div className="border-t border-black/5 p-3">
      {/* 끼워 넣은 말 — AI 가 다음 단계 사이에 집어 들면 말풍선으로 바뀐다(되돌릴 수 없다) */}
      {injecting.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {injecting.map((q) => (
            <div
              key={q.id}
              className="flex items-center gap-2 rounded-lg bg-black/[.04] px-2.5 py-1.5 text-[12px] text-[var(--text2)]"
            >
              <span className="shrink-0 animate-pulse rounded-full border border-[var(--accent)] px-1.5 text-[10.5px] text-[var(--accent)]">
                {t('chat.injecting')}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {q.text ||
                  (q.files && q.files.length > 0
                    ? q.files.map((f) => f.name).join(', ')
                    : t('chat.imagePasted', { n: q.images?.length ?? 0 }))}
              </span>
            </div>
          ))}
        </div>
      )}
      {queue.some((q) => (q.chatId ?? runChatId) === activeChatId) && (
        <div className="mb-2 flex flex-col gap-1">
          {queue.map((q, i) =>
            (q.chatId ?? runChatId) !== activeChatId ? null : (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg bg-black/[.04] px-2.5 py-1.5 text-[12px] text-[var(--text2)]"
              >
                <span className="shrink-0 rounded-full border border-[var(--line)] px-1.5 text-[10.5px]">
                  {t('chat.queued')}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {q.text ||
                    (q.files && q.files.length > 0
                      ? q.files.map((f) => f.name).join(', ')
                      : t('chat.imagePasted', { n: q.images?.length ?? 0 }))}
                </span>
                <button
                  type="button"
                  aria-label={t('chat.queueRemove')}
                  title={t('chat.queueRemove')}
                  onClick={() => unqueue(i)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text3)] hover:bg-black/5 hover:text-[var(--text)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          )}
        </div>
      )}
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={agentImageDataUrl(img)}
                alt=""
                className="h-14 w-14 rounded-lg border border-[var(--line)] object-cover"
              />
              <button
                type="button"
                aria-label={t('chat.imageRemove')}
                onClick={() => setImages((prev) => prev.filter((_, k) => k !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--text)] text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <span className="text-[11px] text-[var(--text2)]">
            {t('chat.imagePasted', { n: images.length })}
          </span>
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {files.map((f, i) => (
            <span
              key={i}
              title={f.name}
              className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-[11.5px] text-[var(--text2)]"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{f.name}</span>
              <button
                type="button"
                aria-label={t('chat.fileRemove')}
                title={t('chat.fileRemove')}
                onClick={() => setFiles((prev) => prev.filter((_, k) => k !== i))}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--text3)] hover:bg-black/5 hover:text-[var(--text)]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {note && <p className="mb-1.5 text-[11px] text-[#b91c1c]">{note}</p>}
      {/* '/' 로 시작하면 명령 안내 — 누르거나 Tab 으로 채운다(Claude 앱의 슬래시 명령처럼) */}
      {slashHint && (
        <button
          type="button"
          onClick={() => {
            setText('/compact ')
            box.current?.focus()
          }}
          className="mb-1.5 flex w-full items-center gap-2 rounded-lg bg-black/[.04] px-2.5 py-1.5 text-left text-[12px] text-[var(--text2)] hover:bg-black/[.07]"
        >
          <span className="shrink-0 font-mono font-semibold text-[var(--text)]">/compact</span>
          <span className="min-w-0 flex-1 truncate">{t('chat.compactHint')}</span>
          <span className="shrink-0 text-[10.5px] text-[var(--text3)]">Tab</span>
        </button>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2">
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            // 직접 고치기 시작하면 그 글이 새 '쓰던 글'이다
            setCursor(draftCursor(history))
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            // 명령 안내가 떠 있으면 Tab 으로 채운다
            if (e.key === 'Tab' && slashHint) {
              e.preventDefault()
              setText('/compact ')
              return
            }
            // Enter 는 보내기, Shift+Enter 는 줄바꿈(클로드 웹과 같다)
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              return submit()
            }
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            // 여러 줄 글에서는 ↑/↓ 가 줄 이동이다 — 맨 윗줄의 ↑, 맨 아랫줄의 ↓ 일 때만 이전 문장을 꺼낸다
            const el = e.currentTarget
            if (el.selectionStart !== el.selectionEnd) return
            const crossesLine =
              e.key === 'ArrowUp'
                ? el.value.slice(0, el.selectionStart).includes('\n')
                : el.value.slice(el.selectionEnd).includes('\n')
            if (crossesLine) return
            const step = stepHistory(history, cursor, e.key === 'ArrowUp' ? 'older' : 'newer', text)
            if (!step) return
            e.preventDefault()
            setCursor(step.cursor)
            setText(step.value)
          }}
          placeholder={
            running
              ? t(canInject ? 'chat.placeholderInject' : 'chat.placeholderRunning')
              : busyElsewhere
                ? t('chat.placeholderOtherRunning')
                : t('chat.placeholder')
          }
          style={{ maxHeight: INPUT_MAX_HEIGHT }}
          className="min-w-0 flex-1 resize-none bg-transparent leading-relaxed outline-none"
        />
        {/* 보내기 단추 왼쪽: 구독 사용량 링(마우스를 올리면 한도·초기화 시각). 아래 메뉴 줄은 좁아 넘친다 */}
        <UsageRing />
        {running && (
          // 실행 중에는 중단 버튼 — 위쪽 진행 바가 안 보여도 여기서 멈출 수 있다
          <button
            onClick={() => void stop()}
            aria-label={t('chat.stop')}
            title={t('chat.stop')}
            className="mb-px flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg bg-[var(--text)] text-white"
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
        )}
        {(!running || canSend) && (
          <button
            onClick={submit}
            disabled={!canSend}
            aria-label={
              running
                ? t(canInject ? 'chat.injectSend' : 'chat.queueSend')
                : busyElsewhere
                  ? t('chat.queueSend')
                  : t('chat.send')
            }
            title={
              running
                ? t(canInject ? 'chat.injectSend' : 'chat.queueSend')
                : busyElsewhere
                  ? t('chat.queueSend')
                  : t('chat.send')
            }
            className="mb-px flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg bg-[var(--text)] text-white disabled:opacity-40"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* 권한 모드 옆에 모델 · 추론 강도 선택(Aside 하단 줄과 같은 자리) */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PermissionMenu />
        <EngineMenu />
        <ModelEffortMenu />
      </div>
    </div>
  )
}
