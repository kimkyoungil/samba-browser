import { useEffect, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Monitor, MonitorOff, Pencil, Trash2 } from 'lucide-react'
import type { PhoneDto, ScreenMode } from '@shared/phone'
import { cn } from '@renderer/lib/utils'
import { SecondaryButton, StatusBadge } from '@renderer/components/settings/shared'
import { usePhoneStore } from '@renderer/stores/phoneStore'
import { PhoneScreenView } from './PhoneScreenView'
import {
  canRecover,
  countryBadge,
  isPhoneDimmed,
  phoneStateDotClass,
  phoneStateLabelKey,
  phoneStateTone,
  screenBadgeKey,
  transportLabelKey
} from './phone-view'

/** 지우기 확인 문구가 떠 있는 시간 */
const REMOVE_CONFIRM_MS = 4000

// 폰 카드 한 장. 접혀 있으면 요약만, 펼치면 화면과 수동 조작 패드까지 보여 준다.
// 인증 대기 중인 폰은 자동으로 펼쳐지고 테두리가 강조된다
export function PhoneCard({
  phone,
  expanded,
  highlighted,
  screenMode,
  onToggle,
  onMove,
  canMoveBack = false,
  canMoveForward = false
}: {
  phone: PhoneDto
  expanded: boolean
  highlighted: boolean
  screenMode: ScreenMode | null
  onToggle: () => void
  /** 카드 자리 옮기기(-1 앞으로 · +1 뒤로). 없으면 화살표를 그리지 않는다 */
  onMove?: (dir: -1 | 1) => void
  canMoveBack?: boolean
  canMoveForward?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const recover = usePhoneStore((s) => s.recover)
  const remove = usePhoneStore((s) => s.remove)
  const setLabel = usePhoneStore((s) => s.setLabel)
  // 별칭 바로 고치기 — 이름을 누르거나 연필을 누르면 입력칸으로 바뀐다. Enter·칸 벗어나면 저장, Esc 는 취소
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(phone.label)
  const startEdit = (): void => {
    setDraft(phone.label)
    setEditing(true)
  }
  const commitEdit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== phone.label) void setLabel(phone.id, next, phone.country)
  }
  // 지우기는 두 번 눌러야 한다. 첫 번째는 확인 문구로 바뀌고, 몇 초 안에 다시 누르지 않으면 되돌아간다
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  useEffect(() => {
    if (!confirmingRemove) return
    const timer = setTimeout(() => setConfirmingRemove(false), REMOVE_CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirmingRemove])
  const onRemoveClick = (): void => {
    if (!confirmingRemove) return setConfirmingRemove(true)
    setConfirmingRemove(false)
    void remove(phone.id)
  }
  const dimmed = isPhoneDimmed(phone.state)
  const badge = screenBadgeKey(screenMode ?? phone.screenMode)

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-white p-4',
        dimmed && 'opacity-50',
        highlighted && 'ring-2 ring-black/70'
      )}
    >
      {/* 머리글은 이름·모델만 보여 준다. 화면은 아래 '화면 보기' 버튼으로 연다 —
          모델명을 눌러야 열린다는 걸 알기 어려웠다(사용자 요청) */}
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', phoneStateDotClass(phone.state))} />
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  else if (e.key === 'Escape') setEditing(false)
                }}
                placeholder={t('phone.labelPlaceholder')}
                maxLength={40}
                className="h-[26px] min-w-0 flex-1 rounded-[7px] border border-[var(--line)] px-2 text-[13px] font-semibold text-[var(--text)] outline-none focus:border-[var(--text)]"
              />
            ) : (
              <button
                type="button"
                onClick={startEdit}
                title={t('phone.editLabel')}
                className="group inline-flex min-w-0 items-center gap-1 text-left"
              >
                <span className="truncate text-[13px] font-semibold text-[var(--text)]">
                  {phone.label || phone.serial}
                </span>
                <Pencil className="h-3 w-3 shrink-0 text-[var(--text2)] opacity-60 group-hover:opacity-100" />
              </button>
            )}
            <StatusBadge label={countryBadge(phone.country)} />
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text2)]">
            {phone.model || phone.serial}
          </span>
        </span>
        {onMove && (
          <span className="flex shrink-0 items-center gap-0.5">
            {/* 자리 옮기기 — 끌어 옮기기가 어려운 때를 위한 화살표 */}
            <button
              type="button"
              disabled={!canMoveBack}
              onClick={() => onMove(-1)}
              title={t('phone.moveBack')}
              className="rounded-[6px] p-1 text-[var(--text2)] hover:bg-[var(--bg2)] hover:text-[var(--text)] disabled:opacity-25 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!canMoveForward}
              onClick={() => onMove(1)}
              title={t('phone.moveForward')}
              className="rounded-[6px] p-1 text-[var(--text2)] hover:bg-[var(--bg2)] hover:text-[var(--text)] disabled:opacity-25 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge
          label={t(phoneStateLabelKey(phone.state))}
          tone={phoneStateTone(phone.state)}
        />
        <StatusBadge label={t(transportLabelKey(phone.transport))} />
        {badge && <StatusBadge label={t(badge)} />}
      </div>

      {highlighted && (
        <p className="rounded-[9px] border border-dashed border-[var(--text)] px-2.5 py-2 text-[11.5px] text-[var(--text)]">
          {t('phone.authWaiting')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <SecondaryButton
          className="inline-flex h-[30px] items-center gap-1"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? (
            <MonitorOff className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Monitor className="h-3.5 w-3.5 shrink-0" />
          )}
          {t(expanded ? 'phone.hideScreen' : 'phone.showScreen')}
        </SecondaryButton>
        {canRecover(phone.state) && (
          <SecondaryButton className="h-[30px]" onClick={() => void recover(phone.serial)}>
            {t('phone.recover')}
          </SecondaryButton>
        )}
        {/* 늘 보이는 버튼이다 — 마우스를 올려야 나오는 X 는 있는 줄도 몰랐다(사용자 요청).
            잘못 누르기 쉬운 자리라 한 번 더 눌러야 지워진다 */}
        <SecondaryButton
          className={cn(
            'ml-auto inline-flex h-[30px] items-center gap-1',
            confirmingRemove && 'border-[#b91c1c] text-[#b91c1c]'
          )}
          onClick={onRemoveClick}
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0" />
          {t(confirmingRemove ? 'phone.removeConfirm' : 'phone.remove')}
        </SecondaryButton>
      </div>

      {expanded && <PhoneScreenView phone={phone} active={phone.state === 'online'} />}
    </section>
  )
}
