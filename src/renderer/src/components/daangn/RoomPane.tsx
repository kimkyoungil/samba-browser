import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react'
import { DAANGN_TEMPLATE_MAX, type DaangnTemplateDto } from '@shared/daangn'

/** 이보다 좁으면 당근 채팅이 1단으로 바뀌어 메인이 뷰를 접는다(main/daangn/bounds.ts 와 같은 값) */
const MIN_ROOM_WIDTH = 640
import { PrimaryButton, SecondaryButton } from '@renderer/components/settings/shared'
import { useDaangnStore } from '@renderer/stores/daangnStore'
import { useUiStore } from '@renderer/stores/uiStore'

// 오른쪽 방 영역 — 위에 답변 템플릿 줄, 아래는 메인의 네이티브 뷰가 올라오는 자리.
// 이 div 의 위치·크기를 메인에 알리고, 대화상자가 떠 있으면(네이티브 뷰가 HTML 위를 덮으므로) 접는다
export function RoomPane(): React.JSX.Element {
  const { t } = useTranslation()
  const open = useDaangnStore((s) => s.open)
  const modalCount = useDaangnStore((s) => s.modalCount)
  const resizing = useUiStore((s) => s.resizing)
  const error = useDaangnStore((s) => s.error)
  const clearError = useDaangnStore((s) => s.clearError)
  const slot = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const el = slot.current
    if (!el) return
    // 대화상자가 떠 있거나 손잡이를 끄는 중이면 네이티브 뷰가 포인터를 가로채지 않게 접는다
    if (!open || modalCount > 0 || resizing) {
      void window.samba.daangn.setRoomBounds(null)
      return
    }
    const send = (): void => {
      const r = el.getBoundingClientRect()
      setNarrow(r.width < MIN_ROOM_WIDTH)
      void window.samba.daangn.setRoomBounds({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
    }
  }, [open, modalCount, resizing])

  // 화면을 떠나면 뷰를 숨기고 닫는다
  useEffect(() => {
    return () => {
      void window.samba.daangn.setRoomBounds(null)
      void window.samba.daangn.closeRoom()
    }
  }, [])

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--bg2)]">
      <TemplateBar canFill={!!open && open.roomId !== null} onEdit={() => setEditing(true)} />
      {error && (
        <div className="flex items-center gap-2 bg-[#fef2f2] px-3 py-1.5 text-[12px] text-[#b91c1c]">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={clearError} aria-label={t('daangn.close')}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div ref={slot} className="relative min-h-0 flex-1">
        {!open && (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-[var(--text2)]">
            {t('daangn.pickRoom')}
          </div>
        )}
        {open && narrow && (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-[var(--text2)]">
            {t('daangn.tooNarrow')}
          </div>
        )}
        {open && open.roomId === null && (
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-[#fff4ec] px-3 py-1.5 text-[12px] text-[#9a3c00]">
            {t('daangn.loginHint')}
          </div>
        )}
      </div>
      {editing && <TemplateDialog onClose={() => setEditing(false)} />}
    </div>
  )
}

function TemplateBar({
  canFill,
  onEdit
}: {
  canFill: boolean
  onEdit: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const templates = useDaangnStore((s) => s.templates)
  const fill = useDaangnStore((s) => s.fillTemplate)
  return (
    <div className="flex items-center gap-1.5 border-b border-[var(--line)] bg-white px-2.5 py-2">
      <span className="shrink-0 text-[12px] font-semibold text-[var(--text2)]">
        {t('daangn.templates')}
      </span>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {templates.length === 0 && (
          <span className="text-[12px] text-[var(--text2)]">{t('daangn.templateEmpty')}</span>
        )}
        {templates.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            disabled={!canFill}
            title={tpl.text}
            onClick={() => void fill(tpl.text)}
            className="h-[26px] max-w-[180px] shrink-0 truncate rounded-full border border-[var(--line)] px-3 text-[12px] text-[var(--text)] hover:bg-[var(--bg2)] disabled:opacity-40"
          >
            {tpl.text}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onEdit}
        title={t('daangn.templateEdit')}
        className="shrink-0 rounded p-1.5 text-[var(--text2)] hover:text-[var(--text)]"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// 템플릿 편집 대화상자 — 떠 있는 동안 네이티브 뷰를 접는다(modalCount)
function TemplateDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const templates = useDaangnStore((s) => s.templates)
  const save = useDaangnStore((s) => s.saveTemplate)
  const del = useDaangnStore((s) => s.deleteTemplate)
  const reorder = useDaangnStore((s) => s.reorderTemplates)
  const pushModal = useDaangnStore((s) => s.pushModal)
  const popModal = useDaangnStore((s) => s.popModal)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    pushModal()
    return popModal
  }, [pushModal, popModal])

  const add = (): void => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void save({ text })
  }
  const move = (tpl: DaangnTemplateDto, dir: -1 | 1): void => {
    const ids = templates.map((x) => x.id)
    const i = ids.indexOf(tpl.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    const a = ids[i]
    ids[i] = ids[j]
    ids[j] = a
    void reorder(ids)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="flex max-h-[80vh] w-[480px] flex-col rounded-[12px] bg-white shadow-xl">
        <div className="flex items-center border-b border-[var(--line)] px-4 py-3">
          <span className="flex-1 text-[14px] font-semibold">{t('daangn.templateTitle')}</span>
          <button type="button" onClick={onClose} aria-label={t('daangn.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {templates.length === 0 && (
            <div className="py-6 text-center text-[13px] text-[var(--text2)]">
              {t('daangn.templateEmpty')}
            </div>
          )}
          {templates.map((tpl) => (
            <TemplateRow
              key={tpl.id}
              tpl={tpl}
              onSave={(text) => void save({ id: tpl.id, text })}
              onDelete={() => void del(tpl.id)}
              onUp={() => move(tpl, -1)}
              onDown={() => move(tpl, 1)}
            />
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-[var(--line)] p-3">
          <textarea
            value={draft}
            maxLength={DAANGN_TEMPLATE_MAX}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('daangn.templatePlaceholder', { max: DAANGN_TEMPLATE_MAX })}
            rows={3}
            className="w-full resize-none rounded-[8px] border border-[var(--line)] p-2 text-[13px] outline-none focus:border-[var(--text)]"
          />
          <PrimaryButton
            className="inline-flex h-[32px] items-center justify-center gap-1"
            onClick={add}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('daangn.templateAdd')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

function TemplateRow({
  tpl,
  onSave,
  onDelete,
  onUp,
  onDown
}: {
  tpl: DaangnTemplateDto
  onSave: (text: string) => void
  onDelete: () => void
  onUp: () => void
  onDown: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState(tpl.text)
  useEffect(() => setText(tpl.text), [tpl.text])
  const dirty = text.trim() !== '' && text !== tpl.text
  const iconBtn = 'rounded p-1 text-[var(--text2)] hover:text-[var(--text)]'
  return (
    <div className="mb-2 flex gap-1.5">
      <textarea
        value={text}
        maxLength={DAANGN_TEMPLATE_MAX}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="min-w-0 flex-1 resize-none rounded-[8px] border border-[var(--line)] p-2 text-[13px] outline-none focus:border-[var(--text)]"
      />
      <div className="flex flex-col gap-1">
        <div className="flex gap-1">
          <button type="button" title={t('daangn.moveUp')} onClick={onUp} className={iconBtn}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" title={t('daangn.moveDown')} onClick={onDown} className={iconBtn}>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={t('daangn.templateDelete')}
            onClick={onDelete}
            className={iconBtn}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {dirty && (
          <SecondaryButton className="h-[24px] text-[12px]" onClick={() => onSave(text)}>
            {t('daangn.templateSave')}
          </SecondaryButton>
        )}
      </div>
    </div>
  )
}
