import type React from 'react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { useChatStore, type ChatMessage } from '@renderer/stores/chatStore'
import { StepLog } from './StepLog'
import { MarkdownText } from './MarkdownText'
import { CopyButton } from './CopyButton'

// 맨 아래에서 이만큼(px) 안쪽이면 '따라 내려가는 중'으로 본다
const STICK_GAP = 40
// 긴 대화는 최근 이만큼만 그린다 — 수천 개를 다 그리면 글자가 흘러올 때마다 화면 전체를 다시 그려
// 입력까지 버벅인다(Aside 에서 겪은 '대화가 쌓이면 그 채팅을 못 침'). 위의 버튼으로 더 펼친다
export const VISIBLE_STEP = 150

export function MessageList(): React.JSX.Element {
  const { t } = useTranslation()
  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const box = useRef<HTMLDivElement>(null)
  // 위로 올려 읽는 중이면 흘러오는 답을 따라 내리지 않는다. 새 말풍선이 생기면 다시 따라간다
  const stick = useRef(true)
  const count = useRef(0)
  // 그릴 개수. 대화를 바꾸면 다시 최근 VISIBLE_STEP 개로
  const [shown, setShown] = useState(VISIBLE_STEP)
  const [shownFor, setShownFor] = useState(activeChatId)
  if (shownFor !== activeChatId) {
    setShownFor(activeChatId)
    setShown(VISIBLE_STEP)
  }
  // '더 보기'를 누른 순간의 스크롤 높이 — 위에 메시지가 붙어도 보던 자리를 그대로 둔다
  const keepFrom = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || keepFrom.current === null) return
    el.scrollTop += el.scrollHeight - keepFrom.current
    keepFrom.current = null
  }, [shown])
  useEffect(() => {
    const el = box.current
    if (!el) return
    if (messages.length !== count.current) stick.current = true
    count.current = messages.length
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [messages])
  const hidden = Math.max(0, messages.length - shown)
  const visible = hidden > 0 ? messages.slice(hidden) : messages
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_GAP
      }}
      className="flex flex-1 flex-col gap-3 overflow-auto p-3.5"
    >
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => {
            keepFrom.current = box.current?.scrollHeight ?? null
            stick.current = false
            setShown((n) => n + VISIBLE_STEP)
          }}
          className="self-center rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--text2)] hover:bg-[var(--bg2)]"
        >
          {t('chat.showEarlier', { count: Math.min(hidden, VISIBLE_STEP), total: hidden })}
        </button>
      )}
      {visible.map((m, i) => (
        <MessageRow
          key={m.id}
          m={m}
          running={status === 'running' && hidden + i === messages.length - 1}
        />
      ))}
    </div>
  )
}

// 말풍선 하나. 글자가 흘러오는 동안 바뀌는 건 마지막 말풍선뿐이라, 나머지는 다시 그리지 않는다
const MessageRow = memo(function MessageRow({
  m,
  running
}: {
  m: ChatMessage
  running: boolean
}): React.JSX.Element {
  if (m.role === 'user')
    return (
      <div className="group flex max-w-[88%] items-end gap-1 self-end">
        {m.text && (
          <CopyButton
            text={m.text}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
        <div className="min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-[4px] bg-[var(--text)] px-3 py-2 leading-relaxed text-white">
          {m.images && m.images.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {m.images.map((src, k) => (
                <img
                  key={k}
                  src={src}
                  alt=""
                  className="max-h-32 max-w-full rounded-lg object-contain"
                />
              ))}
            </div>
          )}
          {m.files && m.files.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {m.files.map((name, k) => (
                <span
                  key={k}
                  className="flex max-w-full items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[11.5px]"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{name}</span>
                </span>
              ))}
            </div>
          )}
          {m.text}
        </div>
      </div>
    )
  const shown = m.partial ? (m.text ? `${m.text}\n${m.partial}` : m.partial) : m.text
  return (
    <div className="group max-w-[94%] self-start leading-relaxed">
      {shown && <MarkdownText text={shown} />}
      {/* 글자가 흘러오는 동안 끝에 깜빡이는 커서 */}
      {m.partial ? (
        <span className="inline-block h-[1em] w-[2px] animate-pulse bg-[var(--text)]" />
      ) : null}
      <StepLog steps={m.steps ?? []} running={running} />
      {/* 다 쓴 답만 복사한다(쓰는 중인 글은 아직 바뀐다) */}
      {!running && m.text && (
        <div className="mt-0.5 flex opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={m.text} />
        </div>
      )}
    </div>
  )
})
