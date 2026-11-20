import { memo, useMemo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ErrorBoundary } from '../../app/ErrorBoundary.js'
import type { Source } from '../../services/chat/view.js'
import { toMdAst } from '../../services/markdown/parse.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import styles from './Markdown.module.css'
import './markdown.css'
import './highlight.css'

/**
 * 渲染链路：节流 → 解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
}) {
  const t = useTranslate()
  const scrollToBottom = useScrollToBottom()
  const throttledMarkdown = useThrottleMarkdownRender(content, loading)
  const ast = useMemo(
    () => (throttledMarkdown ? toMdAst(throttledMarkdown, { sources, disableLink }) : null),
    [throttledMarkdown, sources, disableLink]
  )
  if (!ast) {
    return null
  }
  return (
    // 单条消息渲染失败只降级这一条，原文保留，其余消息与输入框照常可用
    <ErrorBoundary
      resetKey={`${cacheKey}:${loading ? 'live' : 'done'}`}
      fallback={() => (
        <div className={styles.fallback}>
          <p className={styles.hint}>{t('messageRenderFailed')}</p>
          <pre className={styles.raw}>{throttledMarkdown}</pre>
        </div>
      )}
    >
      <MarkdownAstRenderer
        key={cacheKey}
        className={className}
        ast={ast}
        loading={loading}
        onUpdate={scrollToBottom}
      />
    </ErrorBoundary>
  )
})
