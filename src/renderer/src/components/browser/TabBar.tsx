import { useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { X, Plus } from 'lucide-react'
import { useBrowserStore } from '@renderer/stores/browserStore'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import { profileColor, profileTint } from '@renderer/lib/profile-color'
import { TAB_DRAG_MIME, isTabDrag, planDrop, shouldDetach } from '@renderer/lib/tab-drag'
import { ProfileMenu } from './ProfileMenu'

export function TabBar(): React.JSX.Element {
  const { t } = useTranslation()
  const { tabs, activateTab, closeTab, createTab } = useBrowserStore()
  // 탭 끌어 옮기기 — 끄는 탭(이 창의 것)과, 놓으면 들어갈 자리(그 탭 앞에 세로 줄로 표시).
  // 다른 창에서 끌어 온 탭은 React 상태로는 모르고 dataTransfer 의 글자(TAB_DRAG_MIME)로만 안다
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const endDrag = (): void => {
    setDragId(null)
    setDropIndex(null)
  }
  const shown = tabs.filter((tab) => tab.kind !== 'popup')
  const shownIds = shown.map((tab) => tab.id)

  /** 탭 바(탭 위든 빈 자리든)에 놓았을 때 — 같은 창이면 자리 바꾸기, 다른 창의 탭이면 받아 오기 */
  const dropAt = (e: React.DragEvent, index: number): void => {
    e.preventDefault()
    const draggedId = e.dataTransfer.getData(TAB_DRAG_MIME) || dragId
    if (draggedId) {
      const plan = planDrop(draggedId, shownIds, index)
      if (plan.kind === 'move') void window.samba.tabs.move(plan.tabId, plan.toIndex)
      else if (plan.kind === 'adopt') void window.samba.tabs.adopt(plan.tabId, plan.toIndex)
    }
    endDrag()
  }
  const allowDrop = (e: React.DragEvent): boolean => {
    if (!dragId && !isTabDrag(e.dataTransfer.types)) return false
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    return true
  }

  return (
    <div
      ref={barRef}
      className="flex items-end gap-1 px-2.5 pt-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      // 탭 바의 빈 자리(새 탭 버튼 옆)에 놓으면 맨 뒤로 — 탭 바 안에서 놓은 것은 새 창으로 떼지 않는다
      onDragOver={(e) => {
        if (allowDrop(e)) setDropIndex(shown.length)
      }}
      onDrop={(e) => dropAt(e, shown.length)}
    >
      {/* 팝업 창(결제창·주소 검색창)은 탭 바에 넣지 않는다 — 사이드바 "열린 탭"에만 배지로 보인다 */}
      {shown.map((tab, index) => {
        // 계정별 세션(프로필) 탭은 이름마다 고정된 색 띠·배지로 구분한다 — 어느 계정으로 로그인된 탭인지 한눈에
        const color = profileColor(tab.profile)
        return (
          <div
            key={tab.id}
            onClick={() => activateTab(tab.id)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', tab.id)
              // 다른 창의 탭 바가 받을 수 있게 탭 id 를 전용 형식으로도 싣는다
              e.dataTransfer.setData(TAB_DRAG_MIME, tab.id)
              setDragId(tab.id)
            }}
            onDragOver={(e) => {
              if (!allowDrop(e)) return
              e.stopPropagation()
              // 탭의 왼쪽 절반 위면 그 탭 앞, 오른쪽 절반 위면 그 탭 뒤
              const box = e.currentTarget.getBoundingClientRect()
              setDropIndex(e.clientX < box.left + box.width / 2 ? index : index + 1)
            }}
            onDrop={(e) => {
              e.stopPropagation()
              dropAt(e, dropIndex ?? index)
            }}
            onDragEnd={(e) => {
              // 아무 데도 받지 않은 채(페이지 위·바탕화면) 탭 바 밖에서 놓았으면 크롬처럼 새 창으로 뗀다.
              // 다른 창의 탭 바가 받았으면 dropEffect 가 move 라 여기서는 아무것도 하지 않는다
              const rect = barRef.current?.getBoundingClientRect() ?? null
              if (shouldDetach(e.dataTransfer.dropEffect, { x: e.clientX, y: e.clientY }, rect)) {
                void window.samba.tabs.detach(tab.id)
              }
              endDrag()
            }}
            title={color ? t('tab.profileOf', { profile: tab.profile }) : undefined}
            style={
              {
                WebkitAppRegion: 'no-drag',
                ...(color ? { boxShadow: `inset 0 3px 0 0 ${color}` } : {}),
                ...(dropIndex === index ? { borderLeft: '2px solid var(--text)' } : {}),
                ...(dropIndex === index + 1 && index === shown.length - 1
                  ? { borderRight: '2px solid var(--text)' }
                  : {})
              } as React.CSSProperties
            }
            className={cn(
              'flex max-w-[200px] items-center gap-2 rounded-t-lg px-2.5 pb-2 pt-1.5 text-[12.5px] text-[var(--text2)] cursor-default',
              tab.active && 'bg-[var(--bg)] font-medium text-[var(--text)]',
              dragId === tab.id && 'opacity-50'
            )}
          >
            <span className="truncate">{tab.title || tab.url}</span>
            {color && (
              <Badge
                variant="secondary"
                className="h-4 px-1.5 text-[10.5px]"
                style={{ color, backgroundColor: profileTint(tab.profile) ?? undefined }}
              >
                {tab.profile}
              </Badge>
            )}
            <X
              className="h-3.5 w-3.5 shrink-0 text-[var(--text3)] hover:text-[var(--text)]"
              onClick={(e) => {
                e.stopPropagation()
                void closeTab(tab.id)
              }}
            />
          </div>
        )
      })}
      <button
        title={t('tab.new')}
        onClick={() => createTab()}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="px-2 pb-2 pt-1.5 text-[var(--text3)]"
      >
        <Plus className="h-4 w-4" />
      </button>
      <ProfileMenu />
    </div>
  )
}
