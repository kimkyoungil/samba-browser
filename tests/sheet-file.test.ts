// 엑셀(xlsx) 첨부 — 시트마다 표를 탭으로 나눈 글자로 바꿔 글 파일처럼 붙인다
// (사장님 10/29 "LED온열기_칭찬일반_01_0001-0100.xlsx 은(는) 아직 못 읽는 형식이에요 — 이거 되게 해")
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSheetFileName, readSheetFile, sheetsToText } from '../src/renderer/src/lib/sheet-file'
import { readDroppedFile } from '../src/renderer/src/lib/drop-file'

const sample = (): File =>
  new File([readFileSync(join(__dirname, 'fixtures', 'sheet-sample.xlsx'))], '리뷰_샘플.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })

describe('엑셀 첨부', () => {
  it('xlsx·xlsm 만 엑셀로 읽는다(옛 xls 는 아니다)', () => {
    expect(isSheetFileName('LED온열기_칭찬일반_01_0001-0100.xlsx')).toBe(true)
    expect(isSheetFileName('a.XLSM')).toBe(true)
    expect(isSheetFileName('a.xls')).toBe(false)
    expect(isSheetFileName('a.csv')).toBe(false)
  })

  it('시트마다 머리줄과 탭으로 나눈 줄 — 날짜는 날짜로, 줄바꿈·탭은 한 줄로 편다', async () => {
    const r = await readSheetFile(sample())
    expect(typeof r).toBe('object')
    const text = (r as { text: string }).text
    expect(text).toContain('[시트: 리뷰] (4행 × 4열)')
    expect(text).toContain('번호\t부위\t내용\t날짜')
    expect(text).toContain('1\t무릎\t따끈해서 좋아요\t2026-10-29')
    expect(text).toContain('2\t팔꿈치\t첫 줄 ⏎ 둘째 줄\t2026-10-29 17:30:00')
    expect(text).toContain('3\t\t탭 들어간 글')
    expect(text).toContain('[시트: 요약] (1행 × 2열)')
    expect(text).toContain('합계\t3')
  })

  it('끌어 놓은 엑셀은 글 파일 첨부가 된다(Claude·Codex 둘 다 읽는다)', async () => {
    const r = await readDroppedFile(sample())
    expect('file' in r && r.file.kind === 'text' && r.file.name === '리뷰_샘플.xlsx').toBe(true)
  })

  it('깨진 파일은 못 읽는 형식, 너무 긴 표는 끊고 뺀 줄 수를 적는다', async () => {
    const broken = new File([new Uint8Array([1, 2, 3, 4])], '깨짐.xlsx')
    expect(await readSheetFile(broken)).toBe('unsupported')
    const rows = Array.from({ length: 50 }, (_, i) => [i, 'x'.repeat(20)])
    const text = sheetsToText([{ sheet: '길다', data: rows }], 300)
    expect(text.length).toBeLessThanOrEqual(400)
    expect(text).toMatch(/…\(시트 '길다' 의 나머지 \d+행은 너무 길어 뺐습니다\)$/)
  })

  it('끝의 빈 줄·빈 칸은 뺀다', () => {
    const text = sheetsToText([
      {
        sheet: 'S',
        data: [
          ['a', 'b', null],
          [null, null, null]
        ]
      }
    ])
    expect(text).toBe('[시트: S] (1행 × 3열)\na\tb')
  })
})
