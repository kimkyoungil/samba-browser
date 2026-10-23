import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { lastNonEmptyLine } from '@renderer/lib/thinking-line'
import { MarkdownText } from './MarkdownText'

// 생각 과정 칸. 평소엔 접어 두고 누르면 펼친다. 생각하는 동안에는 마지막 줄을 한 줄로 흘려 보여 준다
export function ThinkingBlock({ text, live }: { text: string; live: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const lastLine = live ? lastNonEmptyLine(text) : ''
  return (
    <div className="mb-1.5 text-[12.5px] text-[var(--text2)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1.5 hover:text-[var(--text)]"
      >
        <Brain className={`h-3.5 w-3.5 shrink-0 ${live ? 'animate-pulse' : ''}`} />
        <span className="shrink-0">{live ? t('chat.thoughtsLive') : t('chat.thoughts')}</span>
        {!open && lastLine && (
          <span className="min-w-0 truncate text-[var(--text3)]">{lastLine}</span>
        )}
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>
      {open && (
        <div className="mt-1 max-h-72 overflow-auto border-l-2 border-[var(--line)] pl-2.5 text-[var(--text2)]">
          <MarkdownText text={text} />
        </div>
      )}
    </div>
  )
}
