import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Pencil } from 'lucide-react'
import { useChatStore, type ChatMessage } from '@renderer/stores/chatStore'
import { CopyButton } from './CopyButton'

// 사용자 말풍선. 마우스를 올리면 [복사]·[고쳐 보내기]. 고치는 동안은 말풍선 자리에 입력칸이 열린다 —
// 보내면 이 말부터 뒤를 지우고 고친 글로 다시 보낸다(첨부는 그대로)
export function UserMessage({ m, busy }: { m: ChatMessage; busy: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const resend = useChatStore((s) => s.resend)
  // null 이면 보는 중, 글자가 있으면 고치는 중
  const [draft, setDraft] = useState<string | null>(null)
  const submit = (): void => {
    const text = draft?.trim()
    if (!text || busy) return
    setDraft(null)
    void resend(m.id, text)
  }
  if (draft !== null)
    return (
      <div className="flex w-[88%] flex-col gap-1.5 self-end">
        <textarea
          value={draft}
          autoFocus
          aria-label={t('chat.edit')}
          rows={Math.min(8, draft.split('\n').length + 1)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중의 Enter 는 글자 확정이다 — 보내지 않는다
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') setDraft(null)
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          className="w-full resize-none rounded-2xl border border-[var(--line)] bg-white px-3 py-2 leading-relaxed outline-none focus:border-[var(--text2)]"
        />
        <div className="flex justify-end gap-1.5 text-[12px]">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded-full px-3 py-1 text-[var(--text2)] hover:bg-black/5"
          >
            {t('chat.editCancel')}
          </button>
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={submit}
            className="rounded-full bg-[var(--text)] px-3 py-1 text-white disabled:opacity-40"
          >
            {t('chat.editSend')}
          </button>
        </div>
      </div>
    )
  return (
    <div className="group flex max-w-[88%] items-end gap-1 self-end">
      <div className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover:opacity-100">
        {/* 일하는 중에는 고칠 수 없다 — 끝난 실행이 지운 자리 뒤에 기록을 다시 남긴다 */}
        {!busy && (
          <button
            type="button"
            aria-label={t('chat.edit')}
            title={t('chat.edit')}
            onClick={() => setDraft(m.text)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text3)] hover:bg-black/5 hover:text-[var(--text)]"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {m.text && <CopyButton text={m.text} />}
      </div>
      <div className="min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-[4px] bg-[var(--text)] px-3 py-2 leading-relaxed text-white">
        {m.images && m.images.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {m.images.map((src, k) => (
              <img
                key={k}
                src={src}
                alt=""
                className="max-h-32 max-w-full rounded-lg object-contain"
              />
            ))}
          </div>
        )}
        {m.files && m.files.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {m.files.map((name, k) => (
              <span
                key={k}
                className="flex max-w-full items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[11.5px]"
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{name}</span>
              </span>
            ))}
          </div>
        )}
        {m.text}
      </div>
    </div>
  )
}
