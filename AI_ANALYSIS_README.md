# AI答案分析功能使用说明

## 功能概述

本功能通过集成OpenAI的视觉模型，能够自动分析PPT中的题目并提供答案建议。当PPT下载完成后，系统会自动启动AI分析，逐一分析包含问题的幻灯片，并将分析结果缓存到本地。

## 主要特性

1. **自动触发**: PPT下载完成后自动启动AI分析
2. **同步处理**: 使用单线程进行分析，确保分析完成后再继续
3. **智能缓存**: 分析结果本地缓存，避免重复分析
4. **答案覆盖**: 自动使用AI分析的答案覆盖原始答案
5. **错误处理**: 完善的异常处理和日志记录

## 配置方法

### 1. 安装依赖

```bash
pip install openai
```

### 2. 配置OpenAI API

在主配置文件中添加以下配置项：

```json
{
  "enable_ai_analysis": true,
  "openai_api_key": "your-openai-api-key-here",
  "openai_api_base": "https://api.openai.com/v1",
  "openai_model": "gpt-4-vision-preview"
}
```

### 3. 配置说明

- `enable_ai_analysis`: 是否启用AI分析功能
- `openai_api_key`: OpenAI API密钥
- `openai_api_base`: API基础URL（支持自定义代理）
- `openai_model`: 使用的模型名称

## 使用流程

1. **PPT下载**: 程序正常下载PPT到本地
2. **自动分析**: 下载完成后自动启动AI分析
3. **结果缓存**: 分析结果保存到 `ai_answers_cache` 目录
4. **答案应用**: 调用 `get_problems()` 时自动应用缓存的答案

## 缓存机制

- 缓存文件位置: `ai_answers_cache/课程名_PPT标题.json`
- 缓存格式: `{"幻灯片索引": [答案数组], ...}`
- 自动加载: 程序启动时自动加载已有缓存

## 注意事项

1. **API费用**: 使用OpenAI API会产生费用，请合理控制使用
2. **网络要求**: 需要稳定的网络连接访问OpenAI API
3. **模型限制**: 建议使用支持视觉的模型（如gpt-4-vision-preview）
4. **图片质量**: PPT图片质量会影响分析准确性

## 故障排除

### 常见问题

1. **API密钥错误**
   - 检查配置文件中的API密钥是否正确
   - 确认API密钥有足够的额度

2. **网络连接问题**
   - 检查网络连接
   - 如使用代理，确认API基础URL配置正确

3. **分析失败**
   - 查看控制台日志获取详细错误信息
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
└── ai_config_example.json      # 配置示例文件
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