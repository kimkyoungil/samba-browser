import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FoldVertical } from 'lucide-react'
import { COMPACT_MARK } from '@shared/chat'
import { MarkdownText } from './MarkdownText'

// /compact 로 남긴 압축 요약 답. '대화를 압축했어요' 한 줄로 보이고, 누르면 요약 전문이 펼쳐진다
export function CompactNote({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const summary = text.slice(COMPACT_MARK.length).trim()
  return (
    <div className="my-1 w-full rounded-lg border border-dashed border-[var(--line)] px-3 py-2 text-[12.5px] text-[var(--text2)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <FoldVertical className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{t('chat.compacted')}</span>
        <span className="shrink-0 font-medium text-[var(--text)]">
          {open ? t('chat.compactHide') : t('chat.compactShow')}
        </span>
      </button>
      {open && (
        <div className="mt-2 border-t border-[var(--line)] pt-2 text-[var(--text)]">
          <MarkdownText text={summary} />
        </div>
      )}
    </div>
  )
}
