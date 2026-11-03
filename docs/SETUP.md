# 从 GitHub 到 Supabase、Vercel 的逐步连接

先完成免费本地扫描与云存储连接，OpenAI 放最后。无需搭建独立 Node.js 服务器：Next.js API 在 Vercel 的 Node.js 运行时执行。

## 1. 创建 Supabase 项目

1. 打开 https://supabase.com/dashboard ，登录你的账号。
2. 点击 New project，选择自己的组织，项目名可用 `myscanner`。
3. 选择适用的免费方案（以控制台实际显示为准），设置数据库密码并自行妥善保管。此应用不需要把数据库密码填入代码。
4. 选择靠近使用者的区域，例如 Singapore（若提供）。等待项目状态就绪。
5. 打开项目的 SQL Editor → New query。
6. 从 GitHub 打开 `supabase/migrations/001_initial.sql`，复制全部内容到 SQL Editor，运行一次。必须在新的项目执行；再次运行会因表已存在而报错，不要为了重跑而删除已有数据。
7. 在 Table Editor 确认 7 张表：projects、assets、source_files、pages、ocr_results、revisions、api_calls。
8. 在 Storage 确认 `scanner-originals` 桶存在，并且 Public 为关闭。不要将桶改为公开，也不要添加允许 anon 读写的策略。

迁移在单个事务执行，失败会回滚。遇到错误先记录错误信息；不需要关闭 RLS。

## 2. 找到服务器连接值

在 Supabase 项目的 Connect / Settings 页面找到：

| Vercel 变量名 | 从哪里取值 |
|---|---|
| `SUPABASE_URL` | 项目 API URL，例如 `https://你的项目.supabase.co`，不是数据库连接串 |
| `SUPABASE_SECRET_KEY` | Settings → API Keys 的 Secret key，通常以 `sb_secret_` 开头 |

当前 Supabase 推荐服务器使用 Secret key。它映射到 service_role 并绕过 RLS，必须只存服务器环境变量。本应用没有账号，所有数据访问由服务器的项目凭证校验控制。

若旧项目只有 legacy `service_role` JWT，可暂用 `SUPABASE_SERVICE_ROLE_KEY`；新项目优先填写 `SUPABASE_SECRET_KEY`，旧变量留空。两者都配置时新 Secret 优先。不要用 publishable/anon key 代替，应用也不需要 `NEXT_PUBLIC_SUPABASE_*`。

密钥直接填入 Vercel，不要发到聊天、截图、GitHub 或网页输入框。

## 3. 将 GitHub 仓库导入 Vercel

1. 打开 https://vercel.com/new ，登录账号。
2. 选择 Add New → Project / Import Git Repository。
3. 连接你的 GitHub，只授权需要的仓库，选择 `Jian018/Myscanner` → Import。
4. Framework Preset 选 Next.js。
5. Root Directory 保持仓库根目录 `./`。不要选 `src`；GitHub 仓库本身已经是项目根目录。
6. Node.js 选 24.x（若控制台当前提供）。
7. 使用仓库 packageManager / lockfile 的 pnpm。Install Command 可保持自动，或填 `pnpm install --frozen-lockfile`；Build Command 为 `pnpm build`；Output Directory 使用 Next.js 默认，不填 `out`。
8. 展开 Environment Variables，添加 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`。选择需要的 Production / Preview 环境。生产环境和测试环境建议使用独立 Supabase 项目。
9. 点击 Deploy，等待 Ready，打开分配的 HTTPS 域名。

若安装步骤提示 pnpm 版本，确认项目的 `packageManager` 是 `pnpm@11.25.0`，可使用控制台支持的 Corepack；不要删除 lockfile 来绕过问题。`postinstall` 必须执行，它会准备浏览器运行资源。构建不需要数据库或 OpenAI 密钥，可以先部署纯本地扫描版，再加环境变量。

环境变量在项目 Settings → Environment Variables 修改。修改后需 Redeploy 才应用。Key 用 Secret 类型（若控制台提供类型选择），不要加入 `NEXT_PUBLIC_` 前缀。

本阶段没有网站账号或访问控制。建议在 Vercel 控制台启用适合个人使用的 Deployment Protection（以你的方案可用功能为准）；项目随机凭证负责隔离文档，不能防止陌生访客创建项目、占用资源。

## 4. 验证云端保存

1. 在部署后的站点上传一张无敏感内容的 JPG，确认可以预览。
2. 点击免费 OCR，修订一处文字，在“修订记录”确认存在记录。
3. 点击“保存云端”，等待完成。创建云端项目及上传必须由你主动触发；修改后要再次保存。
4. 打开顶栏云图标或侧栏“云端项目与访问凭证”，点击“保存访问凭证文件”，私密保管。
5. 在 Supabase Table Editor 查看 projects、pages、ocr_results、revisions；在 Storage 查看该项目 UUID 目录下的原文件、页面原图和处理图。
6. 在另一台设备打开同一个 Vercel 域名，进入“云端项目”，输入项目 ID 和访问凭证，载入后确认图片和修订文字存在。
7. 两台设备同时编辑时，旧版本保存会显示版本冲突。先导出本机 DOCX 留底，再载入云端，手动合并后保存。

访问凭证不是 Supabase Key，也不是账号。拥有它即可读写项目，没有找回功能。不要将凭证文件上传到 GitHub。

## 5. 在 iPhone 验证拍照

1. 用 Safari 打开正式 HTTPS 域名，点击拍照扫描。
2. 选择拍照或从照片图库选图，允许你主动触发的拍照操作。
3. 如果 HEIC 解码失败，在 iPhone 设置 → 相机 → 格式选择“兼容性最佳”，或先转成 JPG 再上传。
4. 调整四角、旋转，再 OCR；检查竖屏的上下对照布局。
5. 导出文件通常进入 Safari 下载列表 / “文件”App；浏览器可能会询问是否允许下载，由你确认。

桌面设备可以从手机选图或上传文件；相机文件输入的具体选择器由系统决定。首期不是实时视频扫描。

## 6. 可选连接 OpenAI（会产生 API 费用）

1. 在自己的 OpenAI API 控制台创建项目和密钥，确认计费、预算、模型权限已就绪。ChatGPT 订阅不等同 API 额度。
2. 在官方模型目录选择当前可用、支持图像输入和 Structured Outputs 的文本模型。代码没有硬编码模型名，避免过期后误调用。
3. 记录该模型的输入、缓存输入和输出单价（每百万 Tokens、USD），查官方价格页面，不要猜价格或混用不同模型的费率。
4. 在 Vercel 添加下表变量，Redeploy。

| 变量 | 值 |
|---|---|
| `OPENAI_API_KEY` | 你自己的服务器 API Key |
| `OPENAI_MODEL` | 你已确认可用的视觉文本模型 ID |
| `OPENAI_INPUT_USD_PER_MILLION` | 输入 Tokens 每百万美元单价 |
| `OPENAI_CACHED_INPUT_USD_PER_MILLION` | 缓存输入每百万单价；不确定时先查证，不要填猜测值 |
| `OPENAI_OUTPUT_USD_PER_MILLION` | 输出 Tokens 每百万美元单价 |
| `AI_DAILY_LIMIT` | 推荐先设 `5`；默认 `20`，允许 1–1000 |

未完整填写价格、模型、Supabase 和 Key 时，AI 按钮保持关闭。没有任何 AI 自动调用。点击“AI 分析当前页”后确认，服务器先保存项目，然后只将该页处理图发送到 OpenAI（免费 OCR 不受影响）。

点击顶栏用量图标查看 Token 和估算费用。Supabase `api_calls` 保存单价快照和调用记录，额度按全站 UTC 当日计数，失败占位也算一次，防止超时后无限重试。每次请求最多尝试一次，输出 Token 上限 8000。

`reserved` / `unknown`：可能已调用、已计费但未确认，请先在 OpenAI 控制台核对，不能当作免费失败自动重试。估算费用不是强制美元预算，除了每日次数限制，还应设置 OpenAI 项目预算/告警。

AI 返回文字、结构和待检查项。它不会自动替换编辑区，点击“采用 AI 文字并记录修订”后才进入导出。AI 仍可能错误；请逐项核对并勾选人工检查。

## 7. 故障排查

| 现象 | 处理 |
|---|---|
| 保存云端按钮灰色 | 确认两个 Supabase 变量已填，并重新部署；刷新页面 |
| 数据库未就绪 | 确认运行完整 SQL，7 张表和三个 RPC 存在 |
| 上传失败 | 检查桶名、文件大小/类型、Supabase 项目状态；不要公开桶或关闭 RLS |
| OCR 加载失败 | 检查 `/vendor/tesseract-worker.min.js` 与 core 文件可访问；首次语言包需要网络 |
| OpenCV / PDF.js 404 | 检查 postinstall 是否执行，不要使用 `--ignore-scripts` 安装 |
| AI 按钮灰色 | 检查完整模型、Key、价格和 Supabase 配置，确认数值有效 |
| AI 502 / 超时 | 先查 api_calls 与 OpenAI 记录，不要盲目重试 |
| 版本冲突 409 | 导出本机文字留底，再载入云端项目并手动合并 |
| 换域名后项目消失 | 本机存储按域名隔离，原域名主动云端保存或导出后再切换 |

## 官方参考

- Supabase API Keys：https://supabase.com/docs/guides/getting-started/api-keys
- Supabase Storage 访问控制：https://supabase.com/docs/guides/storage/security/access-control
- Vercel Git 部署：https://vercel.com/docs/git
- Vercel 环境变量：https://vercel.com/docs/environment-variables
- OpenAI 图像输入：https://developers.openai.com/api/docs/guides/images-vision
- OpenAI Structured Outputs：https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI 模型：https://developers.openai.com/api/docs/models
- OpenAI 价格：https://developers.openai.com/api/docs/pricing
