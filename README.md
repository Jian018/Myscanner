# 纸间 · AI Smart Scanner

适合 iPhone 和电脑的本地优先扫描工作台。Next.js、TypeScript、Node.js、Tailwind CSS、Vercel、Supabase；无账号、无收费功能。

## 快速开始

安装 Node.js 24 LTS 和 pnpm 11.25.0，然后：

```sh
git clone https://github.com/Jian018/Myscanner.git
cd Myscanner
pnpm install --frozen-lockfile
pnpm dev
```

打开终端打印的本地地址。无需环境变量即可使用拍照、图片/PDF 导入、OpenCV 自动/手动裁切、透视校正、旋转、Tesseract OCR、修订、本机保存和导出。

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

当前 Windows 环境使用 Webpack 构建，避免本机 Turbopack worker 启动问题；仍是标准 Next.js 应用。安装脚本复制 OpenCV、Tesseract、PDF.js 的浏览器资源，`public/vendor` 不提交 Git。OCR 语言包首次使用从 Tesseract 上游 CDN 下载并缓存；识别页面留在浏览器。

## 已实现

- iPhone 相机文件输入、多图片、PDF 逐页导入，原文件和每页图像分开保存。
- OpenCV 四边形检测、四角拖动/键盘微调、透视裁切、90° 旋转；原件不会被覆盖。
- 简中/繁中/英文 OCR、低置信度标记、逐页编辑与修订历史，识别结果保留版本。
- 桌面左右对照、手机上下对照；页面排序不改变原始页码。
- 可搜索扫描 PDF、文字重新排版 PDF、单页 JPG、全部 JPG ZIP、DOCX、原始文件下载。
- 主动保存到 Supabase、私有文件桶、服务器签名上传、项目随机凭证、版本冲突保护。
- 可选 OpenAI 单页确认分析；结构化文字/标题/表格/图片描述、待检查标记；采用后才进入编辑区。
- 调用前持久化额度占位、请求去重、Token/缓存 Token/估算费用、失败和未知状态记录。

## 连接云端

按 [逐步部署教程](docs/SETUP.md) 先建 Supabase，再将 GitHub 仓库导入 Vercel。完整变量模板在 [.env.example](.env.example)。本项目不需要浏览器端 Supabase Key。

## 数据和限制

本机数据保存在当前网站域名的 IndexedDB；清理浏览器数据、隐私模式、系统回收存储可能导致本机数据丢失，请主动导出或保存到云端。本地和 Vercel 域名属于不同存储空间。

无账号的云项目依赖随机访问凭证。凭证等同读写权限，遗失无法找回；在“云端项目”中导出凭证文件并私密保管。不同设备手动载入，不能自动合并；有版本冲突时先导出本机文本再载入云端版本。

每文件 30 MB、每项目 100 页、云端每项目 512 MB；原始文件完整保留，工作图最长边 2200px。HEIC 兼容性取决于浏览器；不支持时请用 JPG。首期不提供删除界面，文件和历史会累积。

OCR 和 AI 均可能出错，置信度不等于正确。AI 的禁止猜测指令不能保证模型永不出错，所有页面仍须人工核对。AI 费用是单价快照计算的估算，实际账单以提供方为准。仅完成代码与本地测试，真实云端保存、iPhone 实机相机和付费 API 仍需部署后验收。

中文 PDF 使用完整静态字体以避免子集字形损坏，因此文件会增加数 MB。扫描 PDF 保留原页面图像，文字层采用当前编辑文字；编辑后的文字采用按行定位，不能保证与原字逐字对齐。重新排版是简单段落，DOCX 支持已采用 AI 结果的标题和表格；首期不保证复杂版式、公式、手写、多栏与图片对象的完整复原。

## 设计与验证

- [架构、数据库和开发阶段](docs/ARCHITECTURE.md)
- [验证记录与待联调项目](docs/VERIFICATION.md)
- SQL：[001_initial.sql](supabase/migrations/001_initial.sql)

开源运行库分别遵守自身许可证。Noto 字体许可证及来源见 `public/fonts/`。项目代码采用 MIT，见 [LICENSE](LICENSE)。
