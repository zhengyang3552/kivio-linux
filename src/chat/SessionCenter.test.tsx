import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatApi } from './api'
import { SessionCenter } from './SessionCenter'
import type { ChatProject, ConversationSearchHit } from './types'

const project: ChatProject = {
  id: 'project-1',
  name: '项目一',
  created_at: 1,
  updated_at: 1,
}

const conversation: ConversationSearchHit = {
  id: 'conversation-1',
  title: '历史对话',
  preview: '预览',
  provider_id: 'provider',
  model: 'model',
  message_count: 2,
  created_at: 1,
  updated_at: 1,
  project_id: project.id,
  folder: project.name,
}

async function renderCenter(onSelectConversation = vi.fn()) {
  vi.spyOn(chatApi, 'queryConversations').mockResolvedValue({ items: [conversation], total: 1 })
  vi.spyOn(chatApi, 'getProjects').mockResolvedValue([project])
  vi.spyOn(chatApi, 'getSets').mockResolvedValue([])

  const view = render(
    <SessionCenter
      lang="zh"
      embedded
      onSelectConversation={onSelectConversation}
    />,
  )
  await screen.findByText('历史对话')
  return { ...view, onSelectConversation }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SessionCenter conversation navigation', () => {
  it('passes the target project scope as part of the conversation selection', async () => {
    const user = userEvent.setup()
    const { onSelectConversation } = await renderCenter()

    await user.click(screen.getByRole('button', { name: /历史对话/ }))

    expect(onSelectConversation).toHaveBeenCalledWith(
      conversation.id,
      conversation,
      { project, set: null },
    )
  })
})

describe('SessionCenter row menu', () => {
  it('portals the menu outside the clipped settings container', async () => {
    const user = userEvent.setup()
    const { container } = await renderCenter()
    const row = screen.getByRole('button', { name: /历史对话/ })
    const trigger = row.querySelector('button[data-row-chrome]')
    expect(trigger).toBeTruthy()

    await user.click(trigger as HTMLButtonElement)

    const menuItem = await screen.findByRole('menuitem', { name: '收藏' })
    const menu = menuItem.closest('[role="menu"]')
    expect(menu).toBeTruthy()
    expect(menu?.parentElement).toBe(document.body)
    expect(container.contains(menu)).toBe(false)
    await waitFor(() => expect(menu).toBeVisible())
  })
})
