import type React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useChatStore } from '@renderer/stores/chatStore'
import { useAiStore } from '@renderer/stores/aiStore'
import { CHAT_ENGINES, type ChatEngine } from '@shared/ai'

// 입력줄 아래 'Claude / Codex' — 이 대화를 어느 AI 로 이어 갈지. 대화마다 따로 남는다.
// Codex 를 처음 고르면 Codex 구독을 연결한다(이 PC 에 Codex 로그인이 있을 때만 붙는다 — 몰래 쓰지 않는다)

const LABEL: Record<ChatEngine, string> = { claude: 'Claude', codex: 'Codex' }

export function EngineMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const engine = useChatStore((s) => s.engine)
  // 일하는 대화만 AI 를 못 바꾼다(다른 대화는 일하는 중에도 고른다)
  const running = useChatStore((s) => s.status === 'running' && s.runChatId === s.activeChatId)
  const setEngine = useChatStore((s) => s.setEngine)
  const providers = useAiStore((s) => s.providers)
  const connect = useAiStore((s) => s.connect)

  const choose = async (next: ChatEngine): Promise<void> => {
    if (next === engine || running) return
    if (next === 'codex') {
      const codex = providers.find((p) => p.id === 'codex_subscription')
      if (codex && codex.state !== 'connected') await connect('codex_subscription')
    }
    await setEngine(next)
  }

  return (
    <span
      role="radiogroup"
      aria-label={t('chat.engineMenu')}
      title={t('chat.engineHint')}
      className="inline-flex items-center rounded-full border border-[var(--line)] bg-white p-0.5 text-[11px]"
    >
      {CHAT_ENGINES.map((e) => (
        <button
          key={e}
          type="button"
          role="radio"
          aria-checked={engine === e}
          disabled={running}
          onClick={() => void choose(e)}
          className={cn(
            'rounded-full px-2 py-0.5 transition-colors disabled:cursor-not-allowed',
            engine === e
              ? 'bg-[var(--text)] text-white'
              : 'text-[var(--text2)] hover:bg-black/[.04] disabled:opacity-50'
          )}
        >
          {LABEL[e]}
        </button>
      ))}
    </span>
  )
}
