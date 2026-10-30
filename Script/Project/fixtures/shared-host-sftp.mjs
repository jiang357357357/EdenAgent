import fs from 'node:fs'
import path from 'node:path'
import ssh2 from 'ssh2'

/** Real filesystem SFTP fixture, confined to the disposable Linux root used by the test. */
export function serveHostSftp(sftp, root) {
  const { STATUS_CODE: code, flagsToString } = ssh2.utils.sftp
  const handles = new Map(); let sequence = 0
  const local = remote => {
    const value = path.resolve(root, remote === '.' ? 'root' : remote.replace(/^\/+/, ''))
    if (value !== root && !value.startsWith(root + path.sep)) throw new Error('outside fixture')
    return value
  }
  const status = (id, error) => sftp.status(id, !error ? code.OK : error.code === 'ENOENT' ? code.NO_SUCH_FILE : code.FAILURE)
  const attrs = value => ({ mode: value.mode, uid: value.uid, gid: value.gid, size: value.size,
    atime: Math.floor(value.atimeMs / 1000), mtime: Math.floor(value.mtimeMs / 1000) })
  const protect = handler => (...args) => { try { handler(...args) } catch (error) { status(args[0], error) } }
  sftp.on('REALPATH', protect((id, name) => {
    const normalized = name === '.' ? '/root' : '/' + path.relative(root, local(name))
    sftp.name(id, [{ filename: normalized, longname: normalized, attrs: {} }])
  }))
  sftp.on('MKDIR', protect((id, name, attributes) => fs.mkdir(local(name), { mode: attributes.mode ?? 0o700 }, error => status(id, error))))
  sftp.on('REMOVE', protect((id, name) => fs.unlink(local(name), error => status(id, error))))
  sftp.on('RMDIR', protect((id, name) => fs.rmdir(local(name), error => status(id, error))))
  sftp.on('RENAME', protect((id, source, target) => fs.rename(local(source), local(target), error => status(id, error))))
  for (const [event, method] of [['STAT', 'stat'], ['LSTAT', 'lstat']]) sftp.on(event, protect((id, name) => {
    fs[method](local(name), (error, value) => error ? status(id, error) : sftp.attrs(id, attrs(value)))
  }))
  sftp.on('OPEN', protect((id, name, flags, attributes) => {
    fs.open(local(name), flagsToString(flags), attributes.mode ?? 0o600, (error, fd) => {
      if (error) return status(id, error)
      const handle = Buffer.alloc(4); handle.writeUInt32BE(++sequence); handles.set(sequence, fd); sftp.handle(id, handle)
    })
  }))
  const descriptor = handle => { const fd = handles.get(handle.readUInt32BE(0)); if (fd === undefined) throw new Error('bad handle'); return fd }
  sftp.on('WRITE', protect((id, handle, offset, bytes) => {
    fs.write(descriptor(handle), bytes, 0, bytes.length, offset, (error, written) => status(id,
      error ?? (written === bytes.length ? null : new Error('partial write'))))
  }))
  sftp.on('READ', protect((id, handle, offset, length) => {
    const bytes = Buffer.alloc(Math.min(length, 64 * 1024))
    fs.read(descriptor(handle), bytes, 0, bytes.length, offset, (error, read) => {
      if (error) return status(id, error)
      if (!read) return sftp.status(id, code.EOF)
      sftp.data(id, bytes.subarray(0, read))
    })
  }))
  sftp.on('FSTAT', protect((id, handle) => fs.fstat(descriptor(handle), (error, value) => error ? status(id, error) : sftp.attrs(id, attrs(value)))))
  sftp.on('SETSTAT', protect((id, name, attributes) => fs.chmod(local(name), attributes.mode, error => status(id, error))))
  sftp.on('FSETSTAT', protect((id, handle, attributes) => fs.fchmod(descriptor(handle), attributes.mode, error => status(id, error))))
  sftp.on('CLOSE', protect((id, handle) => {
    const fd = descriptor(handle); handles.delete(handle.readUInt32BE(0)); fs.close(fd, error => status(id, error))
  }))
  sftp.once('close', () => { for (const fd of handles.values()) fs.close(fd, () => {}); handles.clear() })
  sftp.on('error', () => {})
}
