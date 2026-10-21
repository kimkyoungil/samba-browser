import { useEffect, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { DaangnAccountDto } from '@shared/daangn'
import { cn } from '@renderer/lib/utils'
import { SecondaryButton, TextInput } from '@renderer/components/settings/shared'
import { useDaangnStore } from '@renderer/stores/daangnStore'

/** 지우기 확인 문구가 떠 있는 시간 */
const REMOVE_CONFIRM_MS = 4000

// 왼쪽 계정 패널 — "전체" 와 계정 줄(안 읽은 수 배지), 로그인 풀린 계정, 계정 추가
export function AccountPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const accounts = useDaangnStore((s) => s.accounts)
  const selected = useDaangnStore((s) => s.selectedAccountId)
  const select = useDaangnStore((s) => s.selectAccount)
  const addAccount = useDaangnStore((s) => s.addAccount)
  const total = accounts.reduce((n, a) => n + a.unread, 0)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')

  const submit = (): void => {
    const name = label.trim()
    setAdding(false)
    setLabel('')
    void addAccount(name)
  }

  return (
    <div className="flex w-[190px] shrink-0 flex-col border-r border-[var(--line)] bg-white">
      <div className="border-b border-[var(--line)] px-3 py-2.5 text-[13px] font-semibold text-[var(--text)]">
        {t('daangn.accounts')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Row active={selected === null} onClick={() => select(null)} unread={total}>
          {t('daangn.all')}
        </Row>
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            active={selected === a.id}
            onSelect={() => select(a.id)}
          />
        ))}
      </div>
      <div className="border-t border-[var(--line)] p-2.5">
        {adding ? (
          <div className="flex flex-col gap-1.5">
            <TextInput
              value={label}
              onChange={setLabel}
              placeholder={t('daangn.labelPlaceholder')}
              className="h-[30px]"
            />
            <div className="flex gap-1.5">
              <SecondaryButton className="h-[28px] flex-1" onClick={submit}>
                {t('daangn.add')}
              </SecondaryButton>
              <SecondaryButton className="h-[28px]" onClick={() => setAdding(false)}>
                {t('daangn.cancel')}
              </SecondaryButton>
            </div>
          </div>
        ) : (
          <SecondaryButton
            className="inline-flex h-[30px] w-full items-center justify-center gap-1"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('daangn.addAccount')}
          </SecondaryButton>
        )}
      </div>
    </div>
  )
}

function Row({
  active,
  onClick,
  unread,
  children
}: {
  active: boolean
  onClick: () => void
  unread: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 border-l-[3px] px-3 py-2 text-left text-[13px]',
        active
          ? 'border-[#ff6f0f] bg-[#fff4ec] font-semibold text-[var(--text)]'
          : 'border-transparent text-[var(--text)] hover:bg-[var(--bg2)]'
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <Badge n={unread} />
    </button>
  )
}

export function Badge({ n }: { n: number }): React.JSX.Element | null {
  if (n <= 0) return null
  return (
    <span className="shrink-0 rounded-full bg-[#ff6f0f] px-1.5 text-[11px] leading-[18px] text-white">
      {n > 99 ? '99+' : n}
    </span>
  )
}

function AccountRow({
  account,
  active,
  onSelect
}: {
  account: DaangnAccountDto
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const rename = useDaangnStore((s) => s.renameAccount)
  const remove = useDaangnStore((s) => s.removeAccount)
  const relogin = useDaangnStore((s) => s.relogin)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(account.label)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), REMOVE_CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  if (editing) {
    const commit = (): void => {
      setEditing(false)
      const next = draft.trim()
      if (next && next !== account.label) void rename(account.id, next)
    }
    return (
      <div className="px-2 py-1.5">
        <input
          autoFocus
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          className="h-[28px] w-full rounded-[7px] border border-[var(--line)] px-2 text-[13px] outline-none focus:border-[var(--text)]"
        />
      </div>
    )
  }

  const stateNote =
    account.state === 'expired'
      ? t('daangn.relogin')
      : account.state === 'read_failed'
        ? t('daangn.readFailed')
        : account.state === 'loading'
          ? t('daangn.loading')
          : null

  return (
    <div
      className={cn(
        'group flex items-center gap-1 border-l-[3px] pr-1.5',
        active ? 'border-[#ff6f0f] bg-[#fff4ec]' : 'border-transparent hover:bg-[var(--bg2)]'
      )}
    >
      <button
        type="button"
        onClick={account.state === 'expired' ? () => void relogin(account.id) : onSelect}
        className="flex min-w-0 flex-1 flex-col px-2.5 py-1.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[13px]', active && 'font-semibold')}>
            {account.label}
          </span>
          <Badge n={account.unread} />
        </span>
        {stateNote && (
          <span
            className={cn(
              'text-[11px]',
              account.state === 'expired' ? 'text-[#b91c1c]' : 'text-[var(--text2)]'
            )}
          >
            {stateNote}
          </span>
        )}
      </button>
      <span className="hidden shrink-0 items-center group-hover:flex">
        <button
          type="button"
          title={t('daangn.rename')}
          onClick={() => {
            setDraft(account.label)
            setEditing(true)
          }}
          className="rounded p-1 text-[var(--text2)] hover:text-[var(--text)]"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          title={confirming ? t('daangn.removeConfirm') : t('daangn.remove')}
          onClick={() => (confirming ? void remove(account.id) : setConfirming(true))}
          className={cn(
            'rounded p-1 hover:text-[var(--text)]',
            confirming ? 'text-[#b91c1c]' : 'text-[var(--text2)]'
          )}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    </div>
  )
}
