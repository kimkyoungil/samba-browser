import type React from 'react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { useChatStore, type ChatMessage } from '@renderer/stores/chatStore'
import { StepLog } from './StepLog'
import { MarkdownText } from './MarkdownText'
import { CopyButton } from './CopyButton'
import { ThinkingBlock } from './ThinkingBlock'
import { TodoChecklist } from './TodoChecklist'
import { UserMessage } from './UserMessage'
import { CompactNote } from './CompactNote'
import { PendingMessages } from './PendingMessages'
import { COMPACT_MARK } from '@shared/chat'

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
  // 지금 보는 대화가 일하는 대화인가(다른 대화를 보는 중이면 마지막 말풍선에 '쓰는 중'을 달지 않는다)
  const viewRunning = useChatStore((s) => s.status === 'running' && s.runChatId === s.activeChatId)
  // 맨 아래 대기 말풍선 수 — 늘면 따라 내려간다
  const pendingCount = useChatStore((s) => s.queue.length + s.injecting.length)
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
  }, [messages, pendingCount])
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
          running={viewRunning && hidden + i === messages.length - 1}
          busy={status === 'running'}
          last={hidden + i === messages.length - 1}
        />
      ))}
      {/* 일하는 중에 보낸 말 — 맨 아래 흐린 말풍선([지금 보내기 · 취소]) */}
      <PendingMessages />
    </div>
  )
}

// 말풍선 하나. 글자가 흘러오는 동안 바뀌는 건 마지막 말풍선뿐이라, 나머지는 다시 그리지 않는다
const MessageRow = memo(function MessageRow({
  m,
  running,
  busy,
  last
}: {
  m: ChatMessage
  running: boolean
  // 지금 무엇이든 일하는 중인지(고쳐 보내기·다시 받기를 막는다)
  busy: boolean
  // 대화의 맨 끝 말풍선인지(다시 받기는 마지막 답에만 붙는다)
  last: boolean
}): React.JSX.Element {
  if (m.role === 'user') return <UserMessage m={m} busy={busy} />
  const shown = m.partial ? (m.text ? `${m.text}\n${m.partial}` : m.partial) : m.text
  return (
    <div className="group max-w-[94%] self-start leading-relaxed">
      {/* 답 글이 흘러오기 시작하면 '생각하는 중' 표시를 멈춘다 */}
      {m.thinking && <ThinkingBlock text={m.thinking} live={running && !shown} />}
      {m.todos && m.todos.length > 0 && <TodoChecklist items={m.todos} running={running} />}
      {/* /compact 로 남긴 압축 요약은 '대화를 압축했어요' 한 줄(누르면 요약)로 그린다 */}
      {shown &&
        (shown.startsWith(COMPACT_MARK) ? (
          <CompactNote text={shown} />
        ) : (
          <MarkdownText text={shown} />
        ))}
      {/* 글자가 흘러오는 동안 끝에 깜빡이는 커서 */}
      {m.partial ? (
        <span className="inline-block h-[1em] w-[2px] animate-pulse bg-[var(--text)]" />
      ) : null}
      <StepLog steps={m.steps ?? []} running={running} />
      {/* 다 쓴 답만 복사한다(쓰는 중인 글은 아직 바뀐다). 마지막 답은 [다시 받기]와 함께 늘 보인다 */}
      {!running && (m.text || (last && !busy)) && (
        <div
          className={`mt-0.5 flex transition-opacity ${last && !busy ? '' : 'opacity-0 group-hover:opacity-100'}`}
        >
          {m.text && <CopyButton text={m.text} />}
          {last && !busy && <RegenerateButton />}
        </div>
      )}
    </div>
  )
})

// 마지막 답 다시 받기 — 마지막 말을 같은 글·첨부로 다시 보낸다(그 말부터 뒤는 기록에서 지운다)
function RegenerateButton(): React.JSX.Element {
  const { t } = useTranslation()
  const regenerate = useChatStore((s) => s.regenerate)
  return (
    <button
      type="button"
      aria-label={t('chat.regenerate')}
      title={t('chat.regenerate')}
      onClick={() => void regenerate()}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text3)] hover:bg-black/5 hover:text-[var(--text)]"
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </button>
  )
}
