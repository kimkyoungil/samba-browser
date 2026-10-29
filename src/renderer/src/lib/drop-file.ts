// 대화창에 끌어다 놓거나 붙여 넣은 파일을 첨부 모양으로 바꾼다.
// 사진은 기존 붙여넣기와 같은 AgentImage, PDF·글 파일은 AgentFile.

import type { AgentImage } from '@shared/agent-image'
import {
  AGENT_PDF_MAX_BYTES,
  AGENT_TEXT_FILE_MAX_CHARS,
  fileExt,
  isTextFileName,
  type AgentFile
} from '@shared/agent-file'
import { readAgentImage } from './paste-image'
import { isSheetFileName, readSheetFile } from './sheet-file'

export type DropFileError = 'too-large' | 'unsupported'
export type DropFileResult = { image: AgentImage } | { file: AgentFile } | { error: DropFileError }

/** DataTransfer(끌어 놓기·붙여넣기)에 든 파일 전부 */
export function filesOf(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) out.push(file)
  }
  return out
}

/**
 * 글 파일 바이트 → 글자. UTF-8 로 읽어 보고 깨지면 EUC-KR 로 다시 읽는다 —
 * 엑셀이 저장한 한글 CSV 는 대개 EUC-KR(CP949)이다. 앞의 BOM 은 떼어 낸다
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

function toBase64(bytes: Uint8Array): string {
  // 큰 배열을 한 번에 펼치면 호출 스택이 넘치므로 조각으로 나눠 문자열을 만든다
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** 파일 하나를 첨부로 읽는다. 형식이 아니거나 크면 오류 코드 */
export async function readDroppedFile(file: File): Promise<DropFileResult> {
  if (file.type.startsWith('image/')) {
    const r = await readAgentImage(file)
    return typeof r === 'string' ? { error: r } : { image: r }
  }
  if (file.type === 'application/pdf' || fileExt(file.name) === 'pdf') {
    if (file.size > AGENT_PDF_MAX_BYTES) return { error: 'too-large' }
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { file: { kind: 'pdf', name: file.name, data: toBase64(bytes) } }
  }
  // 엑셀은 시트마다 표를 글자로 바꿔 글 파일처럼 붙인다
  if (isSheetFileName(file.name)) {
    const r = await readSheetFile(file)
    return typeof r === 'string' ? { error: r } : { file: r }
  }
  if (isTextFileName(file.name)) {
    // 글자 수 상한보다 바이트가 4배 넘게 크면 읽기 전에 거른다(한글 UTF-8 은 한 글자 3바이트)
    if (file.size > AGENT_TEXT_FILE_MAX_CHARS * 4) return { error: 'too-large' }
    const text = decodeText(new Uint8Array(await file.arrayBuffer()))
    if (text.length > AGENT_TEXT_FILE_MAX_CHARS) return { error: 'too-large' }
    return { file: { kind: 'text', name: file.name, text } }
  }
  return { error: 'unsupported' }
}
