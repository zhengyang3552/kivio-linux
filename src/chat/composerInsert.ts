// 消息区「添加到聊天」→ 输入框 的单监听信道。
// 同一时刻只有一个活跃 composer（InputBar），故单监听足够。
// ponytail: single listener; 若将来同屏多 composer 再改成 Set。
import { getComposerDraft, setComposerDraft } from './composerDraft'

type Listener = (text: string) => void

let listener: Listener | null = null

export function onComposerInsert(cb: Listener): () => void {
  listener = cb
  return () => {
    if (listener === cb) listener = null
  }
}

export function insertIntoComposer(text: string): void {
  listener?.(text)
}

// 文本直插信道（Right Dock「插入 @ 引用」等）：与上面的引用卡片信道并列，
// 区别是文本直接进输入框正文而不是挂成引用卡片。同样单监听。
let textListener: Listener | null = null
let textDraftKey: string | null = null

export function onComposerTextInsert(cb: Listener, draftKey?: string): () => void {
  textListener = cb
  textDraftKey = draftKey ?? null
  return () => {
    if (textListener === cb) {
      textListener = null
      textDraftKey = null
    }
  }
}

export function insertTextIntoComposer(text: string): void {
  if (!text) return
  // 文本信号和会话切换可能发生在同一次 React 更新里（首条「回到这里」会从底栏
  // InputBar 切到欢迎页 InputBar）。只 setState 会把文字留在即将卸载的旧组件里；先同步写入
  // 当前草稿，使新挂载的 InputBar 也能读到。随后 listener 仍负责即时更新未卸载的输入框。
  if (textDraftKey) {
    const current = getComposerDraft(textDraftKey) ?? { input: '', quotes: [], attachments: [] }
    const needsSpace = current.input.length > 0
      && !current.input.endsWith(' ')
      && !current.input.endsWith('\n')
    setComposerDraft(textDraftKey, {
      ...current,
      input: `${current.input}${needsSpace ? ' ' : ''}${text}`,
    })
  }
  textListener?.(text)
}
