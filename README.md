# RainClassroomAssistant
## 原库https://github.com/travellerse/RainClassroomAssistant
## 原库https://github.com/TrickyDeath/RainClassroomAssitant

原库看起来摆了。

添加了LLM自动回答问题的功能。

## 已实现功能
 - 自动签到
 - 自动答题（仅限于上课过程中发布的选择题、多选题、填空题）
 - 自动发弹幕（一定时间内收到一定数量的弹幕后，自动跟风发送相同内容的弹幕）
 - 点名、收到题目等情况下的语音提醒
 - 多线程支持（此脚本支持在有多个正在上课课程的情况下使用）
 - 简洁美观的UI
 - 课堂ppt下载
 - LLM问题回答
  
## 项目介绍

突然多了几个stars，写一下项目介绍好了（）

### 基本功能

基本功能跟https://github.com/travellerse/RainClassroomAssistant 的项目基本一致，额外修复了一些下载失败、数据类型未验证的问题。

### LLM回答功能

- 参数配置：重命名ai_config_example.json为ai_config.json，然后填写参数

> 已知问题：只有第一次启动前填参数有效，因为原项目会把配置复制到USERDATA下。未来可能修复。

1. PPT下载完之后，会提取PPT的所有问题；
2. Scripts\AIAnswerAnalyzer.py 会拿着问题PPT发给AI；
3. 生成的答案json会放在ai_answers_cache目录下，文件名是PPT的文件名。

现在，答案json可以人工填写（我是这么干的，因为可以二次验证），填写完后无需重启，每次尝试回答问题会重新加载json保证最新。

填写json的方法在答案json中。例：
```json
"instructions": {
                        "manual_fill_guide": "人工填写说明：",
                        "format": "与AI答案格式相同，使用数组表示答案",
                        "examples": {
                            "单选题": "[\"A\"] 表示A选项正确，[\"B\"] 表示B选项正确",
                            "多选题": "[\"A\",\"C\"] 表示A、C选项正确",
                            "判断题": "目前没遇到过判断题，欢迎反馈",
                            "填空题": "例子：[\"8\",\"1152\"] 表示8、1152是正确答案。顺序与问题顺序一致。"
                        },
                        "usage": "1. 查看对应幻灯片图片；2. 在manual_answers中找到对应题目；3. 修改数组内容为正确答案；4. 可选择将答案移动到answers部分"
                    }
```

## 屎山问题

由于时间不多，所以有些代码是vibe coding出来的，很多屎山代码（特别是日志部分，原项目的日志系统有些变态了）。目前倒是不影响使用，未来有空会修复。