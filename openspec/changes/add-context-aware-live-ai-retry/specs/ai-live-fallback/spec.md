## ADDED Requirements

### Requirement: AI 可以表达上下文不足

当幻灯片包含题目但当前可见图片不足以回答时，AI 答案分析器 SHALL 支持一个独立的“上下文不足”结果。

#### Scenario: 模型报告上下文不足

- **GIVEN** 模型返回的是被接受的上下文不足标记
- **WHEN** 解析该响应
- **THEN** analyzer 返回的结果能够区别于 `[]` 和 API 失败

#### Scenario: 模型报告没有题目

- **GIVEN** 模型返回 `[]`
- **WHEN** 解析该响应
- **THEN** analyzer 将其视为未找到可用答案，而不是上下文不足

### Requirement: 现场兜底使用递增 PPT 上下文重试

当单页分析报告上下文不足时，现场 AI 兜底 SHALL 使用同一个 matched presentation 的前置页面进行重试。

#### Scenario: 第一次上下文重试成功

- **GIVEN** 当前 slide 已匹配到一个 PPT presentation
- **AND** 单页 AI 分析返回上下文不足
- **WHEN** 现场兜底执行第一次上下文重试
- **THEN** 它发送共 3 张图片，并且最后一张是目标题目页
- **AND** 如果 AI 返回答案数组，该答案会被缓存并用于提交

#### Scenario: 上下文重试每次增加两张图片

- **GIVEN** 现场兜底持续收到上下文不足结果
- **WHEN** 它执行重试
- **THEN** 它最多尝试 3、5、7、9 张图片
- **AND** 第四次上下文重试后停止

#### Scenario: 上下文来自同一个 presentation

- **GIVEN** 当前课程已知多个 presentation
- **WHEN** 选择上下文图片
- **THEN** 只有 matched current presentation 中的 slides 可以被选择
- **AND** slide 顺序来自拉取到的 PPT 数据，而不是仅依赖文件名排序

#### Scenario: 上下文仍然不足

- **GIVEN** 所有允许的上下文重试都返回上下文不足
- **WHEN** 现场兜底结束
- **THEN** 不提交任何答案
- **AND** 提示用户在原答题时间内手动回答

### Requirement: 上下文重试过程可观测

现场 AI 兜底 SHALL 记录足够日志，用于排查上下文重试行为。

#### Scenario: 重试日志包含选中的上下文

- **GIVEN** 触发了一次上下文重试
- **WHEN** 重试开始
- **THEN** 日志包含重试编号、总图片数、选中的 slide indexes 和目标 slide index

#### Scenario: 图片准备日志标识来源

- **GIVEN** 需要一张上下文图片
- **WHEN** 现场兜底准备该图片
- **THEN** 日志标明它是复用本地缓存图片，还是从 PPT cover URL 下载
