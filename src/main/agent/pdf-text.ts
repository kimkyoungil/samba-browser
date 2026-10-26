// PDF 에서 글자를 뽑는다 — PDF 를 첨부로 받지 못하는 AI(Codex)에 글로 넘긴다. unpdf(PDF.js 서버용 판)를 쓴다.
// 스캔본처럼 글자 층이 없는 PDF 는 빈 글이 나온다 — 그때는 호출부가 그 사실을 모델에게 알린다

// PDF 하나에서 지시문에 싣는 글자 상한. 넘으면 앞부분만 싣고 잘렸다고 적는다
export const PDF_TEXT_MAX = 100_000

export interface PdfText {
  text: string
  pages: number
  truncated: boolean
}

/** base64 PDF 의 글자. 깨졌거나 암호가 걸려 못 열면 null */
export async function pdfText(base64: string): Promise<PdfText | null> {
  let destroy: (() => Promise<void>) | null = null
  try {
    const { getDocumentProxy, extractText } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, 'base64')))
    destroy = () => pdf.loadingTask.destroy()
    const { totalPages, text } = await extractText(pdf, { mergePages: true })
    const all = (Array.isArray(text) ? text.join('\n') : text).trim()
    return {
      text: all.slice(0, PDF_TEXT_MAX),
      pages: totalPages,
      truncated: all.length > PDF_TEXT_MAX
    }
  } catch {
    return null
  } finally {
    await destroy?.().catch(() => undefined)
  }
}

/**
 * Codex 지시문에 붙일 PDF 글 묶음. 글자를 뽑았으면 '[첨부 PDF: 이름 (N쪽)]' 아래에 싣고,
 * 못 뽑았으면(스캔본·암호·깨짐) 그 사실을 모델이 사용자에게 말하도록 적는다
 */
export async function pdfTextBlock(pdfs: { name: string; data: string }[]): Promise<string> {
  const parts: string[] = []
  for (const pdf of pdfs) {
    const got = await pdfText(pdf.data)
    if (got && got.text !== '')
      parts.push(
        `[첨부 PDF: ${pdf.name} (${got.pages}쪽)]\n${got.text}${got.truncated ? '\n…(이하 생략 — 너무 길어 앞부분만 실었습니다)' : ''}`
      )
    else
      parts.push(
        `(The user attached the PDF "${pdf.name}", but no text could be read from it — it may be a scanned image, encrypted or broken. Say so briefly and ask them to paste the text or attach the pages as images.)`
      )
  }
  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : ''
}
