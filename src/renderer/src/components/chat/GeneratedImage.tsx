import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'

// 읽어 온 그림(data URL)을 이름별로 기억한다 — 말풍선을 다시 그릴 때마다 메인에 묻지 않게
const cache = new Map<string, string | null>()

// AI(Codex)가 그린 그림 한 장. 메인이 앱 데이터 폴더에서 읽어 준 그림을 그리고, [저장]으로 원하는 곳에 둔다
export function GeneratedImage({ name, alt }: { name: string; alt: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null | undefined>(cache.get(name))
  useEffect(() => {
    if (cache.has(name)) return
    let alive = true
    void window.samba.generatedImages?.read(name).then((r) => {
      const url = r?.ok ? r.data : null
      cache.set(name, url)
      if (alive) setSrc(url)
    })
    return () => {
      alive = false
    }
  }, [name])
  if (src === undefined)
    return (
      <span className="my-1 block h-40 w-full max-w-[320px] animate-pulse rounded-lg bg-black/5" />
    )
  if (src === null)
    return <span className="text-[12px] text-[var(--text3)]">{t('chat.imageMissing')}</span>
  return (
    <span className="group/img relative my-1 block w-fit max-w-full">
      <img
        src={src}
        alt={alt}
        className="block max-h-[420px] max-w-full rounded-lg border border-[var(--line)]"
      />
      <button
        type="button"
        onClick={() => void window.samba.generatedImages?.save(name)}
        aria-label={t('chat.imageSave')}
        title={t('chat.imageSave')}
        className="absolute right-1.5 top-1.5 flex h-7 items-center gap-1 rounded-md bg-white/90 px-2 text-[11.5px] text-[var(--text)] opacity-0 shadow-sm transition-opacity group-hover/img:opacity-100"
      >
        <Download className="h-3.5 w-3.5" />
        {t('chat.imageSave')}
      </button>
    </span>
  )
}
