import { acquireProcessLock } from '../../src/bootstrap/process-lock.ts'

acquireProcessLock(process.argv[2]!)
process.send?.('locked')
setInterval(() => {}, 1000)
