/** 只取 key 需要的那几个字段，测试里可以只写这三样；Message 联合类型天然满足 */
type KeySource = { id: string; role: 'user' | 'assistant'; parentId?: string | null }

/**
 * 消息列里每个气泡的 React key。
 *
 * 提问用 `u:` + 自己的 id，回答用 `a:` + **父消息** id。两层前缀缺一不可：
 *
 * - 不加前缀会撞：一轮问答里回答的 `parentId` 就是提问的 `id`，两者原本取到同一个字符串
 *   （比如都是 `"3"`）。React 要求同一层 key 唯一，撞了之后它按 key 认领子节点，往上翻补载
 *   时就会把已经显示过的提问再复制一份、把回答和它的提问拆开、把后面的内容顶到输入框底下。
 *   正式包里没有控制台，这条路只能靠真机肉眼撞见，v1.4.8 起一直藏着。
 * - 回答必须按**父消息**取，不能按自己的 id：同一轮的多个版本是兄弟，换版本时 React 才会
 *   复用同一个组件实例，`content-visibility` 的实测高度不会丢，视口也就不会跳（v1.4.8 的
 *   本意）。按自己的 id 取的话每次换版本都整棵重挂。
 */
export const messageKey = (message: KeySource): string =>
  message.role === 'user' ? `u:${message.id}` : `a:${message.parentId ?? message.id}`

/** 给测试用：把一整列消息换成 key 列表，方便直接断言有没有重复 */
export const messageKeys = (messages: KeySource[]): string[] => messages.map(messageKey)
