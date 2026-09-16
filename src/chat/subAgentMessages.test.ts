import { expect, it } from 'vitest'
import { subAgentMessages } from './subAgentMessages'
import type { SubAgentRecord } from '../api/tauri'

it('restores persisted tool metadata and errors instead of treating every returned output as success', () => {
  const child: SubAgentRecord = {
    id: 'child', name: 'Worker', sequence: 1, profile: { model: 'test', agentType: 'research' },
    runs: [{ id: 'run', status: 'failed', prompt: 'Search' }], messages: [],
    history: [
      { role: 'assistant', tool_calls: [{ id: 'tool', function: { name: 'search', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tool', content: 'Permission denied' },
    ],
    tools: [{ id: 'tool', name: 'search', source: 'mcp', server_name: 'Search', status: 'returned',
      result: { content: 'Permission denied', is_error: true, structured_content: { hits: [] }, artifacts: [] } }],
  }
  expect(subAgentMessages(child)[0].tool_calls![0]).toMatchObject({ source: 'mcp', server_name: 'Search', status: 'error', structured_content: { hits: [] }, error: 'Permission denied' })
})
