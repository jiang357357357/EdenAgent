import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { PackageAssets } from '../../modules/plugin-market/index.ts'
export function pluginAssetRoutes(assets: PackageAssets) {
  return {
    'plugin.asset.list': contractHandler(rpcMethods['plugin.asset.list'], input => assets.list(input.id, input.revision)),
    'plugin.asset.export': contractHandler(rpcMethods['plugin.asset.export'], input => assets.export(input.id, input.revision, input.source)),
  }
}
