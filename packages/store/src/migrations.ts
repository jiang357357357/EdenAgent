import type { DatabaseSync } from 'node:sqlite'
import { sessionSchema } from './schema/session.ts'
import { capabilitySchema } from './schema/capability.ts'
import { automationSchema } from './schema/automation.ts'
import { subagentSchema } from './schema/subagent.ts'
import { legacySchema } from './schema/legacy.ts'
import { channelSchema } from './schema/channel.ts'
import { selfAwakeActivationSchema } from './schema/self-awake-activation.ts'
import { sessionModelHeadsSchema } from './schema/session-model-heads.ts'
import { selfAwakeSessionSchema } from './schema/self-awake-session.ts'
import { sessionWorkspacesSchema } from './schema/session-workspaces.ts'
import { monDeliverySchema } from './schema/mon-delivery.ts'

export const migrations: readonly string[] = [
  sessionSchema[1],
  capabilitySchema[2],
  capabilitySchema[3],
  sessionSchema[4],
  sessionSchema[5],
  capabilitySchema[6],
  sessionSchema[7],
  channelSchema[8],
  sessionSchema[9],
  sessionSchema[10],
  sessionSchema[11],
  sessionSchema[12],
  sessionSchema[13],
  sessionSchema[14],
  automationSchema[15],
  automationSchema[16],
  automationSchema[17],
  sessionSchema[18],
  sessionSchema[19],
  channelSchema[20],
  automationSchema[21],
  automationSchema[22],
  automationSchema[23],
  automationSchema[24],
  sessionSchema[25],
  capabilitySchema[26],
  capabilitySchema[27],
  capabilitySchema[28],
  capabilitySchema[29],
  capabilitySchema[30],
  capabilitySchema[31],
  capabilitySchema[32],
  capabilitySchema[33],
  capabilitySchema[34],
  subagentSchema[35],
  subagentSchema[36],
  subagentSchema[37],
  channelSchema[38],
  channelSchema[39],
  channelSchema[40],
  channelSchema[41],
  channelSchema[42],
  channelSchema[43],
  capabilitySchema[44],
  capabilitySchema[45],
  capabilitySchema[46],
  capabilitySchema[47],
  capabilitySchema[48],
  capabilitySchema[49],
  capabilitySchema[50],
  sessionSchema[51],
  sessionSchema[52],
  subagentSchema[53],
  subagentSchema[54],
  subagentSchema[55],
  subagentSchema[56],
  automationSchema[57],
  automationSchema[58],
  sessionSchema[59],
  channelSchema[60],
  automationSchema[61],
  legacySchema[62],
  legacySchema[63],
  legacySchema[64],
  legacySchema[65],
  legacySchema[66],
  legacySchema[67],
  legacySchema[68],
  legacySchema[69],
  legacySchema[70],
  legacySchema[71],
  legacySchema[72],
  legacySchema[73],
  legacySchema[74],
  legacySchema[75],
  subagentSchema[76],
  subagentSchema[77],
  subagentSchema[78],
  subagentSchema[79],
  sessionSchema[80],
  subagentSchema[81],
  subagentSchema[82],
  subagentSchema[83],
  subagentSchema[84],
  subagentSchema[85],
  subagentSchema[86],
  subagentSchema[87],
  subagentSchema[88],
  subagentSchema[89],
  subagentSchema[90],
  subagentSchema[91],
  subagentSchema[92],
  automationSchema[93],
  sessionSchema[94],
  sessionSchema[95],
  subagentSchema[96],
  automationSchema[97],
  automationSchema[98],
  capabilitySchema[99],
  automationSchema[100],
  automationSchema[101],
  automationSchema[102],
  subagentSchema[103],
  subagentSchema[104],
  subagentSchema[105],
  subagentSchema[106],
  subagentSchema[107],
  subagentSchema[108],
  subagentSchema[109],
  sessionSchema[110],
  sessionSchema[111],
  sessionSchema[112],
  automationSchema[113],
  capabilitySchema[114],
  capabilitySchema[115],
  capabilitySchema[116],
  sessionSchema[117],
  sessionSchema[118],
  sessionSchema[119],
  sessionSchema[120],
  automationSchema[121],
  sessionSchema[122],
  sessionSchema[123],
  channelSchema[124],
  sessionSchema[125],
  channelSchema[126],
  channelSchema[127],
  channelSchema[128],
  selfAwakeActivationSchema,
  sessionModelHeadsSchema,
  selfAwakeSessionSchema,
  sessionWorkspacesSchema,
  monDeliverySchema,
]

export const databaseSchemaVersion = migrations.length

export function migrateDatabase(database: DatabaseSync): void {
  const row = database.prepare('PRAGMA user_version').get()
  const current = Number(row?.user_version ?? 0)
  if (current > migrations.length) throw new Error('Database schema is newer than this host')
  for (let index = current; index < migrations.length; index++) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrations[index]!)
      database.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(index + 1, Date.now())
      database.exec(`PRAGMA user_version = ${index + 1}`)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
