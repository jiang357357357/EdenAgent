import { createHash, randomUUID } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { RuntimeModel } from '@eden/runtime-pi'
import { modelRatesSchema } from '@eden/api'
import type { ModelRates } from '@eden/api'

function key(model: RuntimeModel): string {
  return createHash('sha256').update(JSON.stringify([model.provider, model.id, model.baseUrl])).digest('hex')
}
/** One world's rates for an exact provider/model/endpoint; never contains credentials. */
export class ModelPricingRepository {
  constructor(private readonly database: EdenDatabase) {}
  read(model: RuntimeModel) {
    const modelKey = key(model), row = this.database.connection.prepare('SELECT rates_json,revision FROM model_pricing WHERE model_key=?').get(modelKey)
    return { modelKey, provider: model.provider, modelId: model.id,
      rates: row ? row.rates_json === null ? null : modelRatesSchema.parse(JSON.parse(String(row.rates_json))) : model.cost ?? null,
      revision: row ? String(row.revision) : null }
  }
  apply(model: RuntimeModel | undefined): RuntimeModel | undefined {
    if (!model) return undefined
    const { cost: _cost, ...rest } = model, rates = this.read(model).rates
    return { ...rest, ...(rates ? { cost: rates } : {}) }
  }
  set(model: RuntimeModel, expectedModelKey: string, expectedRevision: string | null, rates: ModelRates | null, note: string) {
    return this.database.transaction(() => {
      const current = this.read(model)
      if (current.modelKey !== expectedModelKey || current.revision !== expectedRevision) throw new Error('Model identity or rates changed; reload before saving')
      const parsed = rates === null ? null : modelRatesSchema.parse(rates), revision = randomUUID(), now = Date.now()
      const serialized = parsed === null ? null : JSON.stringify(parsed)
      this.database.connection.prepare(`INSERT INTO model_pricing VALUES(?,?,?,?,?,?) ON CONFLICT(model_key) DO UPDATE SET
        rates_json=excluded.rates_json,revision=excluded.revision,note=excluded.note,updated_at=excluded.updated_at`)
        .run(current.modelKey, serialized, revision, note, now, JSON.stringify({ provider: model.provider, modelId: model.id, baseUrl: model.baseUrl }))
      this.database.connection.prepare('INSERT INTO model_pricing_history VALUES(?,?,?,?,?,?,?)')
        .run(revision, current.modelKey, current.rates === null ? null : JSON.stringify(current.rates), serialized, note, now, current.revision)
      return this.read(model)
    })
  }
}
