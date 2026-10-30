import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { createSharedLanRuntime } from '../lan/runtime.ts'
import { SharedWorkspaceClient } from '../client/shared-workspace-client.ts'

export async function directorySourceFixture(context: TestContext, prepare?: (root: string, source: string, host: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'eden-cloud-source-'))
  const options = { active: () => true, canPublish: () => true, discovery: false, host: '127.0.0.1' }
  const source = path.join(root, 'source'), local = path.join(root, 'local')
  mkdirSync(source); mkdirSync(local)
  const admin = await createSharedLanRuntime({ ...options, dataRoot: path.join(root, 'admin') })
  const guest = await createSharedLanRuntime({ ...options, dataRoot: path.join(root, 'guest') })
  const cloudOptions = { ...options, dataRoot: path.join(root, 'host'), dedicated: true, administrators: [admin.deploymentIdentity()] }
  await prepare?.(root, source, cloudOptions.dataRoot)
  let cloud = await createSharedLanRuntime(cloudOptions)
  const client = new SharedWorkspaceClient({ dataRoot: path.join(root, 'local-sync'), remote: admin.remote,
    workspace: () => ({ root: local, key: 'receiver' }), mutate: async (_root, work) => work() })
  context.after(async () => {
    await client.close(); await admin.close(); await guest.close(); await cloud.close()
    rmSync(root, { recursive: true, force: true })
  })
  await admin.connectHost(cloud.invite().code)
  await guest.connectHost(cloud.invite().code)
  const hostId = cloud.network().deviceId
  return { root, source, local, hostId, admin, guest, client,
    create: () => admin.hostRequest<{ space: { id: string; source: { path: string; state: string } } }>(hostId, 'POST', 'spaces',
      { name: '云端原有文件', sourceDirectory: source, confirmSource: true }),
    async restart() {
      await cloud.close()
      cloud = await createSharedLanRuntime(cloudOptions)
      await admin.connectHost(cloud.invite().code)
      await guest.connectHost(cloud.invite().code)
    },
  }
}
