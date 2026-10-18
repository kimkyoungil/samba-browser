// @vitest-environment jsdom
// 웹스토어가 크롬 전용 설치 기능이 없는 브라우저에서 'Chrome에 추가'를 disabled 로 막는다 — 훅이 다시 켠다
import { describe, it, expect } from 'vitest'
import { installWebstoreHook } from '../src/preload/page-webstore'

describe('installWebstoreHook — 막힌 추가 버튼 다시 켜기', () => {
  it('Chrome에 추가 버튼만 켜고, 페이지가 다시 막아도 다시 켠다', async () => {
    document.body.innerHTML =
      '<button id="add" disabled><span>Chrome에 추가</span></button><button id="other" disabled>공유</button>'
    installWebstoreHook({ install: () => {}, labels: () => ({ installing: '', done: '', failed: '' }) })
    const add = document.getElementById('add') as HTMLButtonElement
    expect(add.disabled).toBe(false)
    expect((document.getElementById('other') as HTMLButtonElement).disabled).toBe(true)
    add.disabled = true
    await new Promise((r) => setTimeout(r, 0))
    expect(add.disabled).toBe(false)
  })
})

describe('installWebstoreHook — 문서가 아직 비어 있을 때', () => {
  // 프리로드는 HTML 파싱 전에 돌아 document.documentElement 가 null 이다(2026-10-18 실기:
  // observe(null) 이 던져 프리로드 전체가 죽고 '추가' 버튼이 disabled 로 남았다)
  it('documentElement 가 null 이어도 던지지 않고, 나중에 생긴 버튼도 켠다', async () => {
    document.documentElement.remove()
    expect(document.documentElement).toBeNull()
    expect(() =>
      installWebstoreHook({ install: () => {}, labels: () => ({ installing: '', done: '', failed: '' }) })
    ).not.toThrow()
    const html = document.createElement('html')
    html.innerHTML = '<body><button id="late" disabled>Chrome에 추가</button></body>'
    document.appendChild(html)
    await new Promise((r) => setTimeout(r, 0))
    expect((document.getElementById('late') as HTMLButtonElement).disabled).toBe(false)
  })
})
