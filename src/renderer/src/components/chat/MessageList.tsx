import type React from 'react'
import { memo, useEffect, useRef } from 'react'
import { useChatStore, type ChatMessage } from '@renderer/stores/chatStore'
import { StepLog } from './StepLog'

// 맨 아래에서 이만큼(px) 안쪽이면 '따라 내려가는 중'으로 본다
const STICK_GAP = 40

export function MessageList(): React.JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const box = useRef<HTMLDivElement>(null)
  // 위로 올려 읽는 중이면 흘러오는 답을 따라 내리지 않는다. 새 말풍선이 생기면 다시 따라간다
  const stick = useRef(true)
  const count = useRef(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    if (messages.length !== count.current) stick.current = true
    count.current = messages.length
    if (stick.current) el.scrollTop = el.scrollHeight
  }, [messages])
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_GAP
      }}
      className="flex flex-1 flex-col gap-3 overflow-auto p-3.5"
    >
      {messages.map((m, i) => (
        <MessageRow
          key={m.id}
          m={m}
          running={status === 'running' && i === messages.length - 1}
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
      <div className="max-w-[88%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-[4px] bg-[var(--text)] px-3 py-2 leading-relaxed text-white">
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
        {m.text}
      </div>
    )
  return (
    <div className="max-w-[94%] self-start leading-relaxed">
      <div className="whitespace-pre-wrap break-words">
        {m.partial ? (m.text ? `${m.text}\n${m.partial}` : m.partial) : m.text}
        {/* 글자가 흘러오는 동안 끝에 깜빡이는 커서 */}
        {m.partial ? (
          <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[var(--text)]" />
        ) : null}
      </div>
      <StepLog steps={m.steps ?? []} running={running} />
    </div>
  )
})
