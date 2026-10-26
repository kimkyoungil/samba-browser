// AI 가 그린 그림(Codex image_generation)을 답 글에 싣는 주소. 그림 파일은 노든 앱 데이터 폴더에만 있고,
// 화면은 이 주소를 만나면 메인에게 그 파일을 읽어 달라고 한다(바깥 주소·임의 경로는 열지 않는다)

export const GENERATED_IMAGE_PREFIX = 'noden-image://'

// 노든이 붙이는 파일 이름 꼴(무작위 UUID + 그림 확장자). 이 꼴이 아니면 읽지 않는다
const NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$/i

/** 파일 이름이 노든이 붙인 꼴인가 */
export function isGeneratedImageName(name: string): boolean {
  return NAME_RE.test(name)
}

/** 'noden-image://이름' 이면 이름, 아니면 null */
export function generatedImageName(url: string): string | null {
  if (!url.startsWith(GENERATED_IMAGE_PREFIX)) return null
  const name = url.slice(GENERATED_IMAGE_PREFIX.length)
  return isGeneratedImageName(name) ? name : null
}

/** 답 글에 싣는 그림 한 줄(마크다운) */
export function generatedImageMarkdown(name: string, alt = '생성한 그림'): string {
  return `![${alt}](${GENERATED_IMAGE_PREFIX}${name})`
}
