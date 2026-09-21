import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PluginCenter } from './PluginCenter'

vi.mock('./PluginPackages', () => ({ PluginPackages: () => <div>plugin packages</div> }))

describe('PluginCenter', () => {
  it('keeps plugins and connectors without the removed third-party apps section', () => {
    const onSectionChange = vi.fn()
    render(
      <PluginCenter
        section="plugins"
        onSectionChange={onSectionChange}
        lang="zh"
        connectors={<div>connectors panel</div>}
      />,
    )

    expect(screen.getByRole('tab', { name: '插件' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '连接器' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '第三方应用' })).not.toBeInTheDocument()
    expect(screen.getByText('plugin packages')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '连接器' }))
    expect(onSectionChange).toHaveBeenCalledWith('connectors')
  })
})
