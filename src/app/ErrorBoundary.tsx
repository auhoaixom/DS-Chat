import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  /** 捕获后渲染的内容。`reset` 清掉错误状态，让子树重新挂载 */
  fallback: (error: Error, reset: () => void, componentStack: string) => ReactNode
  /** 变化时自动清除错误状态：流式重生成结束后不必一直停在降级态 */
  resetKey?: unknown
  children: ReactNode
}

type State = { error: Error | null; componentStack: string }

/**
 * 渲染期异常兜底。React 18 只有 class 组件能捕获，
 * 事件处理器、异步回调与 Promise 拒绝都不在捕获范围，那些由各调用点自己处理。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // 没有上报后端，留一条给 adb logcat 抓
    // eslint-disable-next-line no-console
    console.error(`[render] ${error.name}: ${error.message}`, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.clear()
    }
  }

  clear = () => this.setState({ error: null, componentStack: '' })

  override render() {
    const { error, componentStack } = this.state
    return error ? this.props.fallback(error, this.clear, componentStack) : this.props.children
  }
}
