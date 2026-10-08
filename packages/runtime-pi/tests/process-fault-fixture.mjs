let mode
process.on('message', message => {
  if (message.type !== 'call') return
  if (message.method === 'initialize') {
    mode = message.args[0].systemPrompt
    process.send({ type: 'heartbeat' })
    process.send({ type: 'reply', id: message.id })
  } else if (message.method === 'prompt') {
    if (mode === 'crash') process.exit(23)
    while (true) { /* A synchronous event-loop stall, isolated to this child. */ }
  }
})
