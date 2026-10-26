import { useEffect, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useChatStore } from '@renderer/stores/chatStore'
import type { ChatImportPreview, ChatImportResult } from '@shared/ipc'

type Phase =
  | { kind: 'finding' }
  | { kind: 'none' }
  | { kind: 'ready'; preview: ChatImportPreview }
  | { kind: 'running'; preview: ChatImportPreview }
  | { kind: 'done'; result: ChatImportResult }
  | { kind: 'error'; message: string }

// Aside 대화 가져오기 — 열 때 붙고 닫으면 떨어진다(열 때마다 '찾는 중'부터). 메인이 Aside 내보내기 파일을
// 찾아 대화방·말 수를 먼저 보여 주고, [가져오기]를 눌러야 옮긴다. 못 찾으면 파일을 직접 고른다
export function ChatImportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const loadChats = useChatStore((s) => s.loadChats)
  const [phase, setPhase] = useState<Phase>({ kind: 'finding' })

  useEffect(() => {
    let alive = true
    void window.samba.chats.importFind().then((r) => {
      if (!alive) return
      if (!r.ok) setPhase({ kind: 'error', message: r.error })
      else setPhase(r.data ? { kind: 'ready', preview: r.data } : { kind: 'none' })
    })
    return () => {
      alive = false
    }
  }, [])

  const pick = async (): Promise<void> => {
    const r = await window.samba.chats.importPick()
    if (!r.ok) setPhase({ kind: 'error', message: r.error })
    else if (r.data) setPhase({ kind: 'ready', preview: r.data })
  }
  const run = async (preview: ChatImportPreview): Promise<void> => {
    setPhase({ kind: 'running', preview })
    const r = await window.samba.chats.importRun(preview.path)
    if (!r.ok) {
      setPhase({ kind: 'error', message: r.error })
      return
    }
    setPhase({ kind: 'done', result: r.data })
    await loadChats()
  }
  const running = phase.kind === 'running'

  return (
    // 옮기는 동안은 닫지 않는다(반쯤 옮긴 채 다시 누르는 일이 없게)
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-[420px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('chat.importAside')}</DialogTitle>
          <DialogDescription className="sr-only">{t('chat.importAside')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 text-[12.5px] text-[var(--text2)]">
          {phase.kind === 'finding' && <p>{t('chat.importFinding')}</p>}
          {phase.kind === 'none' && <p>{t('chat.importNone')}</p>}
          {(phase.kind === 'ready' || phase.kind === 'running') && (
            <PreviewLines preview={phase.preview} />
          )}
          {phase.kind === 'done' && (
            <p className="text-[14px] font-medium text-[var(--text)]">
              {doneText(t, phase.result)}
            </p>
          )}
          {phase.kind === 'error' && <p className="break-all text-red-600">{phase.message}</p>}
        </div>
        <DialogFooter className="sm:justify-between">
          {phase.kind === 'done' ? (
            <span />
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={running || phase.kind === 'finding'}
              onClick={() => void pick()}
            >
              {phase.kind === 'none' ? t('chat.importPickFirst') : t('chat.importPick')}
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={running} onClick={onClose}>
              {phase.kind === 'done' ? t('chat.importClose') : t('chat.importCancel')}
            </Button>
            {(phase.kind === 'ready' || phase.kind === 'running') && (
              <Button
                type="button"
                disabled={running || phase.preview.newMessages === 0}
                onClick={() => void run(phase.preview)}
              >
                {running ? t('chat.importRunning') : t('chat.importRun')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 미리 보기 — 숫자 먼저(대화방·말 수), 그다음 이번에 할 일, 기간, 파일 경로
function PreviewLines({ preview }: { preview: ChatImportPreview }): React.JSX.Element {
  const { t } = useTranslation()
  const plan = [
    preview.newChats > 0 ? t('chat.importPlanNew', { n: preview.newChats }) : null,
    preview.appendChats > 0 ? t('chat.importPlanAppend', { n: preview.appendChats }) : null,
    preview.newMessages > 0
      ? t('chat.importPlanMessages', { n: preview.newMessages.toLocaleString() })
      : t('chat.importNothing')
  ].filter((x): x is string => x !== null)
  return (
    <>
      <p className="text-[15px] font-semibold text-[var(--text)]">
        {t('chat.importCounts', {
          chats: preview.chats,
          messages: preview.messages.toLocaleString()
        })}
      </p>
      <p>{plan.join(' · ')}</p>
      {preview.from !== null && preview.to !== null && (
        <p className="text-[var(--text3)]">
          {day(preview.from)} ~ {day(preview.to)}
        </p>
      )}
      <p className="break-all text-[11px] text-[var(--text3)]">{preview.path}</p>
    </>
  )
}

function doneText(
  t: (key: string, vars?: Record<string, unknown>) => string,
  r: ChatImportResult
): string {
  return [
    r.createdChats > 0 ? t('chat.importDoneCreated', { n: r.createdChats }) : null,
    r.appendedChats > 0 ? t('chat.importDoneAppended', { n: r.appendedChats }) : null,
    t('chat.importDoneMessages', { n: r.messages.toLocaleString() }),
    r.images > 0 ? t('chat.importDoneImages', { n: r.images }) : null
  ]
    .filter((x): x is string => x !== null)
    .join(' · ')
}

function day(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
