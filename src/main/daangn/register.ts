// 당근 채팅함 IPC 등록. handlers.ts 가 이 함수 하나만 부르면 되도록 묶어 두었다.
// electron 을 직접 import 하지 않고 등록 함수를 주입받아 테스트 가능하게 남긴다

import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  DAANGN_TEMPLATE_MAX,
  type DaangnAccountDto,
  type DaangnBounds,
  type DaangnChannelDto,
  type DaangnTemplateDto
} from '../../shared/daangn'
import type { DaangnRepo } from './repo'
import type { DaangnService } from './service'

export interface DaangnIpcDeps {
  /** 렌더러 전용 invoke 채널 등록(발신자 검증 + {ok,data} 포장) */
  handle: <A extends unknown[], T>(channel: string, fn: (...args: A) => T | Promise<T>) => void
  /** 발신자 창을 함께 넘기는 invoke 채널 등록 */
  handleWin: <A extends unknown[], T>(
    channel: string,
    fn: (win: BrowserWindow, ...args: A) => T | Promise<T>
  ) => void
  service: DaangnService
  repo: DaangnRepo
}

function asId(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new Error('잘못된 id 예요')
  return v
}

function asText(v: unknown, max: number): string {
  if (typeof v !== 'string') throw new Error('글이 아니에요')
  if (v.length > max) throw new Error(`${max}자까지예요`)
  return v
}

/** 렌더러가 보낸 영역 — 숫자 네 개가 유한해야 한다. null 은 뷰 접기 */
function asBounds(v: unknown): DaangnBounds | null {
  if (v === null) return null
  const b = v as Partial<DaangnBounds>
  const nums = [b?.x, b?.y, b?.width, b?.height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('영역 값이 잘못됐어요')
  }
  return v as DaangnBounds
}

export function registerDaangnIpc(deps: DaangnIpcDeps): void {
  const { handle, handleWin, service, repo } = deps
  handle(IPC.daangnAccountsList, (): DaangnAccountDto[] => service.snapshot().accounts)
  handle(IPC.daangnChannelsList, (): DaangnChannelDto[] => service.snapshot().channels)
  handle(IPC.daangnAccountAdd, (label: unknown) => service.addAccount(asText(label ?? '', 40)))
  handle(IPC.daangnAccountRemove, (id: unknown) => service.removeAccount(asId(id)))
  handle(IPC.daangnAccountSetLabel, (id: unknown, label: unknown) =>
    service.renameAccount(asId(id), asText(label, 40))
  )
  handle(IPC.daangnAccountRelogin, (id: unknown) => service.relogin(asId(id)))
  handle(IPC.daangnRoomOpen, (accountId: unknown, roomId: unknown) =>
    service.openRoom(asId(accountId), asText(roomId, 200))
  )
  // 영역을 보낸 창을 알아야 여러 창 중 사용자가 보는 창에 뷰를 붙인다
  handleWin(IPC.daangnRoomBounds, (win: BrowserWindow, b: unknown) =>
    service.setRoomBounds(asBounds(b), win)
  )
  handle(IPC.daangnRoomClose, () => service.closeRoom())
  handle(IPC.daangnRoomFill, (accountId: unknown, text: unknown) =>
    service.fillText(asId(accountId), asText(text, DAANGN_TEMPLATE_MAX))
  )
  handle(IPC.daangnTemplatesList, (): DaangnTemplateDto[] => repo.listTemplates())
  handle(IPC.daangnTemplateSave, (input: unknown): DaangnTemplateDto => {
    const o = (input ?? {}) as { id?: unknown; text?: unknown }
    return repo.saveTemplate({
      ...(o.id === undefined ? {} : { id: asId(o.id) }),
      text: asText(o.text, DAANGN_TEMPLATE_MAX + 100)
    })
  })
  handle(IPC.daangnTemplateDelete, (id: unknown) => repo.deleteTemplate(asId(id)))
  handle(IPC.daangnTemplatesReorder, (ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('순서 목록이 아니에요')
    repo.reorderTemplates(ids.map(asId))
  })
}
