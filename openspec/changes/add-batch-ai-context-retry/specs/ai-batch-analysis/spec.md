## ADDED Requirements

### Requirement: 批量预分析上下文不足时重试
批量 PPT AI 预分析 SHALL 在单图分析返回上下文不足时，使用同一个 PPT 的前置页面按 3、5、7、9 张图递增上下文重试。

#### Scenario: 第一次批量上下文重试成功
- **GIVEN** 当前题页在 `slides_data` 中有前置页面
- **AND** 单图 AI 分析返回上下文不足标记
- **WHEN** 批量预分析执行第一次上下文重试
- **THEN** 它发送最多 3 张本地图片，并且最后一张是目标题页
- **AND** 如果 AI 返回答案数组，该答案会写入批量答案缓存

#### Scenario: 批量上下文重试每次增加两张图片
- **GIVEN** 批量预分析持续收到上下文不足结果
- **WHEN** 它执行上下文重试
- **THEN** 它最多尝试 3、5、7、9 张图片
- **AND** 第四次上下文重试后停止

#### Scenario: 批量上下文来自当前 PPT 顺序
- **GIVEN** `slides_data` 包含当前 PPT 的页面顺序
- **WHEN** 批量预分析选择上下文图片
- **THEN** 只有当前题页之前和当前题页本身的页面可以被选择
- **AND** 最后一张图片 MUST 是当前题页

### Requirement: 批量预分析不得缓存上下文不足标记
批量 PPT AI 预分析 SHALL NOT 将 `__INSUFFICIENT_CONTEXT__` 写入 `answers` 缓存。

#### Scenario: 批量上下文仍然不足
- **GIVEN** 单图分析和所有上下文重试都返回上下文不足
- **WHEN** 批量预分析保存缓存
- **THEN** 该题页不会出现在 `answers` 中
- **AND** 该题页会作为失败页生成手动填写模板

#### Scenario: 批量上下文返回空答案
- **GIVEN** 上下文重试返回 `[]`
- **WHEN** 批量预分析保存缓存
- **THEN** 该题页不会出现在 `answers` 中
- **AND** 该结果不会继续触发更大上下文窗口

### Requirement: 历史上下文不足缓存不会命中
AI 答案缓存加载 SHALL 过滤历史遗留的 `__INSUFFICIENT_CONTEXT__` 值，避免自动答题提交该标记。

#### Scenario: 缓存包含上下文不足标记
- **GIVEN** 缓存文件的 `answers` 中某页值为 `__INSUFFICIENT_CONTEXT__`
- **WHEN** 系统加载缓存答案
- **THEN** 返回结果中不包含该页答案
