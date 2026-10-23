// AI 답 글(MarkdownText)을 그리는 remark 플러그인 묶음.
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkBreaks from 'remark-breaks'

/**
 * - remark-gfm: 표·취소선·자동 링크
 * - remark-cjk-friendly: 한글 바로 앞뒤의 강조 — 표준 마크다운은 `**"상태: 삭제됨"**입니다` 처럼 굵게가
 *   문장부호로 끝나고 한글이 바로 붙으면 닫는 표식으로 보지 않아 `**` 가 그대로 보였다(실기 2026-10-24)
 * - remark-breaks: 한 줄 바꿈도 줄바꿈으로(종전 화면 pre-wrap 과 같게)
 */
export const MARKDOWN_PLUGINS = [remarkGfm, remarkCjkFriendly, remarkBreaks]
