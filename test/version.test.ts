import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

/**
 * 版本号三处必须一致：package.json 的 version、build.gradle 的 versionName、versionCode。
 * 这里先管前两处——它们漏一个，打出来的包里 HTML meta 与 APK 声明就会不一致
 * （rspack 会把 package.json 的 version 写进 application-version），
 * 而这一步手工核对已经漏过两次。
 */
// 测试跑在编译产物 .test/test/ 下，往上找到 package.json 所在目录当根
const findRoot = (): URL => {
  let url = new URL('.', import.meta.url)
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(new URL('package.json', url))) {
      return url
    }
    url = new URL('../', url)
  }
  throw new Error('找不到项目根目录')
}

const root = findRoot()

const packageVersion = (
  JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string }
).version

const gradle = readFileSync(new URL('android/app/build.gradle', root), 'utf8')
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1]
const versionCode = /versionCode\s+(\d+)/.exec(gradle)?.[1]

test('package.json 的 version 与 build.gradle 的 versionName 一致', () => {
  assert.ok(versionName, 'build.gradle 里没找到 versionName')
  assert.equal(packageVersion, versionName)
})

test('versionCode 是正整数，发版时只增不减', () => {
  assert.ok(versionCode, 'build.gradle 里没找到 versionCode')
  const code = Number(versionCode)
  assert.ok(Number.isInteger(code) && code > 0)
  // v0.9.11 是 61；这条只防手滑写回明显更小的数，发版时不必改它
  assert.ok(code >= 61)
})
