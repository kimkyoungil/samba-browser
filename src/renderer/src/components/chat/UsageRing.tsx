import type React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAiStore } from '@renderer/stores/aiStore'
import { useChatStore } from '@renderer/stores/chatStore'
import { pickHeadlineLimit, usageResetText } from '@renderer/lib/usage-view'
import { AI_USAGE_WARN_PERCENT, providerOfEngine, type AiUsageLimit } from '@shared/ai'

// 사용량을 다시 묻는 최소 간격(사용량 API 를 너무 자주 부르지 않게)
const USAGE_REFRESH_MS = 60_000
// 링 크기·두께(px)
const RING = 16
const STROKE = 2.5

const LABEL_KEYS: Record<AiUsageLimit['kind'], string> = {
  session: 'ai.usage.session',
  weekly_all: 'ai.usage.weeklyAll',
  weekly_scoped: 'ai.usage.weeklyModel'
}

// 입력칸 보내기 단추 옆의 구독 사용량 링(Claude 앱처럼). 가장 많이 쓴 한도를 링으로 그리고,
// 마우스를 올리면 한도마다 '이름: n%'와 초기화 시각을 보여 준다. 구독이 아니거나 조회가 안 되면 숨긴다
export function UsageRing(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const engine = useChatStore((s) => s.engine)
  const status = useChatStore((s) => s.status)
  const provider = providerOfEngine(engine)
  const usage = useAiStore((s) =>
    provider === 'claude_subscription' || provider === 'codex_subscription'
      ? s.usage[provider]
      : undefined
  )
  const loadUsage = useAiStore((s) => s.loadUsage)
  const lastLoaded = useRef(0)
  // 처음 뜰 때·AI 를 바꿨을 때·작업이 끝났을 때 다시 읽는다(1분에 한 번까지)
  useEffect(() => {
    if (status === 'running') return
    if (Date.now() - lastLoaded.current < USAGE_REFRESH_MS) return
    lastLoaded.current = Date.now()
    void loadUsage()
  }, [status, engine, loadUsage])
  const headline = usage ? pickHeadlineLimit(usage.limits) : null
  if (!usage || !headline) return null
  const label = (l: AiUsageLimit): string => t(LABEL_KEYS[l.kind], { model: l.model ?? '' })
  const warn = headline.percent >= AI_USAGE_WARN_PERCENT
  const r = (RING - STROKE) / 2
  const len = 2 * Math.PI * r
  const filled = (Math.min(100, Math.max(0, headline.percent)) / 100) * len
  return (
    <div className="group relative mb-px flex shrink-0 items-center">
      <span
        tabIndex={0}
        aria-label={`${label(headline)}: ${headline.percent}%`}
        className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-black/5"
      >
        <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} className="-rotate-90">
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={r}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-black/10"
          />
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={r}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${len}`}
            className={warn ? 'stroke-[#b91c1c]' : 'stroke-[var(--accent)]'}
          />
        </svg>
      </span>
      {/* 마우스를 올리거나 초점이 오면 위로 뜨는 작은 카드 */}
      <div className="pointer-events-none absolute right-0 bottom-full z-30 mb-1.5 hidden w-max max-w-[260px] flex-col gap-1.5 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[12px] shadow-[0_4px_16px_rgba(0,0,0,.12)] group-focus-within:flex group-hover:flex">
        {usage.limits.map((l, i) => (
          <div key={`${l.kind}-${i}`} className="flex flex-col">
            <span
              className={
                l.percent >= AI_USAGE_WARN_PERCENT
                  ? 'font-semibold text-[#b91c1c]'
                  : 'font-semibold text-[var(--text)]'
              }
            >
              {label(l)}: {l.percent}%
            </span>
            {l.resetsAt && (
              <span className="text-[11px] text-[var(--text2)]">
                {t('chat.usageResets', { when: usageResetText(l.resetsAt, i18n.language) })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
