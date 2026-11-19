import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { ensureKatex, type Katex } from '../../services/markdown/katex.js'
import { copyText } from '../../utils/clipboard.js'
import { showToast } from '../base/toastState.js'

/** renderToString 外层包裹的标签，组件自己渲染外层，这里切掉 */
const KATEX_WRAPPER = {
  inline: ['<span class="katex">', '</span>'],
  display: ['<span class="katex-display"><span class="katex">', '</span></span>'],
} as const

type MathHtmlResult = {
  html: string
  renderMode: 'katex' | 'fallback'
}

const noop = () => {}

/** 公式不参与文本选择：否则长按会先弹系统选区菜单，复制走的是渲染结果。 */
const NO_SELECT = { userSelect: 'none', WebkitUserSelect: 'none' } as const

const LONG_PRESS_MS = 450

/**
 * 复制公式的 LaTeX 源码。
 * 安卓 WebView 长按选中的「复制」由系统选区菜单直接写剪贴板，不经过 DOM 的 copy 事件，
 * 因此让公式本身不可选，改用长按手势识别，桌面端同时支持右键。
 */
const copyFormula = (value: string, isInline: boolean) => {
  const text = isInline ? `$${value}$` : `$$\n${value}\n$$`
  void copyText(text).then((ok) => {
    showToast(ok ? { key: 'latexCopied' } : { key: 'latexCopyFailed' })
  })
}

const useLongPressCopy = (value: string, isInline: boolean) => {
  const timer = useRef<number | undefined>(undefined)
  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }, [])
  const start = useCallback(() => {
    clear()
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      copyFormula(value, isInline)
    }, LONG_PRESS_MS)
  }, [clear, value, isInline])
  useEffect(() => clear, [clear])
  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: clear,
    onTouchCancel: clear,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault()
      copyFormula(value, isInline)
    },
  }
}

/** KaTeX 渲染公式；出错时保留上次成功的结果（流式中公式未写完），没有则展示原文 */
const useMathHtml = (input: string, isInline: boolean): MathHtmlResult => {
  const previousResultRef = useRef<MathHtmlResult | null>(null)
  const katexRef = useRef(ensureKatex())
  const [katex, setKatex] = useState<Katex | null>(
    katexRef.current instanceof Promise ? null : katexRef.current
  )

  useEffect(() => {
    if (katexRef.current instanceof Promise) {
      katexRef.current.then(setKatex, noop)
    }
  }, [])

  return useMemo((): MathHtmlResult => {
    if (!katex) {
      return { html: input, renderMode: 'fallback' }
    }
    try {
      const [prefix, suffix] = KATEX_WRAPPER[isInline ? 'inline' : 'display']
      const html = katex
        .renderToString(input, { throwOnError: true, strict: false, displayMode: !isInline })
        .slice(prefix.length, -suffix.length)
      const result = { html, renderMode: 'katex' } as const
      previousResultRef.current = result
      return result
    } catch {
      return previousResultRef.current ?? { html: input, renderMode: 'fallback' }
    }
  }, [input, isInline, katex])
}

export const MathBlock = memo(function MathBlock({ value }: { value: string }) {
  const { html, renderMode } = useMathHtml(value, false)
  const longPress = useLongPressCopy(value, false)
  if (renderMode === 'fallback') {
    return <p className="ds-markdown-paragraph">{html}</p>
  }
  // data-latex 保留给桌面端的 copy 事件拦截使用
  return (
    <span className="katex-display ds-markdown-math" style={NO_SELECT} title={value} {...longPress}>
      <span
        className="katex"
        data-latex={value}
        data-display="1"
        dangerouslySetInnerHTML={{ __html: html }}
      ></span>
    </span>
  )
})

export const InlineMath = memo(function InlineMath({ value }: { value: string }) {
  const { html, renderMode } = useMathHtml(value, true)
  const longPress = useLongPressCopy(value, true)
  if (renderMode === 'fallback') {
    return html
  }
  return (
    <span
      className="katex"
      style={NO_SELECT}
      data-latex={value}
      title={value}
      {...longPress}
      dangerouslySetInnerHTML={{ __html: html }}
    ></span>
  )
})
