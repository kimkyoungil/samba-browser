import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, FolderCode, Globe, Lock } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'
import { useChatStore } from '@renderer/stores/chatStore'

type Mode = 'default' | 'folder' | 'lock'

// 이 대화의 PC 접근 — 셋 중 하나(대화마다 따로).
// 기본: 브라우저 일만(Codex 는 PC 파일을 읽을 수는 있다) · 코드 작업 폴더: 그 폴더 안에서만 읽기·고치기, 명령은 확인 카드 ·
// PC 잠금: AI 가 이 PC 의 파일을 하나도 못 본다(붙인 사진·파일과 웹페이지만). 단추는 지금 상태를 늘 보여 준다
export function CodeFolderMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const folder = useChatStore((s) => s.codeFolder)
  const locked = useChatStore((s) => s.pcLocked)
  const error = useChatStore((s) => s.codeFolderError)
  const pick = useChatStore((s) => s.pickCodeFolder)
  const clear = useChatStore((s) => s.clearCodeFolder)
  const setPcLock = useChatStore((s) => s.setPcLock)
  // 일하는 대화는 끝난 뒤에 바꾼다
  const busy = useChatStore((s) => s.status === 'running' && s.activeChatId === s.runChatId)
  const [open, setOpen] = useState(false)
  const mode: Mode = locked ? 'lock' : folder ? 'folder' : 'default'
  const name = folder ? (folder.split(/[\\/]/).filter(Boolean).pop() ?? folder) : null

  const choose = async (next: Mode): Promise<void> => {
    setOpen(false)
    if (next === 'folder') return pick()
    if (next === 'lock') return setPcLock(true)
    // 기본 — 폴더도 잠금도 없이
    if (locked) await setPcLock(false)
    if (folder) await clear()
  }

  const Trigger = mode === 'lock' ? Lock : FolderCode
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={folder ?? t('codeMode.title')}
          className={cn(
            'inline-flex max-w-[160px] items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
            mode === 'folder' &&
              'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/15',
            mode === 'lock' &&
              'border-[var(--text)]/30 bg-black/[.05] font-medium text-[var(--text)] hover:bg-black/[.08]',
            mode === 'default' &&
              'border-[var(--line)] bg-white text-[var(--text2)] hover:bg-black/[.03]'
          )}
        >
          <Trigger className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {mode === 'lock' ? t('codeMode.lockLabel') : (name ?? t('codeMode.off'))}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </PopoverTrigger>
      {/* 열 때 첫 항목(기본)에 초점 테두리가 생겨 선택된 것처럼 보이지 않게 자동 초점을 주지 않는다 */}
      <PopoverContent className="w-[300px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="px-2 py-1.5 text-[12px] font-semibold text-[var(--text)]">
          {t('codeMode.title')}
        </div>
        <div className="flex flex-col gap-0.5">
          <Option
            icon={Globe}
            selected={mode === 'default'}
            disabled={busy}
            title={t('codeMode.modeDefault')}
            desc={t('codeMode.modeDefaultDesc')}
            onClick={() => void choose('default')}
          />
          <Option
            icon={FolderCode}
            selected={mode === 'folder'}
            disabled={busy}
            title={folder ? `${t('codeMode.modeFolder')} · ${name}` : t('codeMode.modeFolder')}
            desc={folder ?? t('codeMode.modeFolderDesc')}
            action={folder ? t('codeMode.change') : t('codeMode.pick')}
            onClick={() => void choose('folder')}
          />
          <Option
            icon={Lock}
            selected={mode === 'lock'}
            disabled={busy}
            title={t('codeMode.modeLock')}
            desc={t('codeMode.modeLockDesc')}
            onClick={() => void choose('lock')}
          />
        </div>
        {(error || busy) && (
          <div className="px-2 pt-1.5 pb-1 text-[11.5px]">
            {error && <p className="break-all text-red-600">{error}</p>}
            {busy && <p className="text-[var(--text3)]">{t('codeMode.busy')}</p>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Option({
  icon: Icon,
  selected,
  disabled,
  title,
  desc,
  action,
  onClick
}: {
  icon: React.ElementType
  selected: boolean
  disabled: boolean
  title: string
  desc: string
  /** 오른쪽 작은 글(폴더 고르기·바꾸기) */
  action?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 rounded-[9px] px-2 py-1.5 text-left hover:bg-black/[.04] disabled:opacity-50',
        selected && 'bg-black/[.04]'
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text2)]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text)]">
          <span className="truncate">{title}</span>
          {action && (
            <span className="shrink-0 text-[11px] font-normal text-[var(--accent)]">{action}</span>
          )}
        </span>
        <span className="mt-0.5 block break-all text-[11px] leading-snug text-[var(--text3)]">
          {desc}
        </span>
      </span>
      {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text)]" />}
    </button>
  )
}
