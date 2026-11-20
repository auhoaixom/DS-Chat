import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeArchive } from '../src/services/chat/history/zipWriter.js'
import { readArchive, readEntry } from '../src/services/chat/history/zipReader.js'

const text = (value: string) => new Blob([value], { type: 'text/plain' })

test('写出的归档能原样读回', async () => {
  const blob = await writeArchive([
    { name: 'manifest.json', blob: text('{"export_format_version":1}') },
    { name: 'sessions/a.json', blob: text('{"id":"a"}') },
  ])
  const file = new File([blob], 'history.zip')
  const entries: string[] = []
  for await (const entry of readArchive(file)) {
    const content = await readEntry(entry)
    entries.push(`${entry.path}:${await content.text()}`)
  }
  assert.deepEqual(entries, [
    'manifest.json:{"export_format_version":1}',
    'sessions/a.json:{"id":"a"}',
  ])
})

test('路径穿越与非法条目名一律拒绝', async () => {
  const bad = [
    '../escape.json',
    'sessions/../../escape.json',
    'sessions\\win.json',
    '/absolute.json',
    'C:/drive.json',
    'sessions//double.json',
    'sessions/./dot.json',
    '',
  ]
  for (const name of bad) {
    await assert.rejects(writeArchive([{ name, blob: text('x') }]), `应拒绝：${JSON.stringify(name)}`)
  }
})

test('同名条目会被拒绝，避免解压时互相覆盖', async () => {
  await assert.rejects(
    writeArchive([
      { name: 'same.json', blob: text('a') },
      { name: 'same.json', blob: text('b') },
    ])
  )
})
