// 剪贴板复制工具：优先 navigator.clipboard，失败回退到 document.execCommand。
// 抽离自 ScreenshotResult.tsx 的 tryLegacyCopy + handleCopy。

function tryLegacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export function copyToClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard) {
    return Promise.resolve(tryLegacyCopy(text))
  }
  return navigator.clipboard.writeText(text)
    .then(() => true)
    .catch(() => tryLegacyCopy(text))
}

export async function readClipboardText(): Promise<string> {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText()
  } catch {
    /* ignore */
  }
  return ''
}
