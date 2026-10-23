import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '@renderer/stores/chatStore'
import { useAiStore } from '@renderer/stores/aiStore'
import { engineOfProvider, providerOfEngine, type AiProviderId } from '@shared/ai'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { ConfirmCard } from './ConfirmCard'
import { HandoffCard } from './HandoffCard'
import { AuthBanner } from './AuthBanner'
import { PanelRightClose } from 'lucide-react'
import { useUiStore } from '@renderer/stores/uiStore'

// 배지에 쓸 제공자 이름 키
const PROVIDER_LABEL_KEYS: Record<AiProviderId, string> = {
  claude_subscription: 'settings.ai.claudeSubscription',
  codex_subscription: 'settings.ai.codexSubscription',
  api_key: 'settings.ai.apiKey',
  service_credit: 'settings.ai.serviceCredit'
}

// 다른 대화를 보는 동안 플레이북 줄을 숨길 때 쓰는 빈 목록(매번 새 배열이면 다시 그리기가 돈다)
const NO_NAMES: string[] = []

export function ChatPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const handleEvent = useChatStore((s) => s.handleEvent)
  // 이번 실행에 적용된 플레이북 이름(없으면 줄 자체가 뜨지 않는다)
  const playbookNames = useChatStore((s) =>
    s.runChatId === s.activeChatId ? s.playbookNames : NO_NAMES
  )
  // 다른 대화에서 일하는 중이면 그 대화(띠를 누르면 그리로 간다)
  const otherRun = useChatStore((s) =>
    s.status === 'running' && s.runChatId !== null && s.runChatId !== s.activeChatId
      ? s.runChatId
      : null
  )
  const otherRunTitle = useChatStore((s) =>
    otherRun === null ? '' : (s.chats.find((c) => c.id === otherRun)?.title ?? '')
  )
  const openChat = useChatStore((s) => s.openChat)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const openSettings = useUiStore((s) => s.openSettings)
  useEffect(() => window.samba.agent.onEvent(handleEvent), [handleEvent])
  // 상단 배지는 지금 고른 경로와 **실제 연결 상태**를 그대로 비춘다
  const provider = useAiStore((s) => s.provider)
  const providers = useAiStore((s) => s.providers)
  const loadAi = useAiStore((s) => s.load)
  useEffect(() => {
    void loadAi()
  }, [loadAi])
  // 이 대화에서 앱 기본 연결과 다른 AI 를 골랐으면 그 AI 의 연결을 비춘다
  const engine = useChatStore((s) => s.engine)
  const otherProvider = providerOfEngine(engine)
  const badgeProvider: AiProviderId =
    engineOfProvider(provider) === engine
      ? provider
      : engine === 'claude' &&
          !['connected', 'expired'].includes(
            providers.find((p) => p.id === otherProvider)?.state ?? ''
          ) &&
          providers.find((p) => p.id === 'api_key')?.state === 'connected'
        ? 'api_key'
        : otherProvider
  const status = providers.find((p) => p.id === badgeProvider)
  // 구독 카드는 connected 일 때만, 내 API 키는 키가 있을 때만 쓸 수 있다
  const usable = status?.state === 'connected'
  // 연결은 했지만 최근 실행이 로그인 만료로 막혔다 — '연결됨' 대신 '다시 로그인 필요'를 띄운다
  const expired = status?.state === 'expired'
  // 실행이 인증 실패로 끝났거나, 만료 상태에서 실행이 통했으면 연결 상태를 다시 읽는다.
  // 만료인 동안에는 창에 돌아올 때마다(터미널에서 다시 로그인하고 오는 길) 다시 읽는다
  const runStatus = useChatStore((s) => s.status)
  const authError = useChatStore((s) => s.authError)
  useEffect(() => {
    if ((runStatus === 'failed' && authError === 'missing') || (runStatus === 'done' && expired))
      void loadAi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runStatus, authError])
  useEffect(() => {
    if (!expired) return
    const recheck = (): void => void loadAi()
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [expired, loadAi])
  // 첫 실행 안내 — 연결된 제공자가 하나도 없으면 설정으로 가는 링크를 한 줄 보여 준다.
  // providers 가 아직 비어 있는 로딩 중에는 띄우지 않는다
  const noneConnected = providers.length > 0 && !providers.some((p) => p.state === 'connected')
  // 파일을 대화창 위로 끌고 오는 중인가(안쪽 요소를 넘나들 때마다 들고 나므로 횟수로 센다)
  const dropFiles = useChatStore((s) => s.dropFiles)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const hasFiles = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes('Files')
  return (
    <div
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        // 막지 않으면 놓는 순간 앱 화면이 그 파일로 넘어간다
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        dropFiles(Array.from(e.dataTransfer.files))
      }}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.06)]"
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--text)]/40 bg-white/85 text-[13px] font-medium text-[var(--text)]">
          {t('chat.dropHere')}
        </div>
      )}
      <div className="flex items-center justify-between border-b border-black/5 px-3.5 py-3 font-semibold">
        {t('chat.title')}
        <span className="flex items-center gap-1.5 text-[12px] font-normal text-[var(--text2)]">
          <span
            className={
              usable
                ? 'h-[7px] w-[7px] rounded-full bg-[var(--ok)]'
                : 'h-[7px] w-[7px] rounded-full bg-[var(--text2)]/40'
            }
          />
          {t(PROVIDER_LABEL_KEYS[badgeProvider])}
          {expired ? (
            <button
              type="button"
              onClick={() => openSettings('ai')}
              className="font-medium text-[#b45309] underline-offset-2 hover:underline"
            >
              · {t('settings.ai.expiredShort')}
            </button>
          ) : (
            !usable && ` · ${t('settings.ai.notConnectedShort')}`
          )}
          <button
            type="button"
            title={t('chat.collapsePanel')}
            onClick={() => togglePanel()}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--text3)] hover:bg-black/5 hover:text-[var(--text)]"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </span>
      </div>
      <AuthBanner />
      {noneConnected && (
        <div className="mx-3 mt-3 rounded-xl border border-[var(--line)] bg-black/[.03] px-3 py-2 text-[12.5px] text-[var(--text2)]">
          {t('chat.setupHint')}{' '}
          <button
            type="button"
            onClick={() => openSettings('ai')}
            className="font-medium text-[var(--text)] underline underline-offset-2"
          >
            {t('chat.setupLink')}
          </button>
        </div>
      )}
      {/* 플레이북 적용 안내 한 줄 — 어떤 절차를 따르는지 사용자가 바로 알 수 있게 한다 */}
      {playbookNames.length > 0 && (
        <div className="border-b border-black/5 px-3.5 py-2 text-[11.5px] text-[var(--text2)]">
          <span className="inline-flex h-[20px] items-center rounded-full border border-[var(--text)] bg-[var(--text)] px-2 font-medium text-white">
            {t('automation.appliedBadge')}
          </span>
          <span className="ml-2">
            {t('automation.applied', { names: playbookNames.join(', ') })}
          </span>
        </div>
      )}
      {otherRun !== null && (
        <button
          type="button"
          onClick={() => void openChat(otherRun)}
          className="flex items-center gap-2 border-b border-black/5 px-3.5 py-2 text-left text-[12px] text-[var(--text2)] hover:bg-black/[.03]"
        >
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]" />
          <span className="min-w-0 flex-1 truncate">
            {t('chat.otherRunning', { title: otherRunTitle || t('chat.untitled') })}
          </span>
          <span className="shrink-0 font-medium text-[var(--text)]">
            {t('chat.otherRunningOpen')}
          </span>
        </button>
      )}
      <MessageList />
      <HandoffCard />
      <ConfirmCard />
      <ChatInput />
    </div>
  )
}
