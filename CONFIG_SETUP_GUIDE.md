# 雨课堂助手 - AI配置设置指南

## 概述

本指南将帮助您正确配置雨课堂助手的AI答案分析功能，并解决配置传入和日志输出问题。

## 配置文件结构

### 1. 主配置文件 (config.json)

主配置文件位于：`%APPDATA%\RainClassroomAssistant\config.json`

该文件会自动合并 `ai_config.json` 中的AI相关配置。

### 2. AI配置文件 (ai_config.json)

在项目根目录创建 `ai_config.json` 文件：

```json
{
  "enable_ai_analysis": true,
  "openai_api_key": "your-api-key-here",
  "openai_api_base": "https://api.openai.com/v1",
  "openai_model": "gpt-4-vision-preview",
  "ai_analysis_settings": {
    "protocol": "responses",
    "stream": true,
    "reasoning_effort": "high",
    "reasoning_summary": "auto",
    "max_output_tokens": null,
    "max_retries": 3,
    "request_timeout": 30,
    "delay_between_requests": 1
  }
}
```

## 配置说明

### AI配置项

- `enable_ai_analysis`: 是否启用AI分析功能
- `openai_api_key`: OpenAI API密钥
- `openai_api_base`: API基础URL（支持第三方API）
- `openai_model`: 使用的AI模型
- `ai_analysis_settings`: AI分析设置
  - `protocol`: API协议，默认 `responses`；可设置为 `chat_completions`
  - `stream`: 默认 `true`，发送流式请求并逐事件读取；设为 `false` 可使用普通 JSON 响应。流式请求的 `request_timeout` 是连接/读取等待时间，不是整个生成过程的总时长。
  - `reasoning_effort`: Responses API 推理强度，默认 `high`，发送为 `reasoning.effort`。可选值包括 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，具体支持范围取决于所用模型和第三方API。此配置不用于 `chat_completions` 协议。参见 [OpenAI 官方推理文档](https://developers.openai.com/api/docs/guides/reasoning)。修改后重启程序生效。
  - `max_retries`: 最大重试次数
  - `reasoning_summary`: Responses API 推理摘要，默认 `auto`，摘要会独立显示在日志中，不混入答案；设为 `null` 可不请求摘要。具体支持情况取决于模型和第三方API。
  - `max_output_tokens`: 默认 `null`，不发送应用层输出额度限制，仍受模型、上下文和服务商的额度限制。可设置正整数，例如 `32768`；该额度包含推理与最终答案。`chat_completions` 下映射为 `max_tokens`。不再固定为 900。
  - `request_timeout`: 请求超时时间（秒）
  - `delay_between_requests`: 请求间延迟（秒）

## 配置加载流程

1. **程序启动时**：
   - 加载默认配置
   - 查找并合并 `ai_config.json` 配置
   - 生成最终配置文件

2. **AI分析器初始化**：
   - 检查 `enable_ai_analysis` 配置
   - 验证API密钥
   - 初始化OpenAI客户端
   - 输出详细的初始化日志

## 日志输出改进

### 新增日志功能

- **统一日志格式**：所有AI相关日志都带有 `[AI分析器]` 前缀
- **详细初始化信息**：显示启用状态、模型、API基础URL等
- **错误处理**：清晰的错误信息和处理建议
- **状态跟踪**：实时显示分析进度和结果
- **推理与用量**：流式记录推理摘要片段，完成时记录输入、输出、推理 token 数；服务商未返回的字段标记为“未提供”。截断、失败或流中断不会保存为有效答案。以上设置修改后重启程序生效。

### 日志示例

```
[AI分析器] AI分析器初始化 - 启用状态: True
[AI分析器] AI模型: gpt-4-vision-preview
[AI分析器] API基础URL: https://api.openai.com/v1
[AI分析器] OpenAI客户端初始化成功
[AI分析器] 开始AI分析: 演示文稿标题
[AI分析器] 正在分析幻灯片 1...
[AI分析器] 幻灯片 1 分析完成，答案: ['A', 'B']
[AI分析器] AI分析完成，共分析 5 个问题
[AI分析器] 应用AI缓存答案 - 幻灯片 1: ['A', 'B']
```

## 依赖更新

### 新增依赖

在 `requirements.txt` 中添加了：

```
openai>=1.0.0
typing_extensions>=4.5.0
```

### 安装依赖

```bash
pip install -r requirements.txt
```

## 测试配置

### 运行配置测试

```bash
python test_config_loading.py
```

该脚本会：
- 检查配置文件位置
- 验证配置合并
- 测试AI分析器初始化
- 显示详细的诊断信息

## 故障排除

### 常见问题

1. **配置未生效**
   - 确保 `ai_config.json` 在项目根目录
   - 检查JSON格式是否正确
   - 重启程序以重新加载配置

2. **OpenAI导入失败**
   - 更新依赖：`pip install -r requirements.txt`
   - 检查Python环境兼容性

3. **API调用失败**
   - 验证API密钥是否正确
   - 检查网络连接
   - 确认API基础URL是否可访问

### 调试步骤

1. 运行测试脚本检查配置
2. 查看程序启动日志
3. 检查AI分析器初始化信息
4. 验证API密钥和网络连接

## 文件结构

```
RainClassroomAssistant/
├── ai_config.json              # AI配置文件
├── ai_config_example.json      # 配置示例
├── test_config_loading.py      # 配置测试脚本
├── CONFIG_SETUP_GUIDE.md       # 本指南
├── AI_ANALYSIS_README.md       # AI功能详细说明
├── Scripts/
│   ├── AIAnswerAnalyzer.py     # AI分析器
│   ├── Classes.py              # 主要业务逻辑
│   └── Utils.py                # 工具函数
└── requirements.txt            # 依赖列表
```

## 总结

通过以上配置和改进：

1. ✅ **配置正确传入**：AI配置现在会自动合并到主配置中
2. ✅ **日志输出清晰**：统一的日志格式和详细的状态信息
3. ✅ **错误处理完善**：清晰的错误信息和处理建议
4. ✅ **测试工具完备**：提供配置测试脚本进行诊断

现在您可以正常使用AI答案分析功能，并通过清晰的日志输出了解程序运行状态。
