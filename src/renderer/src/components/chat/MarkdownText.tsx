import type React from 'react'
import { useMemo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import { useUiStore } from '@renderer/stores/uiStore'
import { safeHref } from '@renderer/lib/safe-href'
import { MARKDOWN_PLUGINS } from '@renderer/lib/markdown-plugins'
import { hastText } from '@renderer/lib/hast-text'
import { CopyButton } from './CopyButton'

// AI 답 글을 서식(굵게·표·목록·링크·코드)대로 그린다.
// - 원시 HTML 은 그리지 않는다(react-markdown 기본) — 답에 섞인 태그가 앱 화면에서 실행되지 않는다
// - 링크는 http(s) 만 살리고, 누르면 이 브라우저의 새 탭으로 연다(앱 화면 자체가 그 주소로 넘어가지 않게)
// - 그림은 앱 화면에서 바깥 주소를 불러오지 않고 링크로만 보인다
// - 한 줄 바꿈도 줄바꿈으로 보이고, 한글에 붙은 굵게도 굵게 보인다(플러그인은 lib/markdown-plugins.ts)

export function MarkdownText({ text }: { text: string }): React.JSX.Element {
  const setView = useUiStore((s) => s.setView)
  const components = useMemo<Components>(() => {
    const open = (url: string): void => {
      void window.samba.tabs.create({ url })
      setView('browser')
    }
    return {
      a({ href, children }) {
        const url = href ? safeHref(href) : ''
        if (!url) return <span>{children}</span>
        return (
          <a
            href={url}
            title={url}
            onClick={(e) => {
              e.preventDefault()
              open(url)
            }}
          >
            {children}
          </a>
        )
      },
      // 코드 칸마다 [복사] — 마우스를 올리면 오른쪽 위에 나온다
      pre({ children, node }) {
        const code = hastText(node)
        return (
          <div className="group/code relative">
            <pre>{children}</pre>
            {code && (
              <CopyButton
                text={code}
                className="absolute right-1 top-1 bg-white/80 opacity-0 transition-opacity group-hover/code:opacity-100"
              />
            )}
          </div>
        )
      },
      img({ src, alt }) {
        const url = typeof src === 'string' ? safeHref(src) : ''
        const label = alt || url
        if (!url) return <span>{label}</span>
        return (
          <a
            href={url}
            title={url}
            onClick={(e) => {
              e.preventDefault()
              open(url)
            }}
          >
            {label}
          </a>
        )
      }
    }
  }, [setView])
  return (
    <div className="chat-md break-words">
      <Markdown remarkPlugins={MARKDOWN_PLUGINS} components={components} urlTransform={safeHref}>
        {text}
      </Markdown>
    </div>
  )
}
