// Codex 가 그린 그림 모으기. Codex 의 그림 그리기(image_generation)는 결과 사건(JSON)에 그림을 싣지 않고
// `<CODEX_HOME>/generated_images/<스레드 id>/` 에 파일로만 남긴다(실기 codex-cli 0.160.1, 2026-10-26).
// 실행이 끝나면 이번 실행에 새로 생긴 파일을 노든 앱 데이터 폴더로 복사해 둔다 — Codex 쪽 폴더는 언제 정리될지 모른다

import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { isGeneratedImageName } from '../../shared/generated-image'

// 그림 파일 확장자
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
// 파일 시각과 실행 시작 시각의 어긋남을 봐준다(밀리초)
const CLOCK_SLACK_MS = 2000
// 화면으로 건네는 그림 한 장의 상한(바이트)
export const GENERATED_IMAGE_MAX_BYTES = 25 * 1024 * 1024

/** Codex 홈(CODEX_HOME, 없으면 ~/.codex) */
export function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
}

/**
 * 그 스레드에서 since(밀리초) 뒤에 생긴 그림을 destDir 로 복사하고, 새로 붙인 파일 이름들을 돌려준다(생긴 순서).
 * 폴더가 없거나 읽지 못하면 빈 배열 — 그림이 없는 평범한 실행이다
 */
export async function collectGeneratedImages(
  threadId: string,
  since: number,
  destDir: string,
  home: string = codexHome()
): Promise<string[]> {
  // 스레드 id 는 Codex 가 준 값이지만 경로에 쓰므로 꼴을 거른다
  if (!/^[0-9A-Za-z_-]{8,80}$/.test(threadId)) return []
  const dir = join(home, 'generated_images', threadId)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const fresh: { file: string; at: number }[] = []
  for (const file of files) {
    if (!IMAGE_EXTS.has(extname(file).toLowerCase())) continue
    try {
      const info = await stat(join(dir, file))
      if (info.isFile() && info.mtimeMs >= since - CLOCK_SLACK_MS)
        fresh.push({ file, at: info.mtimeMs })
    } catch {
      // 사라진 파일은 건너뛴다
    }
  }
  if (fresh.length === 0) return []
  await mkdir(destDir, { recursive: true })
  const names: string[] = []
  for (const { file } of fresh.sort((a, b) => a.at - b.at)) {
    const ext = extname(file).toLowerCase()
    const name = `${randomUUID()}${ext}`
    try {
      await copyFile(join(dir, file), join(destDir, name))
      names.push(name)
    } catch {
      // 복사 못 한 그림은 빼고 나머지를 싣는다
    }
  }
  return names
}

/** 앱 데이터 폴더의 그림을 data URL 로. 이름 꼴이 다르거나 없거나 너무 크면 null */
export async function readGeneratedImage(dir: string, name: string): Promise<string | null> {
  if (!isGeneratedImageName(name)) return null
  try {
    const path = join(dir, name)
    const info = await stat(path)
    if (!info.isFile() || info.size > GENERATED_IMAGE_MAX_BYTES) return null
    const bytes = await readFile(path)
    const ext = extname(name).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}
