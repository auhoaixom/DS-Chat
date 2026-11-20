import type { Katex } from './katex.js'

/** renderToString 外层包裹的标签，组件自己渲染外层，这里切掉 */
const KATEX_WRAPPER = {
  inline: ['<span class="katex">', '</span>'],
  display: ['<span class="katex-display"><span class="katex">', '</span></span>'],
} as const

/**
 * 模型输出的公式不能用「写了什么就渲染什么」的策略：
 * KaTeX 遇到一个不认识的控制序列就整段抛错，之前整段公式会退化成源码文本。
 * 这里按「先原样渲染 → 用宏补齐常见命令 → 逐个修复报错的命令 → 换展示模式重试」的顺序兜底。
 */

/** 常见的非 KaTeX 命令，用等价的 KaTeX 写法补齐 */
const MACROS: Record<string, string> = {
  '\\bm': '\\boldsymbol{#1}',
  '\\pmb': '\\boldsymbol{#1}',
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
  '\\sech': '\\operatorname{sech}',
  '\\csch': '\\operatorname{csch}',
  '\\arsinh': '\\operatorname{arsinh}',
  '\\arcosh': '\\operatorname{arcosh}',
  '\\artanh': '\\operatorname{artanh}',
  '\\limlimits': '\\lim',
  '\\qed': '\\square',
  '\\degree': '^{\\circ}',
  '\\textdegree': '^{\\circ}',
  '\\Arg': '\\operatorname{Arg}',
  '\\sgn': '\\operatorname{sgn}',
  '\\rank': '\\operatorname{rank}',
  '\\tr': '\\operatorname{tr}',
  '\\diag': '\\operatorname{diag}',
  '\\coloneqq': ':=',
  '\\eqdef': ':=',
}

/**
 * 这些结构本身就只能是展示模式，行内渲染必然报错或挤成一团。
 * 模型经常把整段推导写在一行里（`$$\\begin{align}...\\end{align}$$`），
 * 导致 AST 把它当行内公式，这正是「部分公式渲染不出来」的主因。
 */
const DISPLAY_HINT = /\\begin\{|\\tag\b|\\label\b|\\intertext\b|\\displaystyle\b|\\\\/

export const needsDisplay = (value: string): boolean => DISPLAY_HINT.test(value)

export interface MathRender {
  html: string
  display: boolean
  ok: boolean
}

const strip = (html: string, display: boolean): string => {
  const [prefix, suffix] = KATEX_WRAPPER[display ? 'display' : 'inline']
  return html.slice(prefix.length, -suffix.length)
}

const render = (katex: Katex, value: string, display: boolean): string =>
  strip(
    katex.renderToString(value, {
      throwOnError: true,
      strict: false,
      displayMode: display,
      macros: MACROS,
      trust: false,
    }),
    display
  )

/** 只带元信息、排版上可以整段丢掉的命令（连参数一起删） */
const DROPPABLE = new Set(['label', 'eqref', 'ref', 'vspace', 'index', 'nonumber', 'notag'])

/** 把命令单独换掉，避免改到同前缀的更长命令（\\sec vs \\sech） */
const replaceCommand = (value: string, name: string, replacement: string): string =>
  value.replace(new RegExp(`\\\\${name}(?![A-Za-z])`, 'g'), replacement)

const dropCommand = (value: string, name: string): string =>
  value.replace(new RegExp(`\\\\${name}(?![A-Za-z])\\s*(?:\\{[^{}]*\\})?`, 'g'), '')

/** 去掉只有排版意义、KaTeX 不认识的命令 */
const STRIPPABLE = /\\(?:label|eqref|ref|vspace)\s*\{[^{}]*\}/g

/** 按报错内容修一次；无法再修时返回 null */
const repair = (value: string, error: unknown): string | null => {
  const message = error instanceof Error ? error.message : String(error)
  const undefinedName = message.match(/Undefined control sequence: \\([A-Za-z]+)/)?.[1]
  if (undefinedName) {
    // 编号、间距这类命令删掉即可，绝不能变成 \operatorname{label}{...} 印在公式里
    if (DROPPABLE.has(undefinedName)) {
      return dropCommand(value, undefinedName)
    }
    const macro = MACROS[`\\${undefinedName}`]
    // 宏里没有的直接当函数名排出来，至少保留公式结构
    return replaceCommand(value, undefinedName, macro ?? `\\operatorname{${undefinedName}}`)
  }
  if (/\\tag works only in display/.test(message)) {
    // 行内上下文里 KaTeX 不允许 \tag，改成显式的编号
    return value.replace(/\\tag\*?\{([^{}]*)\}/g, '\\quad\\text{($1)}')
  }
  if (/\\overparen/.test(value)) {
    return value.replace(/\\overparen\{([^{}]*)\}/g, '\\overset{\\frown}{$1}')
  }
  if (/\\hdotsfor/.test(value)) {
    return value.replace(/\\hdotsfor\s*\{[^{}]*\}/g, '\\dots')
  }
  if (/\\multicolumn/.test(value)) {
    return value.replace(/\\multicolumn\s*\{[^{}]*\}\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, '$1')
  }
  if (/\\intertext/.test(value)) {
    return value.replace(/\\intertext\s*\{([^{}]*)\}/g, '\\text{$1}')
  }
  const stripped = value.replace(STRIPPABLE, '')
  return stripped === value ? null : stripped
}

/** 同一模式下反复修复，直到渲染成功或用尽修复手段 */
const attempt = (katex: Katex, value: string, display: boolean): string | null => {
  let current = value
  for (let guard = 0; guard < 12; guard += 1) {
    try {
      return render(katex, current, display)
    } catch (error) {
      const repaired = repair(current, error)
      if (repaired === null) {
        return null
      }
      current = repaired
    }
  }
  return null
}

/**
 * 渲染一段 LaTeX。
 * preferDisplay 为 true 时用展示模式；行内渲染失败时也会自动改用展示模式重试，
 * 因为 KaTeX 的 align/gather/tag 等结构只允许出现在展示模式里。
 */
export const renderMath = (katex: Katex, value: string, preferDisplay: boolean): MathRender => {
  const html = attempt(katex, value, preferDisplay)
  if (html !== null) {
    return { html, display: preferDisplay, ok: true }
  }
  if (!preferDisplay) {
    const asDisplay = attempt(katex, value, true)
    if (asDisplay !== null) {
      return { html: asDisplay, display: true, ok: true }
    }
  }
  return { html: '', display: preferDisplay, ok: false }
}
