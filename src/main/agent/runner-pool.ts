// 대화방별 실행기 묶음 — 대화방마다 AI 가 따로 동시에 일한다(사장님 10/28 "다른 채팅방에서 일하는 거랑
// 새 채팅방이랑 무슨 상관이야"). 예전엔 실행기가 앱 전체에 하나라 한 대화가 일하면 다른 대화는 줄 서야 했다.
// 실행기(AgentRunner)는 그대로 두고 대화마다 하나씩 만든다. 함께 쓰는 것은 둘뿐이다:
//  - 브라우저 차례(browser-turn.ts) — 브라우저·폰 도구만 한 번에 한 실행이 쓴다
//  - 브릿지(하네스) 세션 — 맨 처음 실행기가 맡는다. 세션이 열려 있으면 채팅 실행은 받지 않는다(예전과 같다)
// 화면으로 가는 이벤트에는 대화 번호(chatId)를 붙여, 화면이 대화마다 따로 그린다

import type { TabManager } from '../browser/tab-manager'
import type { SettingsStore } from '../settings/store'
import type { VaultService } from '../vault/service'
import type { ChatAgentEvent } from '../../shared/ipc'
import { AgentRunner } from './runner'
import { BrowserTurn } from './browser-turn'

/** 화면으로 가는 실행 이벤트 — 어느 대화의 것인지 붙는다(대화 없는 실행·브릿지는 없음) */
export type PooledAgentEvent = ChatAgentEvent

type RunnerArgs = Parameters<AgentRunner['run']>
type SessionArgs = Parameters<AgentRunner['createToolSession']>

// 실행기 설정(setXxx) — 대화 실행기를 새로 만들 때도 똑같이 건다
type Setup = (r: AgentRunner) => void

export class AgentRunnerPool {
  // 브릿지 세션·대화 없는 실행·페이지 대화상자 확인을 맡는 실행기(예전의 그 하나)
  private readonly main: AgentRunner
  private readonly chats = new Map<number, AgentRunner>()
  private readonly setups = new Map<string, Setup>()
  readonly browserTurn = new BrowserTurn()

  constructor(
    private readonly tabs: TabManager,
    private readonly settings: SettingsStore,
    private readonly emit: (e: PooledAgentEvent) => void,
    private readonly vault?: VaultService
  ) {
    this.main = new AgentRunner(tabs, settings, emit, vault)
    this.main.setBrowserTurn(this.browserTurn)
  }

  /** 이 대화의 실행기(없으면 만든다). 대화 없는 실행은 맨 처음 실행기 */
  private runnerFor(chatId: number | undefined): AgentRunner {
    if (chatId === undefined) return this.main
    let r = this.chats.get(chatId)
    if (!r) {
      r = new AgentRunner(this.tabs, this.settings, (e) => this.emit({ ...e, chatId }), this.vault)
      r.setBrowserTurn(this.browserTurn)
      r.setBridgeBusy(() => this.main.hasBridgeSession())
      for (const setup of this.setups.values()) setup(r)
      this.chats.set(chatId, r)
    }
    return r
  }

  private all(): AgentRunner[] {
    return [this.main, ...this.chats.values()]
  }

  /** 설정을 지금 있는 실행기 모두와 앞으로 만들 실행기에 건다(같은 설정은 마지막 값) */
  private configure(name: string, setup: Setup): void {
    this.setups.set(name, setup)
    for (const r of this.all()) setup(r)
  }

  setPhones(...a: Parameters<AgentRunner['setPhones']>): void {
    this.configure('phones', (r) => r.setPhones(...a))
  }
  setTranscript(...a: Parameters<AgentRunner['setTranscript']>): void {
    this.configure('transcript', (r) => r.setTranscript(...a))
  }
  setPlaybooks(...a: Parameters<AgentRunner['setPlaybooks']>): void {
    this.configure('playbooks', (r) => r.setPlaybooks(...a))
  }
  setPlaybookEditor(...a: Parameters<AgentRunner['setPlaybookEditor']>): void {
    this.configure('playbookEditor', (r) => r.setPlaybookEditor(...a))
  }
  setSiteScripts(...a: Parameters<AgentRunner['setSiteScripts']>): void {
    this.configure('siteScripts', (r) => r.setSiteScripts(...a))
  }
  setGeneratedImagesDir(...a: Parameters<AgentRunner['setGeneratedImagesDir']>): void {
    this.configure('generatedImagesDir', (r) => r.setGeneratedImagesDir(...a))
  }
  setCodexThreads(...a: Parameters<AgentRunner['setCodexThreads']>): void {
    this.configure('codexThreads', (r) => r.setCodexThreads(...a))
  }
  setChatSessions(...a: Parameters<AgentRunner['setChatSessions']>): void {
    this.configure('chatSessions', (r) => r.setChatSessions(...a))
  }
  setCodeFolders(...a: Parameters<AgentRunner['setCodeFolders']>): void {
    this.configure('codeFolders', (r) => r.setCodeFolders(...a))
  }
  setPcLocks(...a: Parameters<AgentRunner['setPcLocks']>): void {
    this.configure('pcLocks', (r) => r.setPcLocks(...a))
  }
  setEngineRouting(...a: Parameters<AgentRunner['setEngineRouting']>): void {
    this.configure('engineRouting', (r) => r.setEngineRouting(...a))
  }
  setAuthHealth(...a: Parameters<AgentRunner['setAuthHealth']>): void {
    this.configure('authHealth', (r) => r.setAuthHealth(...a))
  }
  setSiteMemory(...a: Parameters<AgentRunner['setSiteMemory']>): void {
    this.configure('siteMemory', (r) => r.setSiteMemory(...a))
  }
  setChatTitles(...a: Parameters<AgentRunner['setChatTitles']>): void {
    this.configure('chatTitles', (r) => r.setChatTitles(...a))
  }

  /** 이 대화에서 지시를 돌린다 — 다른 대화가 일하는 중이어도 바로 시작한다 */
  run(...a: RunnerArgs): ReturnType<AgentRunner['run']> {
    return this.runnerFor(a[1]).run(...a)
  }

  /** 이 대화의 실행에 말을 끼워 넣는다(그 대화가 일하는 중일 때만) */
  inject(...a: Parameters<AgentRunner['inject']>): string | null {
    const chatId = a[1]
    if (chatId === undefined) return this.main.inject(...a)
    return this.chats.get(chatId)?.inject(...a) ?? null
  }

  /** 그 대화의 일만 멈춘다(대화를 안 주면 대화 없는 실행). 다른 대화는 계속 돈다 */
  stop(chatId?: number): void {
    this.runnerFor(chatId).stop()
  }

  notifyNotStarted(message: string, chatId?: number): void {
    this.runnerFor(chatId).notifyNotStarted(message)
  }

  /** 확인·넘김 카드 응답 — 카드 번호를 가진 실행기만 받는다 */
  resolveConfirm(id: string, approved: boolean): void {
    for (const r of this.all()) r.resolveConfirm(id, approved)
  }

  /** 페이지 대화상자 확인 — 지금 브라우저를 쓰는 대화에 카드를 띄운다(없으면 맨 처음 실행기) */
  requestConfirm(...a: Parameters<AgentRunner['requestConfirm']>): Promise<boolean> {
    const holder = [...this.chats.values()].find((r) => r.holdsBrowserTurn()) ?? this.main
    return holder.requestConfirm(...a)
  }

  /** 어느 실행이든 돌거나 하네스 세션이 열려 있는가(유예 시간 포함 — 페이지 대화상자 자동 처리) */
  isRunning(): boolean {
    return this.all().some((r) => r.isRunning())
  }

  /** 어느 대화든 지금 실제로 도는가 */
  hasActiveRun(): boolean {
    return this.all().some((r) => r.hasActiveRun())
  }

  /** 이 대화의 실행이 뒷정리까지 끝나기를 기다린 뒤 아직 도는지 답한다(대화를 주지 않으면 전부) */
  async waitRunSettled(chatId?: number): Promise<boolean> {
    if (chatId !== undefined) return (await this.chats.get(chatId)?.waitRunSettled()) ?? false
    const busy = await Promise.all(this.all().map((r) => r.waitRunSettled()))
    return busy.some(Boolean)
  }

  forgetChatSession(chatId: number): void {
    // 세션·스레드 장부는 실행기들이 함께 쓴다 — 어느 실행기로 지워도 같다
    this.runnerFor(undefined).forgetChatSession(chatId)
  }

  /** 지운 대화의 실행기를 버린다(일하는 중이면 그대로 둔다) */
  dropChat(chatId: number): void {
    const r = this.chats.get(chatId)
    if (r && !r.hasActiveRun()) this.chats.delete(chatId)
  }

  saveRunningOnQuit(): void {
    for (const r of this.all()) r.saveRunningOnQuit()
  }

  /** 하네스(브릿지) 도구 세션 — 채팅 실행이 하나라도 돌면 만들지 않는다(예전과 같다) */
  createToolSession(...a: SessionArgs): ReturnType<AgentRunner['createToolSession']> {
    if ([...this.chats.values()].some((r) => r.hasActiveRun())) throw new Error('이미 실행 중')
    return this.main.createToolSession(...a)
  }
}
