import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { summarizeSteps } from '@renderer/lib/step-summary'
import type { Step } from '@renderer/stores/chatStore'

// 한 줄 요약에 보여 줄 종류 수(나머지는 펼치면 보인다)
const KINDS_SHOWN = 3

/**
 * AI 답의 진행 단계. 기본은 한 줄로 접는다(Claude 앱처럼) — 일하는 중에는 지금 하는 단계 한 줄,
 * 끝나면 '단계 N개 · 많이 한 일'. 누르면 전체 목록을 펼친다. 실패한 단계가 있으면 그 수를 붉게 붙인다
 */
export function StepLog({
  steps,
  running
}: {
  steps: Step[]
  running: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!steps.length) return null
  // 번역 키가 붙은 단계(사용자 확인 대기 → 재개)는 화면 언어로 보여 준다
  const labelOf = (s: Step): string => (s.key ? t(s.key) : s.label)
  const summary = summarizeSteps(steps.map((s) => ({ label: labelOf(s), ok: s.ok })))
  const last = steps[steps.length - 1]
  const headline = running
    ? labelOf(last)
    : steps.length === 1
      ? labelOf(last)
      : [
          t('chat.stepsCount', { n: summary.total }),
          ...summary.kinds.slice(0, KINDS_SHOWN).map((k) => `${k.name} ${k.count}`)
        ].join(' · ')
  return (
    <div className="mt-2 text-[12.5px] text-[var(--text2)]">
      <button
        type="button"
        aria-expanded={open}
        title={open ? t('chat.stepsHide') : t('chat.stepsShow')}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-2 rounded-[8px] py-0.5 pr-1.5 text-left hover:text-[var(--text)]"
      >
        {running ? (
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]" />
        ) : (
          // 몇 단계만 실패했으면 일 전체가 실패한 게 아니다 — 앞 표시는 전부 실패일 때만 ✕, 일부는 '실패 N' 글자로
          <StepMark ok={summary.failed < summary.total} />
        )}
        <span className="min-w-0 truncate">{headline}</span>
        {running && steps.length > 1 && (
          <span className="shrink-0 text-[var(--text3)]">
            {t('chat.stepsCount', { n: summary.total })}
          </span>
        )}
        {summary.failed > 0 && (
          <span className="shrink-0 text-[var(--danger)]">
            {t('chat.stepsFailed', { n: summary.failed })}
          </span>
        )}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[var(--text3)] transition-transform',
            open && 'rotate-90'
          )}
        />
      </button>
      {open && (
        <div className="mt-1.5 ml-1 flex flex-col gap-1.5 border-l border-[var(--line)] pl-3">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              {running && i === steps.length - 1 ? (
                <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]" />
              ) : (
                <StepMark ok={s.ok} />
              )}
              <span className="min-w-0 break-words">{labelOf(s)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StepMark({ ok }: { ok: boolean }): React.JSX.Element {
  return ok ? (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--ok)]">
      <Check className="h-2.5 w-2.5 stroke-[3] text-white" />
    </span>
  ) : (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--danger)]">
      <X className="h-2.5 w-2.5 stroke-[3] text-white" />
    </span>
  )
}
