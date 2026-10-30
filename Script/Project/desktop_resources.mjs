import { cp, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

export async function packageDesktopControl(root, directory, source = path.join(root, 'dist/server'), platform = process.platform) {
  const digest = async filename => createHash('sha256').update(await readFile(path.join(source, filename))).digest('hex')
  for (const filename of ['desktop-broker.mjs', 'desktop-broker.mjs.map'])
    await cp(path.join(source, filename), path.join(directory, filename))
  const manifest = { broker: 'server/desktop-broker.mjs', brokerSha256: await digest('desktop-broker.mjs') }
  for (const filename of ['cua-worker.mjs', 'cua-worker.mjs.map'])
    await cp(path.join(source, filename), path.join(directory, filename))
  manifest.cuaWorker = 'server/cua-worker.mjs'
  manifest.cuaWorkerSha256 = await digest('cua-worker.mjs')
  manifest.cuaDriverVersion = '0.28.0'
  await cp(path.join(source, 'cua-driver.LICENSE'), path.join(directory, 'cua-driver.LICENSE'))
  manifest.cuaLicense = 'server/cua-driver.LICENSE'
  manifest.cuaLicenseSha256 = await digest('cua-driver.LICENSE')
  if (platform === 'win32') {
    const observer = JSON.parse(await readFile(path.join(source, 'desktop-input-observer.json'), 'utf8'))
    if (!/^desktop-input-observer-[a-f0-9]{16}\.exe$/.test(observer.filename)) throw new Error('Invalid desktop observer manifest')
    await cp(path.join(source, 'desktop-input-observer.json'), path.join(directory, 'desktop-input-observer.json'))
    await cp(path.join(source, observer.filename), path.join(directory, observer.filename))
    manifest.observer = `server/${observer.filename}`
    manifest.observerSha256 = await digest(observer.filename)
  }
  return manifest
}
