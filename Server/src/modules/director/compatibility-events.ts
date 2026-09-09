import { toJson } from '@eden/api'
import type { DirectorRun, JsonValue } from '@eden/api'
import { publicSpeaker } from '../actors/index.ts'

export function directorCompatibilityEvents(sessionID: string, kind: string, run: DirectorRun, participants: JsonValue[]) {
  const base = { sessionID, planID: run.planID }
  const events: { kind: string; payload: JsonValue }[] = []
  if (kind === 'director.planned') {
    events.push({ kind: 'companion.director.started', payload: toJson({ sessionID, participantCount: run.participantCount, userMessageID: run.userMessageID }) })
    events.push({ kind: 'companion.plan', payload: toJson({ ...base, userMessageID: run.userMessageID, source: run.source,
      diagnostic: run.diagnostic, scene: run.scene, execution: run.execution, beats: run.beats }) })
  }
  if (kind === 'director.beat.started' || kind === 'director.beat.completed') {
    const index = kind === 'director.beat.started' ? run.activeBeatIndex! : run.completedBeatIndexes.at(-1)!
    const beat = run.beats[index]!
    const participant = participants.find(item => item && typeof item === 'object' && !Array.isArray(item) && String(item.assistantId) === String(beat.assistantID)) ?? { assistantId: beat.assistantID }
    events.push({ kind: kind === 'director.beat.started' ? 'companion.speaker.started' : 'companion.speaker.finished',
      payload: toJson({ ...base, beatIndex: index, speaker: publicSpeaker(participant, index), beat }) })
  }
  if (run.status === 'completed' || run.status === 'failed') {
    events.push({ kind: `companion.director.${run.status}`, payload: toJson({ ...base, status: run.status, completedBeatIndexes: run.completedBeatIndexes, error: run.error }) })
  }
  return events
}
