import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const driver = JSON.parse(await readFile(fileURLToPath(new URL('../../../.run/logs/plugin-desktop-driver.json', import.meta.url)), 'utf8'))
async function send(command) {
  const response = await fetch(driver.url, { method: 'POST', body: JSON.stringify(command), signal: AbortSignal.timeout(30000) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error)
  return value.result
}
if (process.argv.includes('--enter-local')) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const view = await send({ action: 'observe' })
    if (view.inputs.some(item => item.tag === 'TEXTAREA') || view.buttons.some(item => item.label === '打开应用扩展')) { console.log(JSON.stringify({ enteredLocal: true, text: view.text.slice(-700) })); process.exit(0) }
    if (view.inputs.some(item => item.tag === 'SELECT' && item.value !== 'local'))
      await send({ action: 'select', selector: 'select', value: 'local' })
    else {
      const button = view.buttons.find(item => !item.disabled && /^(跳过开场动画|跳过动画|呼唤.+，打开登录|进入尘世)$/.test(item.label ?? item.text))
      if (button) await send({ action: 'click', name: button.label ?? button.text }).catch(() => {})
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error('Local client entrance did not complete')
}
const argument = process.argv.slice(2).find(value => !value.startsWith('--'))
const command = JSON.parse(argument?.startsWith('@') ? await readFile(argument.slice(1), 'utf8') : argument ?? '{"action":"observe"}')
const value = await send(command)
if (value?.inputs) for (const input of value.inputs)
  if (input.type === 'password' || /api.?key|token|secret|credential/i.test(`${input.placeholder ?? ''} ${input.label ?? ''}`)) input.value = '[redacted]'
console.log(JSON.stringify(process.argv.includes('--brief') && value?.buttons ? {
  text: value.text.slice(-3500),
  buttons: value.buttons.filter(item => !/^(思考|工具:|文件|会话|所有会话|参与者|值日生|自醒|备忘|技能|连接器|配置|设置|返回世界选择|调整|关闭新消息|添加附件|开始语音|上下文占用|模型:)/.test(item.label ?? item.text)).map(item => ({ name: item.label ?? item.text, disabled: item.disabled })),
  inputs: value.inputs, pageErrors: value.pageErrors,
} : value, null, 2))
