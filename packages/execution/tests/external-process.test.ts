import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ExternalCommandSandbox, runSkillCommand, launchMcpProcess } from '../src/index.ts'
import { McpClient, McpStdioChannel } from '@eden/integrations'

test('skill runs directly despite obsolete adapter config and preserves arguments and JSON', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-host-skill-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'echo.cjs'), "let body='';process.stdin.on('data',x=>body+=x);process.stdin.on('end',()=>console.log(JSON.stringify({input:JSON.parse(body),args:process.argv.slice(2),cwd:process.cwd()})))")
  const result = await runSkillCommand(root, ['node', 'echo.cjs', 'two words', '$(not-a-command)', ''], { text: '中文' }, 5,
    new AbortController().signal, new ExternalCommandSandbox('/missing', '0'.repeat(64)))
  assert.equal(result.exitCode, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { input: { text: '中文' }, args: ['two words', '$(not-a-command)', ''], cwd: root })
})

test('MCP initializes from a nested host snapshot and can read outside that snapshot', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-host-mcp-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'fixture')); const outside = path.join(root, 'fixture', 'value.txt')
  await writeFile(outside, 'fixture_echo')
  const script = `const fs=require('node:fs'); const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const req=JSON.parse(line);if(req.id===undefined)return;
    const result=req.method==='initialize'?{protocolVersion:req.params.protocolVersion,serverInfo:{name:'fixture',version:'1'},capabilities:{tools:{}}}:
      req.method==='tools/list'?{tools:[{name:fs.readFileSync(process.argv[2],'utf8'),inputSchema:{type:'object'}}]}:{};
    console.log(JSON.stringify({jsonrpc:'2.0',id:req.id,result}));});`
  const abort = new AbortController()
  const child = await launchMcpProcess(new Map([['nested/server.cjs', Buffer.from(script)]]), { command: 'node', args: ['server.cjs', outside], cwd: 'nested' }, abort.signal)
  const client = new McpClient(new McpStdioChannel(child.input, child.output, () => child.terminate()))
  try {
    await client.initialize(abort.signal)
    assert.deepEqual((await client.tools(abort.signal)).map(tool => tool.name), ['fixture_echo'])
  } finally { client.close(); await child.close() }
})
