# RainClassroomAssistant

基于 Electron、React 和严格 TypeScript 的雨课堂桌面助手。当前桌面应用源码位于 [`desktop/`](desktop/)；早期 Python 实现仅保留作迁移参考，不再作为发布入口。

## 获取与启动

从[最新 Release](https://github.com/infstellar/RainClassroomAssistant/releases/latest)下载 Windows Setup 安装版，或下载便携版 `RainClassroomAssistant.exe`。安装版启动 5 秒后自动检查更新，运行期间每 4 小时复查，也可点击右上角“检查更新”。新版本在后台下载，完成后可点击“重启并安装”，或在正常退出时自动安装。便携版需要从 Release 手动下载新版本替换；界面提供“版本下载”入口。

首次启动后，在设置中选择雨课堂平台并扫码登录。连接账号后启动监听，应用会查看进行中的课堂，并按设置加入课堂、处理题目和弹幕。雨课堂仍需在浏览器或官方客户端保持打开；自动答案和 AI 分析需要自行核验。

设置页面管理平台、自动签到、自动答题、弹幕跟随、语音提醒、邮件通知和 AI 分析。修改配置后点“保存设置”；运行中的课堂使用更新后的配置时，停止并重新启动监听。

## 功能

- 扫码登录四个雨课堂平台，恢复已保存会话并轮询进行中的课程。
- 按配置延迟加入课堂，接收课件、题目、点名和弹幕事件。
- 下载课件图片并生成 PDF；缓存课程答案并支持 AI 视觉分析。
- AI 答案不完整时逐步加入同一课件的前置页重试，现场答题也可下载题图和上下文即时分析。
- 按重复弹幕阈值跟随发送，按事件类别使用系统语音提醒，并通过 SMTP 发送答题状态邮件。
- 按级别筛选和搜索运行日志、查看近期事件、检测版本更新。

## 数据与隐私

桌面应用将配置、日志、课件、题图和答案缓存保存在 Electron 用户数据目录。可在设置页管理配置，使用“打开日志目录”定位日志。首次运行会把可找到的旧版配置、`ai_answers_cache/` 和 `downloads/` 复制到新位置，原数据保留。

配置文件以明文保存 `sessionid`、AI API 密钥和邮箱凭据。不要分享配置文件或未脱敏日志。启用 AI 后，题目图片及必要的前置课件页会发送到所配置的模型服务商；请确认有权提供这些内容，并自行评估服务商的数据处理和 API 费用。

日志以 JSONL 顺序写入，保留多行消息结构、自动隐藏常见凭据，并按 10 MB 轮转。界面显示最近 500 条事件，也能读取旧版文本日志。答案缓存使用原子写入；课件题目签名变化时保留旧缓存备份并重新分析。

## 开发

需要 Node.js 22。Windows 开发命令：

```powershell
cd desktop
npm ci
npm run dev
```

运行单元测试和严格 TypeScript 检查：

```powershell
npm test
npm run build
npm run test:smoke
```

在 Windows 本地生成安装版和便携版：

```powershell
npm run dist
```

## 发布

GitHub Actions 的 `TypeScript desktop release` 工作流只响应形如 `vMAJOR.MINOR.PATCH` 的新标签。标签必须属于 `main` 历史，且版本号必须与 `desktop/package.json` 相同。工作流运行测试、严格构建、Windows 打包，并验证安装包、便携包、更新元数据、兼容版本文件和 SHA-256 后创建 Release。

普通提交和 Pull Request 使用 `TypeScript desktop checks` 检查格式、单元/集成测试、构建和 Electron 界面。迁移对应关系和验收范围见 [迁移说明](desktop/MIGRATION.md)。


发布采用 GitHub 自带的 `GITHUB_TOKEN`，不需要额外配置个人访问令牌。仓库需启用 Actions；发布任务申请 `contents: write` 权限。安装包暂未配置代码签名证书，Windows 可能显示未知发布者提示。

每次发布先在 `main` 更新 `desktop/package.json` 与锁文件中的版本号，提交后推送分支，再推送同名标签。示例（在项目根目录执行，版本以实际值为准）：

```powershell
cd desktop
npm version 0.5.1 --no-git-tag-version
cd ..
git add desktop/package.json desktop/package-lock.json
git commit -m "chore: release v0.5.1"
git push origin main
git tag v0.5.1
git push origin v0.5.1
```

首次发布前，请先把整个桌面重构和 `.github/workflows/desktop-*.yml` 合入 `main`。发布任务会核对版本、安装包大小及 SHA-512，生成 `SHA256SUMS.txt`，并在草稿 Release 上传全部文件后公开。任何检查失败都不会公开新版；失败后可重跑工作流，已公开的版本禁止覆盖，应递增版本重新发布。

安装版更新依赖 Release 中的 `latest.yml`、对应的 Setup EXE 和 `.blockmap`，请保留这些资产。`version.txt` 与固定名称便携包保留给早期 Python 更新器使用。便携版用户可改装 Setup 版以获得后续自动更新。首次端到端验收需要先发布一个安装版，再发布更高版本，确认旧版能下载并安装更新；本地测试不能代替这一步。
