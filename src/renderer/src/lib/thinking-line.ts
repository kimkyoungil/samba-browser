// 생각 과정 칸이 접힌 채로 보여 줄 마지막 한 줄(마크다운 굵게 표시는 걷어 낸다)
export function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/\*\*/g, '').trim()
    if (line) return line
  }
  return ''
}
