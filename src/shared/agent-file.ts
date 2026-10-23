// AI 창에 끌어다 놓은 파일(사진 말고)을 메인으로 넘기는 모양.
//
// 글 파일(txt·csv·md·json …)은 렌더러가 글자로 읽어 보내고, 메인은 지시문 뒤에 붙여 모델에 넘긴다.
// PDF 는 base64 로 보내 Claude 에 문서 블록으로 싣는다(Codex 는 못 읽는다고 알린다).
// 대화 기록에는 파일 내용을 남기지 않고 이름만 남긴다 — 큰 파일이 대화·요약을 잡아먹지 않게

/** 글자로 읽어 지시문에 붙이는 확장자 */
export const AGENT_TEXT_FILE_EXTS = [
  'txt',
  'md',
  'csv',
  'tsv',
  'json',
  'log',
  'xml',
  'html',
  'htm',
  'yaml',
  'yml',
  'ini',
  'sql'
] as const

/** 글 파일 한 개 상한(글자 수) */
export const AGENT_TEXT_FILE_MAX_CHARS = 200_000
/** 한 번에 붙이는 글 파일 전체 상한(글자 수) — 문맥을 혼자 다 먹지 않게 */
export const AGENT_TEXT_FILES_TOTAL_MAX_CHARS = 300_000
/** PDF 한 개 상한(원본 바이트) */
export const AGENT_PDF_MAX_BYTES = 10 * 1024 * 1024
/** 한 번에 붙일 수 있는 파일 수(사진 제외) */
export const AGENT_FILE_MAX_COUNT = 5
/** 파일 이름 상한 */
const NAME_MAX = 120

export type AgentFile =
  | { kind: 'text'; name: string; text: string }
  /** data: base64 본문(data: 접두어 없음) */
  | { kind: 'pdf'; name: string; data: string }

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/** 파일 이름의 확장자(소문자). 없으면 빈 문자열 */
export function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function isTextFileName(name: string): boolean {
  return (AGENT_TEXT_FILE_EXTS as readonly string[]).includes(fileExt(name))
}

/** base64 문자열이 나타내는 원본 바이트 수 */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((data.length * 3) / 4) - padding
}

/**
 * IPC 로 들어온 값을 검증한다. 하나라도 어긋나면 null —
 * 일부만 골라 살리지 않는다(붙인 파일이 소리 없이 빠지면 모델이 엉뚱한 답을 한다)
 */
export function parseAgentFiles(raw: unknown): AgentFile[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > AGENT_FILE_MAX_COUNT) return null
  const out: AgentFile[] = []
  let textTotal = 0
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const f = item as Record<string, unknown>
    const name = typeof f.name === 'string' ? f.name.trim() : ''
    if (!name || name.length > NAME_MAX) return null
    if (f.kind === 'text') {
      if (typeof f.text !== 'string' || f.text.length > AGENT_TEXT_FILE_MAX_CHARS) return null
      textTotal += f.text.length
      if (textTotal > AGENT_TEXT_FILES_TOTAL_MAX_CHARS) return null
      out.push({ kind: 'text', name, text: f.text })
    } else if (f.kind === 'pdf') {
      if (typeof f.data !== 'string' || !BASE64_RE.test(f.data)) return null
      if (base64Bytes(f.data) > AGENT_PDF_MAX_BYTES) return null
      out.push({ kind: 'pdf', name, data: f.data })
    } else return null
  }
  return out
}

/** 글 파일들을 지시문 뒤에 붙일 덩어리. 글 파일이 없으면 빈 문자열 */
export function textFilesBlock(files: readonly AgentFile[]): string {
  const parts = files
    .filter((f): f is Extract<AgentFile, { kind: 'text' }> => f.kind === 'text')
    .map((f) => `[첨부 파일: ${f.name}]\n${f.text}\n[첨부 파일 끝: ${f.name}]`)
  return parts.length === 0 ? '' : `\n\n${parts.join('\n\n')}`
}

/** 대화 기록에 남길 한 줄(이름만). 파일이 없으면 빈 문자열 */
export function filesNote(files: readonly AgentFile[]): string {
  return files.length === 0 ? '' : `\n📎 ${files.map((f) => f.name).join(', ')}`
}
