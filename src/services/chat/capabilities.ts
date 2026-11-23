/**
 * 服务端能力的模型门槛。
 *
 * DeepSeek 的服务端工具（`deepseek_web_search`、`deepseek_read_url`）、标题生成
 * 和 `latest_reminder` 角色消息目前只对 flash 系列开放。对其它模型发这些字段，
 * 服务端会整条请求拒掉，报的是：
 *
 *   The server-side tool calls (...) and the title generation feature are unavailable
 *   for model deepseek-v4-pro. Please use deepseek-flash instead.
 *
 * 所以这里按模型名判断，不支持的模型一律降级成"纯对话"：不带工具、不要标题、
 * 不注入 reminder。模型名是用户自己填的，只认名字里的 `flash`——官方命名
 * 一直是 `deepseek-flash` / `deepseek-v4.1-flash` 这种形式。
 */
export const supportsServerFeatures = (model: string): boolean => /flash/i.test(model)
