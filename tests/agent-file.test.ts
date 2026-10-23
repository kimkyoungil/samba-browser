// 대화창에 끌어다 놓은 파일 — 검증·읽기·PDF 문서 블록
import { describe, it, expect } from 'vitest'
import {
  AGENT_FILE_MAX_COUNT,
  AGENT_TEXT_FILE_MAX_CHARS,
  filesNote,
  isTextFileName,
  parseAgentFiles,
  textFilesBlock,
  type AgentFile
} from '../src/shared/agent-file'
import { decodeText, readDroppedFile } from '../src/renderer/src/lib/drop-file'
import { promptInputOf } from '../src/main/agent/provider'

describe('첨부 파일 — 검증', () => {
  it('글 파일·PDF 를 받고, 개수·크기·모양이 어긋나면 통째로 거절한다', () => {
    const ok: AgentFile[] = [
      { kind: 'text', name: '주문.csv', text: 'a,b\n1,2' },
      { kind: 'pdf', name: '견적.pdf', data: 'JVBERi0xLjQK' }
    ]
    expect(parseAgentFiles(ok)).toEqual(ok)
    expect(parseAgentFiles(undefined)).toEqual([])
    const many = Array.from({ length: AGENT_FILE_MAX_COUNT + 1 }, (_, i) => ({
      kind: 'text',
      name: `${i}.txt`,
      text: 'x'
    }))
    expect(parseAgentFiles(many)).toBeNull()
    expect(
      parseAgentFiles([
        { kind: 'text', name: 'big.txt', text: 'x'.repeat(AGENT_TEXT_FILE_MAX_CHARS + 1) }
      ])
    ).toBeNull()
    expect(parseAgentFiles([{ kind: 'pdf', name: 'x.pdf', data: '<<not base64>>' }])).toBeNull()
    expect(parseAgentFiles([{ kind: 'exe', name: 'x.exe', data: 'AAAA' }])).toBeNull()
    expect(parseAgentFiles([{ kind: 'text', name: '', text: 'x' }])).toBeNull()
  })

  it('글 파일은 지시문 뒤에 이름과 함께 붙고, 기록에는 이름만 남는다', () => {
    const files: AgentFile[] = [
      { kind: 'text', name: 'a.csv', text: '상품,가격' },
      { kind: 'pdf', name: 'b.pdf', data: 'AAAA' }
    ]
    const block = textFilesBlock(files)
    expect(block).toContain('[첨부 파일: a.csv]\n상품,가격\n[첨부 파일 끝: a.csv]')
    expect(block).not.toContain('b.pdf')
    expect(filesNote(files)).toBe('\n📎 a.csv, b.pdf')
    expect(filesNote([])).toBe('')
    expect(isTextFileName('주문.CSV')).toBe(true)
    expect(isTextFileName('표.xlsx')).toBe(false)
  })
})

describe('첨부 파일 — 읽기', () => {
  it('UTF-8 은 그대로, 엑셀이 저장한 EUC-KR CSV 도 한글로 읽는다', () => {
    expect(decodeText(new TextEncoder().encode('상품,가격'))).toBe('상품,가격')
    // '상품' 의 EUC-KR 바이트
    const euckr = new Uint8Array([0xbb, 0xf3, 0xc7, 0xb0])
    expect(decodeText(euckr)).toBe('상품')
  })

  it('파일 종류대로 나눠 읽고, 못 읽는 형식·큰 파일은 이유를 돌려준다', async () => {
    const csv = await readDroppedFile(new File(['a,b'], '표.csv', { type: 'text/csv' }))
    expect(csv).toEqual({ file: { kind: 'text', name: '표.csv', text: 'a,b' } })
    const pdf = await readDroppedFile(
      new File(['%PDF-1.4'], '견적.pdf', { type: 'application/pdf' })
    )
    expect(pdf).toEqual({ file: { kind: 'pdf', name: '견적.pdf', data: btoa('%PDF-1.4') } })
    expect(await readDroppedFile(new File(['x'], '표.xlsx'))).toEqual({ error: 'unsupported' })
    const big = new File(['x'.repeat(AGENT_TEXT_FILE_MAX_CHARS + 1)], 'big.txt')
    expect(await readDroppedFile(big)).toEqual({ error: 'too-large' })
  })
})

describe('PDF 는 Claude 에 문서 블록으로', () => {
  it('문서·사진·글 순서로 한 메시지에 싣고, 첨부가 없으면 문자열 그대로', async () => {
    expect(promptInputOf('그냥 글')).toBe('그냥 글')
    const input = promptInputOf('요약해줘', undefined, [{ name: '견적.pdf', data: 'JVBERi0x' }])
    expect(typeof input).not.toBe('string')
    const messages = []
    for await (const m of input as AsyncIterable<{ message: { content: unknown[] } }>)
      messages.push(m)
    expect(messages[0].message.content).toEqual([
      {
        type: 'document',
        title: '견적.pdf',
        source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' }
      },
      { type: 'text', text: '요약해줘' }
    ])
  })
})
