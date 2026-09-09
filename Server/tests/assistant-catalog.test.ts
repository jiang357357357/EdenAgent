import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { MonClient } from '@eden/integrations'
import { assistantCatalog, assistantSummary, resolveAssistantTarget } from '../src/modules/mon/assistant-catalog.ts'

test('assistant selection resolves names across pages, rejects ambiguity and mismatched detail identities', async () => {
  const paths: string[] = []
  let ambiguous = false, wrongId = false, duplicate = false
  const assistant = (id: number, name: string) => ({ id, name, character: { id, name, signature: 'profile only' }, api_key: 'private-assistant-key', prompt: 'not a summary' })
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Token session-token')
    const url = request.url ?? ''
    paths.push(url)
    const body = url === '/api/assistants/' ? { results: [assistant(1, ambiguous ? 'Alice' : 'First')], next: '/api/assistants/?page=2' } :
      url.includes('?page=2') ? { results: [assistant(duplicate ? 1 : 2, 'A lice')], next: null } : assistant(wrongId ? 99 : 2, 'Full Alice')
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const client = new MonClient(`http://127.0.0.1:${address.port}`, 'session-token')
  const signal = new AbortController().signal
  try {
    const resolved = await resolveAssistantTarget(client, { assistantName: ' ALICE ' }, signal)
    assert.equal(resolved.summary.id, 2)
    assert.equal(resolved.detail.name, 'Full Alice')
    assert.deepEqual(paths, ['/api/assistants/', '/api/assistants/?page=2', '/api/assistants/2/'])
    const summaries = (await assistantCatalog(client, signal)).map(assistantSummary)
    assert.doesNotMatch(JSON.stringify(summaries), /private-assistant-key|api_key|prompt|profile only/)
    ambiguous = true
    const count = paths.filter(path => path === '/api/assistants/2/').length
    await assert.rejects(resolveAssistantTarget(client, { assistantName: 'Alice' }, signal), /ambiguous/)
    assert.equal(paths.filter(path => path === '/api/assistants/2/').length, count)
    const beforeId = paths.length
    await resolveAssistantTarget(client, { assistantId: '2', assistantName: 'ignored when ID is explicit' }, signal)
    assert.deepEqual(paths.slice(beforeId), ['/api/assistants/2/'])
    wrongId = true
    await assert.rejects(resolveAssistantTarget(client, { assistantId: 2 }, signal), /identity mismatch/)
    wrongId = false; ambiguous = false
    await assert.rejects(resolveAssistantTarget(client, { assistantName: 'Missing' }, signal), /not found/)
    duplicate = true
    await assert.rejects(assistantCatalog(client, signal), /duplicate identities/)
    const cancelled = new AbortController(); cancelled.abort()
    const beforeAbort = paths.length
    await assert.rejects(resolveAssistantTarget(client, { assistantId: 2 }, cancelled.signal))
    assert.equal(paths.length, beforeAbort)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
