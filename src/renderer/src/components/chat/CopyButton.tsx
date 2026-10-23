import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'

// 복사 버튼(말풍선·코드 칸 공용). 앱 화면은 클립보드 권한이 막혀 있어 메인에 맡긴다. 눌렀으면 잠깐 체크 표시
export function CopyButton({
  text,
  className
}: {
  text: string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      aria-label={t('chat.copy')}
      title={copied ? t('chat.copied') : t('chat.copy')}
      onClick={() => {
        void window.samba.clipboard?.writeText(text).then((r) => {
          if (r.ok) setCopied(true)
        })
      }}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text3)] hover:bg-black/5 hover:text-[var(--text)] ${className ?? ''}`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}
