import assert from 'node:assert/strict'
import { test } from 'node:test'

import { en } from '../src/i18n/en.js'
import { frFR } from '../src/i18n/frFR.js'
import { jaJP } from '../src/i18n/jaJP.js'
import { ruRU } from '../src/i18n/ruRU.js'
import { zh } from '../src/i18n/zh.js'
import { zhTW } from '../src/i18n/zhTW.js'

/**
 * 六种语言必须是同一份键集合。
 *
 * 少一条键在界面上不是"显示英文"，而是直接崩在 translate 里（`messages[key]` 为
 * undefined）。多一条键则说明有文案没人用，迟早变成僵尸。
 */
const locales: Record<string, Record<string, string>> = {
  'zh-TW': zhTW,
  'en-US': en,
  'ja-JP': jaJP,
  'ru-RU': ruRU,
  'fr-FR': frFR,
}

const reference = Object.keys(zh).sort()

/** 文案里的 {placeholder}，用来保证插值参数不会漏翻 */
const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

test('每种语言的键集合与 zh-CN 完全一致', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(messages).sort(), reference, `${locale} 的键集合不一致`)
  }
})

test('每条文案都非空', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    const empty = Object.entries(messages)
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key)
    assert.deepEqual(empty, [], `${locale} 有空文案`)
  }
})

test('占位符数量与 zh-CN 一致', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    const mismatched = reference.filter((key) => {
      const mine = placeholders((zh as Record<string, string>)[key])
      const theirs = placeholders(messages[key])
      return mine.join(',') !== theirs.join(',')
    })
    assert.deepEqual(mismatched, [], `${locale} 的占位符与 zh-CN 不一致`)
  }
})
