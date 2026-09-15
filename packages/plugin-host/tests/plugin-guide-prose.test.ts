import assert from 'node:assert/strict'
import test from 'node:test'
import { pluginGuide } from '../src/drafts/plugin-guide.ts'

test('plugin development guide describes capabilities without prohibition-heavy prose', () => {
  const strings = JSON.stringify(pluginGuide())
  assert.match(strings, /[\u3400-\u9fff]/u)
  assert.doesNotMatch(strings, /不能|不要|不得|禁止|不允许|只允许|必须|不授予|不执行|不保存|不加|不把/u)
})
