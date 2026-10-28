import type React from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore, type QueuedMessage } from '@renderer/stores/chatStore'

// 일하는 중에 보낸 말 — 대화 맨 아래에 흐린 말풍선으로(Claude 앱처럼).
// 끼워 넣는 중인 말은 '곧 전달', 대기열의 말은 [지금 보내기 · 취소]. 대화방마다 따로 돌아 이 대화 몫만 보인다
export function PendingMessages(): React.JSX.Element | null {
  const { t } = useTranslation()
  const queue = useChatStore((s) => s.queue)
  const injecting = useChatStore((s) => s.injecting)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const status = useChatStore((s) => s.status)
  const unqueue = useChatStore((s) => s.unqueue)
  const sendNow = useChatStore((s) => s.sendNow)
  // 이 대화 몫의 대기 말(대기열 자리 번호를 함께 — 취소·지금 보내기가 쓴다)
  const mine = queue
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => (q.chatId ?? null) === activeChatId)
  const sending = injecting.filter((q) => (q.chatId ?? null) === activeChatId)
  if (mine.length === 0 && sending.length === 0) return null
  const running = status === 'running'
  return (
    <>
      {sending.map((q) => (
        <PendingBubble key={q.id} q={q}>
          <span className="animate-pulse text-[var(--accent)]">{t('chat.injecting')}</span>
        </PendingBubble>
      ))}
      {mine.map(({ q, i }) => (
        <PendingBubble key={`q-${i}`} q={q}>
          {running && (
            <button
              type="button"
              onClick={() => void sendNow(i)}
              className="font-medium text-[var(--text2)] hover:text-[var(--text)] hover:underline"
            >
              {t('chat.sendNow')}
            </button>
          )}
          <button
            type="button"
            onClick={() => unqueue(i)}
            className="hover:text-[var(--text)] hover:underline"
          >
            {t('chat.queueCancel')}
          </button>
        </PendingBubble>
      ))}
    </>
  )
}

// 흐린 사용자 말풍선 + 아래 한 줄(상태·단추)
function PendingBubble({
  q,
  children
}: {
  q: QueuedMessage
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const label =
    q.text ||
    (q.files && q.files.length > 0
      ? q.files.map((f) => f.name).join(', ')
      : t('chat.imagePasted', { n: q.images?.length ?? 0 }))
  const extra = [
    ...(q.text && q.images && q.images.length > 0
      ? [t('chat.imagePasted', { n: q.images.length })]
      : []),
    ...(q.text && q.files && q.files.length > 0 ? q.files.map((f) => `📎 ${f.name}`) : [])
  ]
  return (
    <div className="flex max-w-[88%] flex-col items-end gap-1 self-end">
      <div className="min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-[4px] bg-[var(--text)]/45 px-3 py-2 leading-relaxed text-white">
        {label}
        {extra.length > 0 && (
          <div className="mt-1 text-[11px] text-white/80">{extra.join(' · ')}</div>
        )}
      </div>
      <div className="flex items-center gap-2.5 text-[11.5px] text-[var(--text3)]">{children}</div>
    </div>
  )
}
