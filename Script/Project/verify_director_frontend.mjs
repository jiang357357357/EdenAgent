import { readFileSync } from 'node:fs'
import { projectSessionEvent } from '../../frontend/web/src/lib/rpc-transport.ts'
import { runtimeReducer, initialRuntimeState, applyRuntimeEvent } from '../../frontend/web/src/lib/session-reducer.ts'

// Runs the frontend's bundler-oriented modules in their own compatibility process.
const { events, sessionId, output } = JSON.parse(readFileSync(0, 'utf8'))
let state = structuredClone(initialRuntimeState)
for (const event of events) {
  for (const projected of projectSessionEvent(event)) state = runtimeReducer(state, applyRuntimeEvent(projected))
}
const result = output === 'questions' ? state.questionOrder.map(id => state.questions[id]) :
  output === 'messages' ? Object.values(state.sessions[sessionId].messages) : state.sessions[sessionId].directorRun
process.stdout.write(JSON.stringify(result))
