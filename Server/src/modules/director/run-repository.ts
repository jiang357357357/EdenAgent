import { directorPlanSchema, directorRunSchema, toJson } from '@eden/api'
import type { DirectorPlan, DirectorRun, JsonValue } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
import { directorCompatibilityEvents } from './compatibility-events.ts'
import { publicParticipants } from '../actors/index.ts'

export class DirectorRunRepository {
  constructor(private readonly sessions: SessionRepository) {}

  create(sessionId: string, turnId: string, plan: DirectorPlan, participantCount: number, userMessageID?: string, participants: JsonValue[] = []): DirectorRun {
    this.sessions.read(sessionId)
    const publicActors = publicParticipants(participants)
    const now = Date.now()
    const run = directorRunSchema.parse({ ...directorPlanSchema.parse(plan), status: 'planned', completedBeatIndexes: [],
      participantCount, createdAt: now, updatedAt: now, ...(userMessageID ? { userMessageID } : {}) })
    const events = this.sessions.database.transaction(() => {
      this.sessions.database.connection.prepare('INSERT INTO director_runs VALUES (?, ?, ?, ?, ?, ?)')
        .run(run.planID, sessionId, turnId, JSON.stringify(run), now, JSON.stringify(publicActors))
      return this.insertEvents(sessionId, turnId, 'director.planned', run, publicActors)
    })
    for (const event of events) this.sessions.events.publish(event)
    return run
  }

  list(sessionId: string): DirectorRun[] {
    this.sessions.read(sessionId)
    return this.sessions.database.connection.prepare('SELECT run_json FROM director_runs WHERE session_id=? ORDER BY created_at, id')
      .all(sessionId).map(row => directorRunSchema.parse(JSON.parse(String(row.run_json))))
  }

  startBeat(planId: string, index: number): DirectorRun {
    return this.change(planId, 'director.beat.started', run => {
      if (!['planned', 'running'].includes(run.status) || run.activeBeatIndex !== undefined || index !== run.completedBeatIndexes.length || !run.beats[index]) {
        throw new Error('Director beat cannot start out of order or while another beat is active')
      }
      return { ...run, status: 'running', activeBeatIndex: index }
    })
  }

  completeBeat(planId: string, index: number): DirectorRun {
    return this.change(planId, 'director.beat.completed', run => {
      if (run.status !== 'running' || run.activeBeatIndex !== index) throw new Error('Director beat is not active')
      const { activeBeatIndex: _active, ...rest } = run
      const completedBeatIndexes = [...run.completedBeatIndexes, index]
      return { ...rest, completedBeatIndexes, status: completedBeatIndexes.length === run.beats.length ? 'completed' : 'running' }
    })
  }

  fail(planId: string, error: string): DirectorRun {
    return this.change(planId, 'director.failed', run => {
      if (run.status === 'completed' || run.status === 'failed') throw new Error('Director run is already terminal')
      const { activeBeatIndex: _active, ...rest } = run
      return { ...rest, status: 'failed', error }
    })
  }

  recoverInterrupted(): void {
    const rows = this.sessions.database.connection.prepare("SELECT id FROM director_runs WHERE json_extract(run_json, '$.status') IN ('planned','running')").all()
    for (const row of rows) this.fail(String(row.id), 'Host restarted before the director run completed; no beats were replayed')
  }

  private change(planId: string, kind: string, update: (run: DirectorRun) => DirectorRun): DirectorRun {
    const result = this.sessions.database.transaction(() => {
      const row = this.sessions.database.connection.prepare('SELECT * FROM director_runs WHERE id=?').get(planId)
      if (!row) throw new Error('Director run not found')
      const run = directorRunSchema.parse({ ...update(directorRunSchema.parse(JSON.parse(String(row.run_json)))), updatedAt: Date.now() })
      this.sessions.database.connection.prepare('UPDATE director_runs SET run_json=? WHERE id=?').run(JSON.stringify(run), planId)
      const events = this.insertEvents(String(row.session_id), String(row.turn_id), kind, run, JSON.parse(String(row.participants_json)))
      return { run, events }
    })
    for (const event of result.events) this.sessions.events.publish(event)
    return result.run
  }

  private insertEvents(sessionId: string, turnId: string, kind: string, run: DirectorRun, participants: JsonValue[]) {
    return [{ kind, payload: toJson(run) }, ...directorCompatibilityEvents(sessionId, kind, run, participants)]
      .map(event => this.sessions.events.insert(sessionId, turnId, event.kind, event.payload))
  }
}
