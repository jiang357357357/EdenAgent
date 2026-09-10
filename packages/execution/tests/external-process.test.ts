import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { ExternalCommandSandbox, runSkillCommand, launchMcpProcess, probeSandbox } from '../src/index.ts'
import { McpClient, McpStdioChannel } from '@eden/integrations'

// A real adapter fixture implements the old launcher protocol using Linux Bubblewrap.
// It is not the user's adapter and does not claim Windows/macOS enforcement coverage.
async function adapter(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-external-test-'))
  const source = `#!${process.execPath}
const {spawn}=require('node:child_process'), fs=require('node:fs');
const args=process.argv.slice(2);
if(args[0]!=='--workspace'||args[2]!=='--cwd'||args[4]!=='--launcher'||args[6]!=='--'||!['program','mcp','bash'].includes(args[5]))process.exit(90);
const mounts=['--unshare-all','--die-with-parent','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--proc','/proc','--dev','/dev','--tmpfs','/tmp'];
for(const dir of ['/lib','/lib64'])if(fs.existsSync(dir))mounts.push('--ro-bind',fs.realpathSync(dir),dir);
mounts.push('--ro-bind',args[1],args[1],'--ro-bind',process.execPath,process.execPath,'--chdir',args[3],'--',...args.slice(7));
const child=spawn('/usr/bin/bwrap',mounts,{stdio:'inherit',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
child.on('error',()=>process.exit(91));child.on('close',code=>process.exit(code??92));
`
  const file = path.join(root, 'adapter.cjs')
  await writeFile(file, source, { mode: 0o700 })
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, file, external: new ExternalCommandSandbox(file, createHash('sha256').update(source).digest('hex')) }
}

test('External program carries JSON and exact arguments into OS isolation and rejects changed adapters', async t => {
  if (!(await probeSandbox()).available) { t.skip('Requires Linux Bubblewrap for the external adapter fixture'); return }
  const f = await adapter(t)
  await writeFile(path.join(f.root, 'echo.cjs'), "let body='';process.stdin.on('data',x=>body+=x);process.stdin.on('end',()=>console.log(JSON.stringify({input:JSON.parse(body),args:process.argv.slice(2)})))")
  assert.equal((await f.external.probeProgram()).available, true)
  const result = await runSkillCommand(f.root, ['node', 'echo.cjs', 'two words', '$(not-a-command)', ''], { text: '中文' }, 5, new AbortController().signal, f.external)
  assert.equal(result.exitCode, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { input: { text: '中文' }, args: ['two words', '$(not-a-command)', ''] })
  assert.throws(() => f.external.program(f.root, os.tmpdir(), ['node']), /escapes/)
  await writeFile(f.file, '#!/bin/false\n')
  await assert.rejects(runSkillCommand(f.root, ['node'], {}, 5, new AbortController().signal, f.external), /changed/)
})

test('External MCP process initializes and returns a tool catalog over real bidirectional stdio', async t => {
  if (!(await probeSandbox()).available) { t.skip('Requires Linux Bubblewrap'); return }
  const f = await adapter(t)
  const script = `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const req=JSON.parse(line);if(req.id===undefined)return;
    const result=req.method==='initialize'?{protocolVersion:req.params.protocolVersion,serverInfo:{name:'fixture',version:'1'},capabilities:{tools:{}}}:
      req.method==='tools/list'?{tools:[{name:'fixture_echo',inputSchema:{type:'object'}}]}:{};
    console.log(JSON.stringify({jsonrpc:'2.0',id:req.id,result}));});`
  const abort = new AbortController()
  const process = await launchMcpProcess(new Map([['server.cjs', Buffer.from(script)]]), { command: 'node', args: ['server.cjs'], cwd: '.' }, abort.signal, f.external)
  const client = new McpClient(new McpStdioChannel(process.input, process.output, process.terminate))
  try {
    await client.initialize(abort.signal)
    assert.deepEqual((await client.tools(abort.signal)).map(tool => tool.name), ['fixture_echo'])
  } finally { client.close(); await process.close() }
})
