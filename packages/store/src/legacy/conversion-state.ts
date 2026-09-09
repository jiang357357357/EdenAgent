import type { DatabaseSync } from 'node:sqlite'
export function tableConverted(db: DatabaseSync, name: string): boolean {
  return db.prepare('SELECT state FROM legacy_conversion_tables WHERE name=?').get(name)?.state === 'converted'
}
