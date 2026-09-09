import { rpcMethods } from '@eden/api'
import type { CommandService } from '../../modules/commands/command-service.ts'
import { contractHandler } from './contract-handler.ts'

export function commandRoutes(commands: CommandService) {
  return {
    'command.execution.get': contractHandler(rpcMethods['command.execution.get'], () => commands.info()),
    'command.execution.set': contractHandler(rpcMethods['command.execution.set'], input => commands.set(input)),
  }
}
