# 雨课堂助手 - AI配置设置指南

## 概述

本指南将帮助您正确配置雨课堂助手的AI答案分析功能，并解决配置传入和日志输出问题。

## 配置文件结构

### 主配置文件 (config.json)

所有参数统一保存在项目目录下的 `config.json` 中，完整示例见 `config.example.json`。首次使用可复制示例为 `config.json`；已有主配置时只修改其中的 AI 字段，避免覆盖登录和其他设置。

项目目录下没有主配置时，程序仍支持从 `%APPDATA%\RainClassroomAssistant\config.json` 迁移旧版主配置。

### 在应用设置中配置

主窗口的设置对话框已提供当前主配置的全部 42 个参数，分为四个页面：

- **课堂自动化**：签到延迟、自动答题及延迟策略、自动弹幕阈值。
- **提醒通知**：语音提醒类型，以及邮件服务器、端口、账号、授权码、收发件地址、主题、SSL、STARTTLS 和超时。
- **AI 分析**：启用开关、密钥、基础地址、模型、协议、流式响应、推理强度、推理摘要、输出上限、重试次数、超时和请求间隔。
- **登录与平台**：雨课堂平台和 `sessionid`；通常仍可通过主窗口扫码登录。

“发送测试邮件”使用当前表单中尚未保存的邮件设置，测试不会写入配置文件。已启用的邮件或 AI 功能缺少必填字段时，保存会定位到对应页面提示补充。

AI 输出 token 上限设为 `0` 时保存为 `null`，表示使用接口默认额度；推理摘要选择“不请求摘要”同样保存为 `null`。推理强度与摘要可直接输入服务商支持的值，仅在 Responses 协议下启用。SSL 直连开启时，STARTTLS 选项暂时禁用并保留原值。

密钥、邮箱密码和会话默认隐藏，可在“登录与平台”页切换显示。取消不会更改运行中的配置；保存会写入项目目录的 `config.json`。运行中的课程任务需要停止监听再重新启动，登录信息修改后需要重启应用。

### AI参数

在 `config.json` 中设置以下字段：

```json
{
  "enable_ai_analysis": true,
  "openai_api_key": "your-api-key-here",
  "openai_api_base": "https://api.openai.com/v1",
  "openai_model": "your-vision-model",
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

`your-vision-model` 是占位符，请填写服务商实际支持图片输入及所选协议的模型名。以上是 AI 字段片段，应合并到已有主配置，避免覆盖登录等其他设置。

已移除独立的 `ai_config.json` 加载机制。旧用户如仅在该文件保存过 AI 参数，请先将其中的 AI 字段合并到 `config.json`，再删除旧文件。修改主配置后重启程序生效。

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
   - 读取项目目录下的 `config.json`（缺失时尝试迁移旧版APPDATA主配置）
   - 使用主配置覆盖默认值，并递归补齐缺少的设置
   - 将补齐后的配置保存到 `config.json`

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
- **推理与用量**：流式读取时合并推理摘要片段，响应完成后一次性记录完整摘要，以及输入、输出、推理 token 数；服务商未返回的字段标记为“未提供”。截断、失败或流中断不会保存为有效答案。以上设置修改后重启程序生效。

### 日志示例

```
[AI分析器] AI分析器初始化 - 启用状态: True
[AI分析器] AI模型: your-vision-model
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
typing_extensions>=4.15.0
```

### 安装依赖

```bash
pip install -r requirements.txt
```

## 测试配置

### 运行配置测试

```bash
python -m pytest test_config_loading.py -q
```

该脚本会：
- 检查配置文件位置
- 验证主配置字段保留和默认值补齐
- 验证旧的独立AI配置文件不再覆盖主配置
- 验证旧版APPDATA主配置迁移

## 故障排除

### 常见问题

1. **配置未生效**
   - 确保修改的是项目根目录下的 `config.json`
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
├── config.json                 # 主配置（包含AI参数）
├── config.example.json         # 完整主配置示例
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

1. ✅ **配置统一管理**：AI参数直接从主配置读取
2. ✅ **日志输出清晰**：统一的日志格式和详细的状态信息
3. ✅ **错误处理完善**：清晰的错误信息和处理建议
4. ✅ **测试工具完备**：提供配置测试脚本进行诊断

现在您可以正常使用AI答案分析功能，并通过清晰的日志输出了解程序运行状态。
