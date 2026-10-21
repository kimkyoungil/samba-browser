import { useEffect } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { AccountPanel } from '@renderer/components/daangn/AccountPanel'
import { ChannelList } from '@renderer/components/daangn/ChannelList'
import { RoomPane } from '@renderer/components/daangn/RoomPane'
import { useDaangnStore } from '@renderer/stores/daangnStore'

// 당근 통합 채팅함 — 왼쪽 계정, 가운데 통합 목록, 오른쪽 방(메인의 네이티브 뷰가 올라온다)
export function DaangnPage(): React.JSX.Element {
  const { t } = useTranslation()
  const load = useDaangnStore((s) => s.load)
  const subscribe = useDaangnStore((s) => s.subscribe)

  useEffect(() => {
    void load()
    return subscribe()
  }, [load, subscribe])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="border-b border-[var(--line)] bg-white px-4 py-3">
        <div className="text-[16px] font-semibold text-[var(--text)]">{t('daangn.title')}</div>
        <div className="text-[12px] text-[var(--text2)]">{t('daangn.subtitle')}</div>
      </div>
      <div className="flex min-h-0 flex-1">
        <AccountPanel />
        <ChannelList />
        <RoomPane />
      </div>
    </div>
  )
}
