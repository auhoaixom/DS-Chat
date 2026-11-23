import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

/**
 * 版本号三处必须一致：package.json 的 version、build.gradle 的 versionName、versionCode。
 * 这里先管前两处——它们漏一个，打出来的包里 HTML meta 与 APK 声明就会不一致
 * （rspack 会把 package.json 的 version 写进 application-version），
 * 而这一步手工核对已经漏过两次。
 *
 * 另一半是 versionCode 只增不减：漏掉它的后果不是报错，是打出一个装不上
 * （降级被拒）的包，而那时包已经归档、可能已经发出去了。历史最大值直接从
 * tag 里读，不再写死一个下限数字。
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

const readText = (relativePath: string): string => readFileSync(new URL(relativePath, root), 'utf8')

const packageVersion = (JSON.parse(readText('package.json')) as { version: string }).version

const gradle = readText('android/app/build.gradle')
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1]
const versionCode = /versionCode\s+(\d+)/.exec(gradle)?.[1]

/** 在仓库里跑 git；没有 .git 或没装 git 时返回 null。 */
const git = (args: string[]): string | null => {
  try {
    return execFileSync('git', args, {
      cwd: new URL(root),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

const gitAvailable = git(['rev-parse', '--is-inside-work-tree'])?.trim() === 'true'
const skipWithoutGit = gitAvailable ? false : '当前不是 git 仓库，跳过与 tag 相关的校验'

type Release = { tag: string; code: number }

/** 每个发版 tag 上的 versionCode；没有 build.gradle 的早期 tag（网页版）自动跳过。 */
const readReleases = (): Release[] => {
  const listed = git(['tag', '--list', 'v*']) ?? ''
  const releases: Release[] = []
  for (const tag of listed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)) {
    const tagged = git(['show', `${tag}:android/app/build.gradle`])
    if (tagged === null) {
      continue
    }
    const code = Number(/versionCode\s+(\d+)/.exec(tagged)?.[1] ?? NaN)
    if (Number.isInteger(code)) {
      releases.push({ tag, code })
    }
  }
  return releases.sort((a, b) => a.code - b.code)
}

const releases = gitAvailable ? readReleases() : []
const latestRelease = releases.length > 0 ? releases[releases.length - 1] : null

test('package.json 的 version 与 build.gradle 的 versionName 一致', () => {
  assert.ok(versionName, 'build.gradle 里没找到 versionName')
  assert.equal(packageVersion, versionName)
})

test('versionCode 是正整数', () => {
  assert.ok(versionCode, 'build.gradle 里没找到 versionCode')
  const code = Number(versionCode)
  assert.ok(Number.isInteger(code) && code > 0, `versionCode 不合法：${versionCode}`)
})

test('versionCode 不低于历史上任何一版', { skip: skipWithoutGit }, () => {
  if (latestRelease === null) {
    return
  }
  const code = Number(versionCode)
  assert.ok(
    code >= latestRelease.code,
    `当前 versionCode ${code} 小于 ${latestRelease.tag} 的 ${latestRelease.code}`,
  )
})

test('准备发新版时，versionCode 必须大于上一版', { skip: skipWithoutGit }, () => {
  if (latestRelease === null) {
    return
  }
  const latestVersion = latestRelease.tag.replace(/^v/, '')
  if (packageVersion === latestVersion) {
    // 当前版本号与最近一次发版相同，说明还没开始下一版，不需要加 versionCode
    return
  }
  const code = Number(versionCode)
  assert.ok(
    code > latestRelease.code,
    `版本号已改到 ${packageVersion}，但 versionCode 仍是 ${code}，必须大于 ${latestRelease.tag} 的 ${latestRelease.code}`,
  )
})

test('已打 tag 的提交，tag 名必须与版本号一致', { skip: skipWithoutGit }, () => {
  // 改完版本号但还没提交时，HEAD 上的 tag 仍属于上一个提交，此时比对没有意义
  const dirty = (git(['status', '--porcelain']) ?? '').trim().length > 0
  if (dirty) {
    return
  }
  const tags = (git(['tag', '--points-at', 'HEAD']) ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('v'))
  if (tags.length === 0) {
    return
  }
  assert.deepEqual(tags, [`v${packageVersion}`], `HEAD 上的 tag 是 ${tags.join(', ')}，与版本号 ${packageVersion} 不一致`)
})
