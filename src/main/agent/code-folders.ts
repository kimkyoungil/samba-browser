// 대화마다 고른 코드 작업 폴더. 폴더가 있는 대화는 '코드 작업 모드'로 돈다 — 코드 도구가 붙고,
// 비밀번호·결제·폰 도구는 빠진다(tools-code.ts).
//
// 왜 로컬 파일인가 — 폴더 경로는 이 PC 에만 맞는다(다른 PC 에는 같은 폴더가 없다). 대화별 AI 선택과 같이
// userData 의 파일 하나로 두고 동기화하지 않는다

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, parse, relative, sep } from 'node:path'

export class CodeFolderStore {
  private chats: Record<string, string> = {}
  // PC 잠금을 켠 대화 — AI 가 이 PC 의 파일을 하나도 못 보는 대화(코드 폴더와 함께 켜지지 않는다)
  private locked = new Set<string>()

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      const raw = (parsed as { chats?: unknown } | null)?.chats
      if (raw && typeof raw === 'object')
        for (const [k, v] of Object.entries(raw as Record<string, unknown>))
          if (/^[0-9]+$/.test(k) && typeof v === 'string' && isAbsolute(v)) this.chats[k] = v
      const locked = (parsed as { locked?: unknown } | null)?.locked
      if (Array.isArray(locked))
        for (const k of locked) if (typeof k === 'string' && /^[0-9]+$/.test(k)) this.locked.add(k)
    } catch {
      // 깨진 파일은 없는 것으로 본다 — 대화는 코드 모드·잠금 없이 돈다
      this.chats = {}
      this.locked = new Set()
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(
        this.file,
        JSON.stringify({ chats: this.chats, locked: [...this.locked] }, null, 1)
      )
    } catch (e: unknown) {
      console.error('코드 작업 폴더 저장 실패', e instanceof Error ? e.message : String(e))
    }
  }

  /** 그 대화의 작업 폴더. 없으면 null */
  get(chatId: number): string | null {
    return this.chats[String(chatId)] ?? null
  }

  set(chatId: number, folder: string): void {
    if (this.chats[String(chatId)] === folder) return
    this.chats[String(chatId)] = folder
    this.save()
  }

  clear(chatId: number): void {
    if (!(String(chatId) in this.chats)) return
    delete this.chats[String(chatId)]
    this.save()
  }

  /** 그 대화가 PC 잠금인가 */
  isLocked(chatId: number): boolean {
    return this.locked.has(String(chatId))
  }

  setLocked(chatId: number, locked: boolean): void {
    const id = String(chatId)
    if (this.locked.has(id) === locked) return
    if (locked) this.locked.add(id)
    else this.locked.delete(id)
    this.save()
  }

  /** 대화를 지울 때 — 폴더와 잠금 둘 다 */
  forget(chatId: number): void {
    const had = String(chatId) in this.chats || this.locked.has(String(chatId))
    delete this.chats[String(chatId)]
    this.locked.delete(String(chatId))
    if (had) this.save()
  }
}

const inside = (child: string, parent: string): boolean => {
  const rel = relative(parent.toLowerCase(), child.toLowerCase())
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * 코드 작업 폴더로 고를 수 없는 폴더면 그 까닭(사람이 읽는 말), 써도 되면 null.
 * 드라이브 맨 위·사용자 폴더 전체·그 위, 노든 데이터 폴더(금고 DB)와 그 위·안, 윈도우·프로그램 폴더는 막는다 —
 * AI 가 폴더 안의 모든 파일을 읽고 고칠 수 있게 되기 때문이다
 */
export function codeFolderRefusal(
  folder: string,
  o: { home: string; userData: string; windowsDir?: string; programDirs?: string[] }
): string | null {
  let real: string
  try {
    real = realpathSync.native(folder)
    if (!statSync(real).isDirectory()) return '폴더가 아니에요'
  } catch {
    return '폴더를 찾지 못했어요'
  }
  if (parse(real).root.toLowerCase() === real.toLowerCase())
    return '드라이브 맨 위는 고를 수 없어요'
  if (inside(o.home, real))
    return '사용자 폴더 전체(또는 그 위)는 고를 수 없어요 — 작업할 프로젝트 폴더를 골라 주세요'
  if (inside(o.userData, real) || inside(real, o.userData))
    return '노든 데이터 폴더는 고를 수 없어요'
  for (const sys of [o.windowsDir, ...(o.programDirs ?? [])])
    if (sys && inside(real, sys)) return '윈도우·프로그램 폴더는 고를 수 없어요'
  return null
}

/** 저장된 작업 폴더를 실제 경로로 푼다. 없어졌거나 폴더가 아니면 null */
export function liveCodeFolder(folder: string): string | null {
  try {
    const real = realpathSync.native(folder)
    return statSync(real).isDirectory() ? real : null
  } catch {
    return null
  }
}
