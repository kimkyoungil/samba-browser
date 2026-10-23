import { useEffect, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useChatStore } from '@renderer/stores/chatStore'
import { useUiStore } from '@renderer/stores/uiStore'
import type { ChatDto } from '@shared/ipc'

export function ChatList(): React.JSX.Element {
  const { t } = useTranslation()
  const setView = useUiStore((s) => s.setView)
  const chats = useChatStore((s) => s.chats)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const loadChats = useChatStore((s) => s.loadChats)
  const openChat = useChatStore((s) => s.openChat)
  const newChat = useChatStore((s) => s.newChat)
  const removeChat = useChatStore((s) => s.removeChat)
  const chatLimit = useChatStore((s) => s.chatLimit)
  const chatQuery = useChatStore((s) => s.chatQuery)
  const moreChats = useChatStore((s) => s.moreChats)
  const searchChats = useChatStore((s) => s.searchChats)
  // 검색칸 글. 치는 동안은 기다렸다가(SEARCH_DELAY_MS) 멈추면 찾는다
  const [query, setQuery] = useState(chatQuery)
  useEffect(() => {
    if (query === chatQuery) return
    const timer = setTimeout(() => void searchChats(query), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, chatQuery, searchChats])
  const searching = chatQuery.trim() !== ''
  // 받아 온 개수가 상한만큼 꽉 찼으면 더 있을 수 있다
  const hasMore = chats.length >= chatLimit
  // 실행 중에는 다른 대화로 옮기지 못한다(화면의 메시지가 돌고 있는 작업에 묶여 있다).
  // 말없이 무반응이면 고장처럼 보이므로 흐리게 하고 이유를 알려 준다
  // 일하는 대화(그 줄에 도는 표시, 일하는 동안 지우기 막음). 다른 대화·새 대화는 일하는 중에도 연다
  const runningChatId = useChatStore((s) => (s.status === 'running' ? s.runChatId : null))

  // 앱이 뜨면 최근 대화를 한 번 읽어 온다
  useEffect(() => {
    void loadChats()
  }, [loadChats])

  // 사이드바 높이가 모자라면 대화 줄만 안에서 스크롤된다 — 목록이 길어도 북마크 머리줄·설정이
  // 창 밖으로 밀려 창 전체가 스크롤되지 않게(새 대화·검색칸 + 한두 줄은 늘 보인다)
  return (
    <div className="flex min-h-[88px] flex-col">
      <button
        type="button"
        onClick={() => {
          newChat()
          setView('browser')
        }}
        className="flex items-center gap-1.5 rounded-[9px] px-2 py-1.5 text-left text-[12px] text-[var(--text2)] hover:bg-black/5"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('chat.new')}
      </button>
      {/* 지난 대화 찾기 — 제목과 대화 내용에서 찾는다 */}
      <label className="mx-1 my-0.5 flex items-center gap-1.5 rounded-[8px] border border-[var(--line)] bg-white px-2 py-1 text-[12px] text-[var(--text2)] focus-within:border-[var(--text2)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text3)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
          }}
          placeholder={t('chat.searchPlaceholder')}
          aria-label={t('chat.searchPlaceholder')}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--text3)]"
        />
        {query && (
          <button
            type="button"
            aria-label={t('chat.searchClear')}
            title={t('chat.searchClear')}
            onClick={() => setQuery('')}
            className="shrink-0 rounded text-[var(--text3)] hover:text-[var(--text)]"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </label>
      {chats.length === 0 ? (
        <div className="px-2 py-1 text-[11px] text-[var(--text3)]">
          {searching ? t('chat.searchEmpty') : t('chat.empty')}
        </div>
      ) : (
        <ul className="flex min-h-0 flex-col overflow-auto">
          {chats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              running={chat.id === runningChatId}
              onOpen={() => {
                void openChat(chat.id)
                setView('browser')
              }}
              onDelete={() => void removeChat(chat.id)}
            />
          ))}
        </ul>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={() => void moreChats()}
          className="mx-1 rounded-[9px] px-2 py-1 text-left text-[11.5px] text-[var(--text3)] hover:bg-black/5 hover:text-[var(--text)]"
        >
          {t('chat.moreChats')}
        </button>
      )}
    </div>
  )
}

// 검색칸에서 손을 멈춘 뒤 찾기까지 기다리는 시간
const SEARCH_DELAY_MS = 250

function ChatRow({
  chat,
  active,
  running,
  onOpen,
  onDelete
}: {
  chat: ChatDto
  active: boolean
  /** 지금 이 대화에서 AI 가 일하는 중(도는 표시를 달고, 지우기를 숨긴다) */
  running: boolean
  onOpen: () => void
  onDelete: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <li className="group relative flex items-center">
      <button
        type="button"
        onClick={onOpen}
        title={running ? t('chat.runningHere') : chat.title || t('chat.untitled')}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 rounded-[9px] px-2 py-1.5 text-left text-[12px] text-[var(--text2)] hover:bg-black/5',
          active && 'bg-black/5 font-medium text-[var(--text)]'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{chat.title || t('chat.untitled')}</span>
        {running && (
          <span
            aria-label={t('chat.runningHere')}
            className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]"
          />
        )}
      </button>
      {/* 탭의 X 처럼 확인 없이 바로 지운다(사용자 요청). 일하는 대화는 끝난 뒤에 지운다 */}
      {!running && (
        <button
          type="button"
          aria-label={t('chat.delete')}
          title={t('chat.delete')}
          onClick={onDelete}
          className="absolute right-1 hidden rounded-[7px] p-1 text-[var(--text3)] hover:bg-black/5 hover:text-[var(--text)] group-hover:block"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )
}
