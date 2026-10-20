# AI答案分析功能使用说明

## 功能概述

本功能通过支持图片输入的 API 模型分析课堂 PPT 中的题目，并将可用答案缓存到本地。支持下载后批量分析、答题时现场分析，以及上下文不足时扩展前置页面重试。默认关闭，需要配置后启用；自动提交还需要开启“自动答题”。

## 主要特性

1. **自动触发**: PPT下载完成后自动启动AI分析
2. **现场分析**: 实际答题时仍无答案，会尝试匹配 PPT、读取缓存或下载题图分析
3. **上下文重试**: 模型明确报告上下文不足时，逐步加入同一 PPT 中的前置页面
4. **本地缓存**: 重用可用答案，支持人工修改，非空人工答案优先于 AI 缓存
5. **失败处理**: 接口失败、没有可用答案或上下文不足不会作为有效答案缓存，需要人工处理

## 配置方法

### 1. 安装依赖

```bash
python -m pip install -r requirements.txt
```

### 2. 配置OpenAI API

点击主窗口“配置”，在“AI 分析”页填写并保存设置；也可以修改主配置 `config.json` 中的相应字段（下面仅展示 AI 字段，请合并到已有主配置）：

```json
{
  "enable_ai_analysis": true,
  "openai_api_key": "your-openai-api-key-here",
  "openai_api_base": "https://api.openai.com/v1",
  "openai_model": "your-vision-model",
  "ai_analysis_settings": {
    "protocol": "responses"
  }
}
```

### 3. 配置说明

- `enable_ai_analysis`: 是否启用AI分析功能
- `openai_api_key`: 所选 API 服务商提供的密钥
- `openai_api_base`: API 基础地址，例如 `https://api.openai.com/v1`，不要追加 `/responses` 或 `/chat/completions`
- `openai_model`: 填写服务商实际支持图片输入的模型名，不能直接使用上例占位符
- `ai_analysis_settings.protocol`: 默认 `responses`，可选 `chat_completions`；模型与服务商需要支持所选协议

完整示例见 [config.example.json](config.example.json)，流式响应、推理、输出上限、超时等设置见[配置指南](CONFIG_SETUP_GUIDE.md)。界面保存后停止监听再启动，让新建的课程任务读取配置；直接编辑 JSON 后重启应用。

## 使用流程

1. **下载后分析**：课件图片下载完成后，程序逐题分析并缓存可用结果。
2. **答题时分析**：程序先尝试使用已有答案和缓存；启用 AI 且仍无答案时，再尝试匹配当前题目及所属 PPT，下载题图现场分析。没有题图或匹配信息时可能无法完成分析。
3. **扩展上下文**：批量与现场分析中，只有模型明确返回“上下文不足”才进入扩展流程。依次尝试目标题页加前置页面，总图片数目标为 3、5、7、9，最多 4 轮；前置页面或本地图片不足时数量可能更少。接口错误或未识别到答案不等同于上下文不足。
4. **应用与人工处理**：可用答案写入缓存供后续答题使用；失败结果不作为答案提交。AI 不保证正确性，也不保证能在答题截止前完成，请留意提醒。

## 缓存机制

- 缓存位置：启动工作目录下的 `ai_answers_cache/课程名_PPT标题.json`，非法文件名字符会被替换。
- 当前格式：顶层包含 `metadata`、`answers`、`manual_answers`。旧的 `{"幻灯片索引": [答案数组], ...}` 格式仅为兼容读取。
- 读取时机：分析和答题流程需要答案时读取，后续读取可获得人工修改后的结果。
- 人工修改：沿用缓存中的幻灯片 `index` 作为键，将答案填写到 `manual_answers`；非空人工答案优先，`[]` 表示未填写，不会清除 AI 答案。保留其他元数据和题目条目。
- 示例与规则：参见 [README 的完整 JSON 示例](README.md#答案缓存与人工修改)。已提交的答案不会因修改缓存而自动重新提交。
- 题图位置：下载课件图片通常位于 `downloads/rainclasscache/`，现场分析图片位于 `ai_answers_cache/_live_images/`。

## 注意事项

1. **数据发送**：启用后会向配置的服务商发送题图，上下文重试还会发送前置课件页面，请确认有权提供这些内容。
2. **API 费用**：批量分析、现场分析、上下文重试均可能产生费用或消耗额度；缓存不能保证完全避免重复请求。
3. **网络与模型**：需要能访问配置的 API，模型必须支持图片和所选协议，推理参数按服务商支持情况填写。
4. **图片与准确性**：图片清晰度、上下文及模型能力都会影响结果，需要自行核验。
5. **凭据保护**：主配置明文保存密钥及登录凭据，日志与缓存可能含课程、题目或个人信息，反馈前务必脱敏。详见 [README](README.md#数据隐私与-api-费用)。

## 故障排除

### 常见问题

1. **API密钥错误**
   - 检查配置文件中的API密钥是否正确
   - 确认API密钥有足够的额度

2. **网络连接问题**
   - 检查网络连接
   - 如使用代理，确认API基础URL配置正确

3. **分析失败**
   - 查看界面日志和本地日志获取详细错误信息，日志位置见 [README](README.md#常见问题与反馈)
   - 检查PPT图片是否正常下载

### 日志信息

程序会在界面中显示以下信息：
- `已启动AI分析: [PPT标题]` - 分析开始
- `AI分析完成: [PPT标题]，共分析 X 个问题` - 分析完成
- `应用AI缓存答案 - 幻灯片 X: [答案]` - 应用缓存答案

## 文件结构

```
RainClassroomAssistant/
├── Scripts/
│   ├── AIAnswerAnalyzer.py     # AI分析器核心模块
│   └── Classes.py              # 集成AI功能的主类
├── ai_answers_cache/           # AI分析结果缓存目录
│   └── 课程名_PPT标题.json     # 具体缓存文件
├── config.json                 # 主配置（包含AI参数）
└── config.example.json         # 完整主配置示例
```

## API调用示例

```python
# 手动触发分析
ai_analyzer = AIAnswerAnalyzer(config)
ai_analyzer.analyze_presentation(
    lesson_name="数学课",
    presentation_title="第一章",
    slides_data=slides,
    img_cache_path="/path/to/images",
    callback=analysis_callback
)

# 获取缓存答案
cached_answers = ai_analyzer.load_cached_answers("数学课", "第一章")

# 应用缓存答案到问题列表
problems = ai_analyzer.get_cached_answers_for_problems(
    "数学课", "第一章", problems
)
```
