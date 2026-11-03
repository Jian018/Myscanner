# AI Smart Scanner · 第一阶段

## 技术和数据边界

Next.js App Router + TypeScript + React + Tailwind；Vercel 运行 Node.js API。图像解码、OpenCV、Tesseract、PDF 渲染及导出在浏览器执行。IndexedDB 存原文件 Blob 和项目。OpenAI SDK 仅在用户点击分析并确认单页后由服务器使用。Supabase 服务密钥永不发送到客户端，私有 Storage 使用短期签名。

无账号：每个云项目创建 256-bit 随机凭证，服务器只存 SHA-256；请求用 Authorization Bearer。UUID 不是访问凭证。凭证保存在本机 IndexedDB，不进入 URL。持有凭证即有读写权限；没有找回、撤销、成员管理、跨设备自动同步功能。创建新项目不会删除旧项目。

原图只追加保存，不自动删除；原 PDF 文件单独保存，各渲染页面单独保存原图。sourcePage 永远代表原文件内页码，order 仅代表当前顺序。处理图另建 UUID，重复裁切不覆盖原图。纸张边缘不可靠时保留全幅，提醒手动调整。处理后旧 OCR 作废并需重新识别。

## 目录

- src/app: 页面与 API 路由
- src/components: 扫描工作台与手动裁切
- src/lib/client: 文件导入、图像处理、OCR、IndexedDB、导出、云同步
- src/lib/server: Supabase、访问验证、AI 与计费
- src/lib/types.ts / validation.ts: 共用类型和输入约束
- supabase/migrations: 业务表、私有桶、事务保存及 API 额度函数
- scripts/prepare-assets.mjs: 安装时复制同域浏览器运行文件
- tests: 核心规则、服务端请求边界和数据库约束测试
- docs/SETUP.md: 本地运行及 Supabase / Vercel / OpenAI 步骤

## 数据库

projects(id, name, token_hash, version, snapshot, created_at, updated_at)；source_files(id, project_id, asset_id, name, type)；pages(id, project_id, source_id, source_page, position, original_asset_id, processed_asset_id, payload)；ocr_results(id, page_id, project_id, engine, payload, created_at)；revisions(id, page_id, project_id, before_text, after_text, created_at)；assets(project_id, id, path, type, size)；api_calls(id, project_id, page_id, model, status, input_tokens, cached_tokens, output_tokens, estimated_cost_usd, rates, error, created_at)。

projects.snapshot 用于恢复完整客户端状态；标准化子表用于查询与审计。保存 RPC 在一个事务中更新快照和各表；按 version 乐观锁防止跨设备覆盖。原始文件关系不可变，OCR/修订记录只追加。所有业务表 RLS 默认拒绝 anon/authenticated，无公开读取或写入策略；仅服务器 service_role 访问。Storage 桶为私有，文件最大 30 MB；不创建公开策略。

## 开发阶段与验收

1. 基础工程：依赖、类型、校验 → 类型检查、核心规则测试和生产构建。
2. 扫描：拍照、多图/PDF、原图保留、OpenCV 轮廓与透视、四角调整和旋转 → 文件/图像流程检查。
3. 识别编辑：中英文 OCR、置信度/待检查、左右对照、人工修订、页面排序、本地项目 → 浏览器流程。
4. 导出：JPG、扫描文字层 PDF、重新排版 PDF / DOCX → 输出与文字层检查。
5. 云与 AI：事务保存、签名上传、凭证访问、单页分析、额度和费用日志 → 请求校验与错误路径测试。
6. 交付：测试、生产构建、桌面/窄屏检查、GitHub 推送、部署说明。

## AI 可信度与费用

文档内容视为不可信数据，不能作为模型指令。使用严格结构化输出，要求难辨内容写为 [需要人工检查]，禁止补字、猜测、推断表格缺值。模型仍可能出错，所有 AI 结果必须人工检查。AI 结果单独保存，用户主动采用才替换编辑区并生成修订。OCR 低置信度词和空白识别均提示检查。

每次调用前持久化 reserved 日志并按全站 UTC 当日额度原子占位；requestId 去重，SDK 禁用自动重试。调用后保存真实 token usage 和配置单价快照；费用为估算。失败、超时和用量未知分别记录，未知费用为 null，不能显示为 0。若调用后写日志失败，原 reservation 保留且标记为需要核对，禁止自动重试。只在 Supabase 和完整价格配置就绪时启用 AI。

## 首期边界

首期使用文件输入 capture 调用 iPhone 相机，需要 HTTPS（localhost 除外）；HEIC 取决于浏览器解码，失败引导改为 JPEG。每批顺序处理以控制手机内存，默认每项目 100 页、每文件 30 MB、PDF 最多 100 页；浏览器工作图最长边 2200px，上传的原文件仍完整保留。OCR 语言包首次下载后缓存；不是承诺离线安装。对大文件、复杂多栏、手写、数学公式的识别与原版式复原不作准确性承诺。DOCX 提供编辑和简单段落/标题/表格排版，不保证像素级还原。

无账号公共部署会有资源滥用风险；首期建议个人使用的受保护部署，AI 全站额度是成本上限的一层保护，不能替代生产级身份和防滥用系统。原始文件占用会累积，保留原则不代表免费存储无限。
