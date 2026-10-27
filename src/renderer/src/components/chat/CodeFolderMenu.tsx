import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, FolderCode } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'
import { useChatStore } from '@renderer/stores/chatStore'

// 코드 작업 폴더 — 고르면 이 대화는 코드 작업 모드로 돈다(그 폴더 안에서만 읽기·고치기, 명령은 확인 카드).
// 폴더를 고른 대화는 단추가 강조색으로 바뀌어 코드 모드인 것이 늘 보인다
export function CodeFolderMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const folder = useChatStore((s) => s.codeFolder)
  const error = useChatStore((s) => s.codeFolderError)
  const pick = useChatStore((s) => s.pickCodeFolder)
  const clear = useChatStore((s) => s.clearCodeFolder)
  // 일하는 대화는 끝난 뒤에 바꾼다
  const busy = useChatStore((s) => s.status === 'running' && s.activeChatId === s.runChatId)
  const [open, setOpen] = useState(false)
  const name = folder ? (folder.split(/[\\/]/).filter(Boolean).pop() ?? folder) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={folder ?? t('codeMode.title')}
          className={cn(
            'inline-flex max-w-[160px] items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
            folder
              ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/15'
              : 'border-[var(--line)] bg-white text-[var(--text2)] hover:bg-black/[.03]'
          )}
        >
          <FolderCode className="h-3 w-3 shrink-0" />
          <span className="truncate">{name ?? t('codeMode.off')}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px]">
        <div className="px-2 py-1.5 text-[12px] font-semibold text-[var(--text)]">
          {t('codeMode.title')}
        </div>
        <div className="flex flex-col gap-1.5 px-2 pb-1.5 text-[11.5px] text-[var(--text2)]">
          {folder ? (
            <>
              <p className="break-all font-medium text-[var(--text)]">{folder}</p>
              <p>{t('codeMode.onDesc')}</p>
            </>
          ) : (
            <p>{t('codeMode.offDesc')}</p>
          )}
          {error && <p className="break-all text-red-600">{error}</p>}
          {busy && <p className="text-[var(--text3)]">{t('codeMode.busy')}</p>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                void pick()
              }}
              className="rounded-[8px] border border-[var(--line)] bg-white px-2.5 py-1 text-[11.5px] text-[var(--text)] hover:bg-black/[.03] disabled:opacity-50"
            >
              {folder ? t('codeMode.change') : t('codeMode.pick')}
            </button>
            {folder && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  void clear()
                }}
                className="rounded-[8px] px-2.5 py-1 text-[11.5px] text-[var(--text2)] hover:bg-black/[.04] hover:text-[var(--text)] disabled:opacity-50"
              >
                {t('codeMode.turnOff')}
              </button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
