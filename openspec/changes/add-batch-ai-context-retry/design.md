## Context

当前 `AIAnswerAnalyzer.analyze_presentation()` 在批量预分析时只调用单图分析。模型按 prompt 返回“上下文不足”时，解析器会返回内部标记 `__INSUFFICIENT_CONTEXT__`；该标记是非空字符串，现有 `if ai_answers:` 分支会把它当作有效答案写入缓存。

现场 AI 兜底已经在 `Lesson` 中实现了 3/5/7/9 张图的上下文重试。本变更把同样的重试语义扩展到批量预分析，但实现放在 `AIAnswerAnalyzer` 内，保持批量分析不依赖现场答题对象。

## Goals / Non-Goals

**Goals:**

- 批量预分析遇到上下文不足时，按 3、5、7、9 张图从当前 PPT 前置页面补上下文重试。
- 上下文图片顺序遵循 `slides_data` 顺序，最后一张始终是目标题页。
- 上下文重试成功后缓存真实答案。
- 上下文重试失败时不缓存 `__INSUFFICIENT_CONTEXT__`，并保留失败页模板。
- 读取缓存时过滤历史遗留的上下文不足标记，避免提交风险。

**Non-Goals:**

- 不改变现场兜底的实现和提交格式。
- 不引入跨 PPT 上下文选择。
- 不新增配置项控制窗口大小。
- 不主动迁移或删除磁盘上的旧缓存文件。

## Decisions

### 数据流

批量预分析仍从 `problem_slides` 顺序逐页处理。每个题页先执行 `analyze_slide_with_openai()` 单图请求；若返回可用答案则缓存。若返回上下文不足标记，则调用新的批量上下文重试 helper：

1. 在完整 `slides_data` 中定位当前 slide。
2. 对窗口大小 3、5、7、9 依次选择 `matched_position - (total_images - 1)` 到 `matched_position` 的页面。
3. 将存在本地图片的页面转换为图片路径；如果目标页图片缺失，则该次重试不可执行。
4. 调用 `analyze_slide_with_context(image_paths, slide_index)`。
5. 返回可用答案即结束；返回上下文不足则继续；返回 `[]` 或 API 失败则停止并视为失败。

### 接口/方法边界

在 `AIAnswerAnalyzer` 中增加小型私有 helper：

- `_is_insufficient_context_answer(answer)`：统一判断内部标记。
- `_select_context_slides(slides_data, matched_slide, total_images)`：根据 `slides_data` 顺序选择上下文窗口。
- `_prepare_batch_context_images(context_slides, img_cache_path)`：把窗口 slide 转成本地图片路径。
- `_retry_batch_with_context(slides_data, slide, img_cache_path)`：执行 3/5/7/9 重试并返回答案、空答案或失败。

这样现场兜底仍使用 `Lesson` 自己的现场图片下载逻辑，批量预分析只使用已下载到 `img_cache_path` 的 PPT 图片。

### 错误处理

- 单图返回上下文不足：进入批量上下文重试。
- 上下文窗口中部分前置页图片缺失：跳过缺失图片并记录日志；只要目标页存在，仍用可用图片请求。若最终图片数小于 2，可继续发送目标页加已有前置页，但日志要显示实际数量。
- 上下文重试仍上下文不足：继续下一个窗口，耗尽后视为失败页。
- 上下文重试返回 `[]`：视为未识别到可用答案，停止重试并生成模板。
- API 失败返回 `None`：停止重试并生成模板。
- 读取缓存时发现答案值等于 `__INSUFFICIENT_CONTEXT__`：过滤掉，不作为缓存命中。

### 日志

批量路径增加日志：

- 单图报告上下文不足。
- 每次上下文重试的编号、期望图片数、实际图片数、选中的 slide index、目标 slide。
- 上下文重试返回内容。
- 上下文重试成功、无答案、失败或耗尽。

### 测试策略

- 单图返回上下文不足，3 图上下文重试返回答案，应缓存该答案。
- 上下文重试 3/5/7/9 全部返回上下文不足，应不缓存 marker，并生成失败状态。
- 旧缓存包含 `__INSUFFICIENT_CONTEXT__` 时，加载结果应过滤该页。
- 现有现场兜底测试保持通过，证明现场路径未被破坏。

## Risks / Trade-offs

- API 成本增加 → 仅在模型明确报告上下文不足时触发，并限制最多 4 次。
- 上下文图片缺失导致命中率下降 → 使用可用图片继续尝试，同时记录实际图片数便于排查。
- 与现场兜底逻辑出现重复 → 当前优先保持两个路径资源边界清晰；未来可在 `AIAnswerAnalyzer` 内进一步抽取通用窗口选择逻辑。

## Migration Plan

部署后无需一次性迁移缓存。运行时读取缓存会过滤历史上下文不足标记；后续批量预分析也不会再写入该标记。若用户希望立即清理，可手动删除对应 PPT 缓存文件重新分析。

## Open Questions

无。窗口大小沿用现场兜底固定策略。
