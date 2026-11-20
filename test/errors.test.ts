import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '../src/services/api/client.js'
import {
  classifyApiError,
  classifyStatus,
  extractFileIds,
  getFileErrorCode,
  getUploadErrorInfo,
  isRetryableApiError,
} from '../src/services/api/errors.js'

const http = (status: number, message = 'boom') => new ApiError('http', message, status)

test('状态码归类', () => {
  assert.equal(classifyStatus(401), 'unauthorized')
  assert.equal(classifyStatus(402), 'insufficientBalance')
  assert.equal(classifyStatus(413), 'tooLarge')
  assert.equal(classifyStatus(429), 'rateLimited')
  assert.equal(classifyStatus(500), 'serverBusy')
  assert.equal(classifyStatus(529), 'serverBusy')
  assert.equal(classifyStatus(400), 'other')
  assert.equal(classifyStatus(404), 'other')
  // 请求没到达服务端
  assert.equal(classifyStatus(undefined), 'other')
})

test('只有请求没到达服务端才算网络问题', () => {
  assert.equal(classifyApiError(new ApiError('network', 'reset')), 'network')
  assert.equal(classifyApiError(new ApiError('protocol', 'bad json')), 'other')
  assert.equal(classifyApiError(http(429)), 'rateLimited')
  assert.equal(classifyApiError(new Error('plain')), 'other')
  assert.equal(classifyApiError('not an error'), 'other')
})

test('可重试的只有网络、限流与服务端繁忙', () => {
  assert.equal(isRetryableApiError(new ApiError('network', 'reset')), true)
  assert.equal(isRetryableApiError(http(429)), true)
  assert.equal(isRetryableApiError(http(500)), true)
  assert.equal(isRetryableApiError(http(401)), false)
  assert.equal(isRetryableApiError(http(402)), false)
  assert.equal(isRetryableApiError(http(400)), false)
  // 非 ApiError 一律当作可能恢复（例如 fetch 本身抛出的 TypeError）
  assert.equal(isRetryableApiError(new TypeError('failed to fetch')), true)
})

test('附件失效只认三种 400 文案', () => {
  assert.equal(
    getFileErrorCode(http(400, 'file_ids do not exist or are not created under your account')),
    'fileIdMissing'
  )
  assert.equal(getFileErrorCode(http(400, 'file data not found for file_id: file-api-abc')), 'fileDataMissing')
  assert.equal(getFileErrorCode(http(400, 'messages.1.content.0.source.file_id: invalid file_id')), 'invalidFileId')

  // 同上但状态码不对：不处理，保持原有失败提示
  assert.equal(getFileErrorCode(http(422, 'file data not found for file_id')), null)
  assert.equal(getFileErrorCode(http(400, 'rate limited')), null)
  assert.equal(getFileErrorCode(new Error('file data not found')), null)
})

test('从报错里取 file_id 并去重', () => {
  assert.deepEqual(extractFileIds('bad file-api-aaa and file-api-bbb and file-api-aaa'), [
    'file-api-aaa',
    'file-api-bbb',
  ])
  assert.deepEqual(extractFileIds('nothing here'), [])
})

test('上传失败分类：配额带上限数值，解析失败不带', () => {
  assert.deepEqual(
    getUploadErrorInfo(http(400, 'User file count limit exceeded, limit 500')),
    { code: 'fileCountLimit', limit: '500' }
  )
  // 单个 Key 与账号合计共用同一提示，数字可能是小数
  assert.deepEqual(
    getUploadErrorInfo(http(400, 'User storage quota exceeded, limit 50.5 GB')),
    { code: 'storageLimit', limit: '50.5' }
  )
  assert.deepEqual(getUploadErrorInfo(http(400, 'The image is too large to process')), {
    code: 'parseFailed',
  })
  assert.deepEqual(getUploadErrorInfo(http(400, 'You have uploaded an unsupported file')), {
    code: 'parseFailed',
  })
  assert.equal(getUploadErrorInfo(http(400, 'something else entirely')), null)
  assert.equal(getUploadErrorInfo(http(500, 'The image is too large to process')), null)
})
