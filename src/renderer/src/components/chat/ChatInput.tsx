import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Square, X } from 'lucide-react'
import { useChatStore } from '@renderer/stores/chatStore'
import { imageFilesOf, readAgentImage } from '@renderer/lib/paste-image'
import {
  addToHistory,
  draftCursor,
  loadInputHistory,
  saveInputHistory,
  stepHistory,
  type HistoryCursor
} from '@renderer/lib/input-history'
import { AGENT_IMAGE_MAX_COUNT, agentImageDataUrl, type AgentImage } from '@shared/agent-image'
import { PermissionMenu } from './PermissionMenu'
import { ModelEffortMenu } from './ModelEffortMenu'

// 입력칸이 글에 맞춰 늘어나는 최대 높이(px). 넘으면 칸 안에서 스크롤한다
const INPUT_MAX_HEIGHT = 200

export function ChatInput(): React.JSX.Element {
  const { t } = useTranslation()
  const { send, status, stop, queue, enqueue, unqueue } = useChatStore()
  const running = status === 'running'
  const [text, setText] = useState('')
  // 클립보드에서 붙여 넣은 이미지. 보내면 비운다
  const [images, setImages] = useState<AgentImage[]>([])
  const [note, setNote] = useState('')
  // 보낸 문장 이력 — ↑/↓ 로 다시 꺼낸다(터미널과 같은 동작)
  const [history, setHistory] = useState<string[]>(loadInputHistory)
  const [cursor, setCursor] = useState<HistoryCursor>(() => draftCursor(loadInputHistory()))
  const box = useRef<HTMLTextAreaElement>(null)
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
    }
    queueMicrotask(take)
    return useChatStore.subscribe((s) => {
      if (s.draftReturn) take()
    })
  }, [])
  const submit = (): void => {
    const v = text.trim()
    // 그림만 붙이고 글이 없어도 보낼 수 있다(모델이 그림을 보고 묻게)
    if (!v && images.length === 0) return
    const nextHistory = addToHistory(history, v)
    setHistory(nextHistory)
    setCursor(draftCursor(nextHistory))
    saveInputHistory(nextHistory)
    setText('')
    setImages([])
    setNote('')
    const attached = images.length > 0 ? images : undefined
    // 일하는 중이면 대기열에 둔다 — 지금 작업이 끝나면 이어서 보낸다
    if (running) enqueue(v, attached)
    else void send(v, undefined, attached)
  }
  // 붙여넣기에 이미지가 들어 있으면 글 대신 그림으로 받는다(텍스트 붙여넣기는 그대로)
  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const files = imageFilesOf(e.clipboardData)
    if (files.length === 0) return
    e.preventDefault()
    const room = AGENT_IMAGE_MAX_COUNT - images.length
    if (room <= 0) {
      setNote(t('chat.imageTooMany', { max: AGENT_IMAGE_MAX_COUNT }))
      return
    }
    const added: AgentImage[] = []
    let error = ''
    for (const file of files.slice(0, room)) {
      const r = await readAgentImage(file)
      if (typeof r === 'string') {
        error = r === 'too-large' ? t('chat.imageTooLarge') : ''
        continue
      }
      added.push(r)
    }
    if (files.length > room) error = t('chat.imageTooMany', { max: AGENT_IMAGE_MAX_COUNT })
    setImages((prev) => [...prev, ...added])
    setNote(error)
  }
  const canSend = text.trim() !== '' || images.length > 0
  return (
    <div className="border-t border-black/5 p-3">
      {queue.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {queue.map((q, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg bg-black/[.04] px-2.5 py-1.5 text-[12px] text-[var(--text2)]"
            >
              <span className="shrink-0 rounded-full border border-[var(--line)] px-1.5 text-[10.5px]">
                {t('chat.queued')}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {q.text || t('chat.imagePasted', { n: q.images?.length ?? 0 })}
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
          ))}
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
      {note && <p className="mb-1.5 text-[11px] text-[#b91c1c]">{note}</p>}
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
          onPaste={(e) => void onPaste(e)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
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
          placeholder={running ? t('chat.placeholderRunning') : t('chat.placeholder')}
          style={{ maxHeight: INPUT_MAX_HEIGHT }}
          className="min-w-0 flex-1 resize-none bg-transparent leading-relaxed outline-none"
        />
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
            aria-label={running ? t('chat.queueSend') : t('chat.send')}
            title={running ? t('chat.queueSend') : t('chat.send')}
            className="mb-px flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg bg-[var(--text)] text-white disabled:opacity-40"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* 권한 모드 옆에 모델 · 추론 강도 선택(Aside 하단 줄과 같은 자리) */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PermissionMenu />
        <ModelEffortMenu />
      </div>
    </div>
  )
}
