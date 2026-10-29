// 엑셀(xlsx) 첨부 — 시트마다 표를 탭으로 나눈 글자로 바꿔 글 파일처럼 붙인다(Claude·Codex 둘 다 읽는다).
// 사장님 10/29 "LED온열기_칭찬일반_01_0001-0100.xlsx 은(는) 아직 못 읽는 형식이에요 — 이거 되게 해".
// 옛 엑셀(xls)은 이 부품이 못 읽어 그대로 '못 읽는 형식' 으로 둔다

import readExcelFile from 'read-excel-file/browser'
import { AGENT_TEXT_FILE_MAX_CHARS, fileExt } from '@shared/agent-file'

/** 엑셀로 읽는 확장자 */
export const SHEET_FILE_EXTS = ['xlsx', 'xlsm'] as const
/** 엑셀 파일 한 개 상한(원본 바이트) — 압축된 파일이라 글자보다 훨씬 작다 */
export const SHEET_FILE_MAX_BYTES = 15 * 1024 * 1024

export function isSheetFileName(name: string): boolean {
  return (SHEET_FILE_EXTS as readonly string[]).includes(fileExt(name))
}

type Cell = string | number | boolean | Date | null | undefined

/** 칸 하나 → 글자(줄바꿈·탭은 한 줄로 편다, 날짜는 YYYY-MM-DD 또는 시각까지) */
function cellText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    // 엑셀은 시각을 하루의 소수로 저장해 17:30 이 17:29:59.999 로 온다 — 초 단위로 반올림
    const iso = new Date(Math.round(v.getTime() / 1000) * 1000).toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ')
  }
  return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ⏎ ')
}

/**
 * 시트들 → 글자. 시트마다 '[시트: 이름] (N행 × M열)' 머리줄 다음에 줄마다 칸을 탭으로 잇는다.
 * 끝의 빈 줄은 뺀다. 상한을 넘으면 거기서 끊고 몇 줄을 뺐는지 적는다(소리 없이 잘리지 않게)
 */
export function sheetsToText(
  sheets: { sheet: string; data: Cell[][] }[],
  max = AGENT_TEXT_FILE_MAX_CHARS
): string {
  const out: string[] = []
  let used = 0
  for (const s of sheets) {
    const rows = s.data.map((r) => r.map(cellText))
    while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) rows.pop()
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0)
    const head = `[시트: ${s.sheet}] (${rows.length}행 × ${cols}열)`
    out.push(head)
    used += head.length + 1
    for (let i = 0; i < rows.length; i++) {
      // 줄 끝의 빈 칸은 떼어 낸다
      const cells = [...rows[i]]
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
      const line = cells.join('\t')
      if (used + line.length + 1 > max) {
        out.push(`…(시트 '${s.sheet}' 의 나머지 ${rows.length - i}행은 너무 길어 뺐습니다)`)
        return out.join('\n')
      }
      out.push(line)
      used += line.length + 1
    }
    out.push('')
    used += 1
  }
  return out.join('\n').trimEnd()
}

/** 엑셀 파일 하나를 글 첨부로 읽는다. 크면 'too-large', 못 읽으면 'unsupported' */
export async function readSheetFile(
  file: File
): Promise<{ kind: 'text'; name: string; text: string } | 'too-large' | 'unsupported'> {
  if (file.size > SHEET_FILE_MAX_BYTES) return 'too-large'
  try {
    const sheets = (await readExcelFile(file)) as { sheet: string; data: Cell[][] }[]
    return { kind: 'text', name: file.name, text: sheetsToText(sheets) }
  } catch {
    // 깨진 파일·암호 걸린 파일·xlsx 가 아닌 파일
    return 'unsupported'
  }
}
