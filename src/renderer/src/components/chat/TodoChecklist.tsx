import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ListChecks } from 'lucide-react'
import type { AgentTodo } from '@shared/ipc'

// AI 가 세운 할 일 목록. 끝난 줄은 체크·흐리게, 하는 중인 줄은 돌아가는 표시와 굵게
export function TodoChecklist({
  items,
  running
}: {
  items: AgentTodo[]
  running: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (items.length === 0) return null
  const done = items.filter((item) => item.status === 'done').length
  return (
    <div className="mb-2 rounded-lg border border-[var(--line)] px-2.5 py-2 text-[12.5px]">
      <div className="mb-1.5 flex items-center gap-1.5 text-[var(--text2)]">
        <ListChecks className="h-3.5 w-3.5" />
        <span>{t('chat.todos', { done, total: items.length })}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {item.status === 'done' ? (
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--ok)]">
                  <Check className="h-2.5 w-2.5 stroke-[3] text-white" />
                </span>
              ) : item.status === 'in_progress' && running ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]" />
              ) : (
                <span
                  className={`h-3.5 w-3.5 rounded-full border-2 ${
                    item.status === 'in_progress'
                      ? 'border-[var(--accent)]'
                      : 'border-[var(--line)]'
                  }`}
                />
              )}
            </span>
            <span
              className={
                item.status === 'done'
                  ? 'text-[var(--text3)] line-through'
                  : item.status === 'in_progress'
                    ? 'font-semibold text-[var(--text)]'
                    : 'text-[var(--text2)]'
              }
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
