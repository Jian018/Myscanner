'use client';
import { useEffect, useRef, useState } from 'react';
import { ScanLine, Plus, Upload, Camera, FileText, CloudUpload, Download, ShieldCheck, ArrowUp, ArrowDown, RotateCw, Crop, ScanText, Sparkles, ChevronRight, FolderOpen, X, ExternalLink, Layers, ArrowRight, BookOpen, Image as ImageIcon } from 'lucide-react';
import CropEditor, { AssetImage } from './crop-editor';
import { newProject, ordered, needsReview, type Project, type ScanPage, type Quad, type OcrResult, type Usage } from '@/lib/types';
import { getAsset, listProjects, putAsset, saveProject } from '@/lib/client/storage';
import { api, createCloud, saveCloud, loadCloud } from '@/lib/client/cloud';
type Config = { cloud: boolean; ai: boolean; model: string | null };
type Modal = 'export' | 'cloud' | 'ai' | 'usage' | null;
function TextEditor({ page, disabled, onSave }: { page: ScanPage; disabled: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(page.text);
  useEffect(() => setDraft(page.text), [page.text]);
  return <><textarea aria-label="识别文本，可直接编辑" className="text-editor" value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== page.text) onSave(draft); }} placeholder={'识别后的文字会出现在这里。\n\n你也可以直接输入，或修订无法确认的内容。'} /><div className="editor-footer"><span>{Array.from(draft).length} 字 · 离开编辑区自动保存修订</span><button disabled={disabled || draft === page.text} onClick={() => onSave(draft)}>保存修订</button></div></>;
}
export default function Scanner() {
  const [project, setProject] = useState<Project | null>(null), current = useRef<Project | null>(null), queue = useRef(Promise.resolve());
  const [projects, setProjects] = useState<Project[]>([]), [activeId, setActiveId] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), lock = useRef(false);
  const [status, setStatus] = useState('正在打开本机工作台…'), [error, setError] = useState('');
  const [config, setConfig] = useState<Config>({ cloud: false, ai: false, model: null });
  const [language, setLanguage] = useState('chi_sim+eng'), [cropOpen, setCropOpen] = useState(false), [original, setOriginal] = useState(false);
  const [tab, setTab] = useState<'text' | 'structure' | 'history'>('text'), [modal, setModal] = useState<Modal>(null);
  const [cloudId, setCloudId] = useState(''), [cloudToken, setCloudToken] = useState('');
  const input = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const page = project?.pages.find(p => p.id === activeId) ?? project?.pages[0], pages = ordered(project?.pages ?? []);
  const targets = pages.filter(p => selected.includes(p.id)), reviewCount = pages.filter(needsReview).length;
  async function commit(next: Project) {
    current.current = next; setProject(next);
    queue.current = queue.current.catch(() => {}).then(async () => {
      await saveProject(next);
      setProjects(items => [next, ...items.filter(p => p.id !== next.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    });
    await queue.current;
  }
  function updatePage(id: string, edit: (p: ScanPage) => ScanPage) {
    const p = current.current!;
    return commit({ ...p, updatedAt: new Date().toISOString(), pages: p.pages.map(x => x.id === id ? edit(x) : x) });
  }
  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setStatus(label);
    try { await queue.current; await action(); setStatus('已保存到本机'); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); setStatus('操作未完成 · 本机原件保留'); }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    let alive = true;
    listProjects().then(async items => {
      if (!alive) return;
      const p = items[0] ?? newProject(); await saveProject(p);
      if (alive) { current.current = p; setProject(p); setProjects(items.length ? items : [p]); setActiveId(p.pages[0]?.id ?? ''); setStatus('已保存到本机'); }
    }).catch(() => { if (alive) setError('本地存储不可用，请退出隐私模式或允许网站储存数据后刷新'); });
    api<Config>('/api/config').then(c => { if (alive) setConfig(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  async function addFiles(files: File[]) {
    if (!files.length) return;
    await run('正在导入文件…', async () => {
      const { importFiles } = await import('@/lib/client/import');
      const { detectEdges, processImage } = await import('@/lib/client/images');
      for (const file of files) {
        const p = current.current!, batch = await importFiles([file], p.pages.length, setStatus);
        await commit({ ...p, pages: [...p.pages, ...batch.pages], sources: [...p.sources, ...batch.sources], updatedAt: new Date().toISOString() });
        setActiveId(batch.pages[0]?.id ?? ''); setSelected(batch.pages.map(x => x.id));
        for (const added of batch.pages) {
          setStatus(`识别纸张边缘 · ${added.sourceName} / ${added.sourcePage}`);
          try {
            const asset = await getAsset(added.originalAssetId), found = await detectEdges(asset.blob);
            if (found.detected) {
              const processed = await processImage(asset.blob, found.crop, 0), id = crypto.randomUUID();
              await putAsset({ id, blob: processed.blob, name: `${added.id}-scan.jpg` });
              await updatePage(added.id, x => ({ ...x, crop: found.crop, processedAssetId: id, width: processed.width, height: processed.height }));
            } else setError('部分页面未找到可靠边缘，已保留全幅，请手动调整范围。');
          } catch { setError('自动边缘识别未完成，页面已保留，可稍后重试自动裁切。'); }
        }
      }
    });
  }
  async function transform(target: ScanPage, crop: Quad, rotation: number) {
    const { processImage } = await import('@/lib/client/images');
    const result = await processImage((await getAsset(target.originalAssetId)).blob, crop, rotation), id = crypto.randomUUID();
    await putAsset({ id, blob: result.blob, name: `${target.id}-scan.jpg` });
    await updatePage(target.id, p => ({ ...p, crop, rotation, width: result.width, height: result.height, processedAssetId: id, archivedResults: [...(p.archivedResults ?? []), ...p.results], results: [], reviewed: false }));
  }
  async function localOcr() {
    await run('启动本地 OCR…', async () => {
      const { recognizePages } = await import('@/lib/client/ocr');
      await recognizePages(targets.length ? targets : page ? [page] : [], language, setStatus, async (id, result) => {
        await updatePage(id, p => ({ ...p, results: [...p.results, result], text: p.text || result.text, reviewed: false }));
      });
    });
  }
  function saveText(target: ScanPage, text: string) {
    if (text === target.text) return;
    updatePage(target.id, p => ({ ...p, text, reviewed: false, revisions: [...p.revisions, { id: crypto.randomUUID(), before: p.text, after: text, createdAt: new Date().toISOString() }] })).catch(e => setError(String(e)));
  }
  async function cloudSave() {
    let p = current.current!;
    if (!p.cloud) { await commit({ ...p, cloud: await createCloud(p) }); p = current.current!; }
    const { version } = await saveCloud(p, setStatus);
    await commit({ ...current.current!, cloud: { ...p.cloud!, version } });
  }
  async function analyze() {
    if (!page) return;
    const pageId = page.id; setModal(null);
    await run('保存所选页面并准备 AI 分析…', async () => {
      await cloudSave(); const p = current.current!; setStatus('AI 正在分析这一页…');
      try {
        const data = await api<{ result: OcrResult; usage: Usage }>(`/api/projects/${p.cloud!.id}/analyze`, { method: 'POST', body: JSON.stringify({ pageId, requestId: crypto.randomUUID(), consent: true }) }, p.cloud!.token);
        await updatePage(pageId, x => ({ ...x, results: [...x.results, data.result], reviewed: false }));
        await commit({ ...current.current!, usage: [data.usage, ...current.current!.usage] });
        setTab('structure'); await cloudSave();
      } catch (e) {
        try { const data = await api<{ usage: Usage[] }>(`/api/projects/${p.cloud!.id}`, {}, p.cloud!.token); await commit({ ...current.current!, usage: data.usage }); } catch { /* Preserve original error. */ }
        throw e;
      }
    });
  }
  function movePage(id: string, delta: number) {
    const list = ordered(current.current!.pages), index = list.findIndex(x => x.id === id), next = index + delta;
    if (next < 0 || next >= list.length) return;
    [list[index], list[next]] = [list[next], list[index]];
    commit({ ...current.current!, pages: list.map((x, i) => ({ ...x, order: i })), updatedAt: new Date().toISOString() }).catch(e => setError(String(e)));
  }
  async function sample() {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1600;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ddd9ce'; ctx.fillRect(0, 0, 1200, 1600); ctx.fillStyle = 'white'; ctx.fillRect(90, 85, 1020, 1430);
    ctx.fillStyle = '#253e34'; ctx.font = 'bold 52px Arial'; ctx.fillText('FIELD NOTES', 165, 240);
    ctx.font = '28px Arial'; ['AI SMART SCANNER / DEMO DOCUMENT', '', 'A quieter way to keep your ideas.', '', '1. Capture the original page.', '2. Review text before you export.', '3. Keep every original safe.', '', 'Meeting: November 03, 2026', 'Project: Paper to possibility', '', 'This is a sample, not your personal data.'].forEach((text, i) => ctx.fillText(text, 165, 340 + i * 68));
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.95));
    await addFiles([new File([blob], '示例文档.jpg', { type: 'image/jpeg' })]);
  }
  const latestAi = page?.results.findLast(r => r.engine === 'openai'), latest = page?.results.at(-1);
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="纸间扫描首页"><span className="brand-icon"><ScanLine size={25} /></span><span>纸间<span className="brand-sub">SMART SCANNER</span></span></a>
      <button className="new-project" disabled={busy || !project} onClick={() => run('新建项目…', async () => { await commit(newProject()); setActiveId(''); setSelected([]); })}><Plus size={18} /> 新建扫描项目</button>
      <div className="sidebar-heading">工作空间 <span>{projects.length.toString().padStart(2, '0')}</span></div>
      <nav aria-label="项目列表" className="project-list">{projects.map(p => <button key={p.id} className={p.id === project?.id ? 'active' : ''} disabled={busy} onClick={() => run('打开项目…', async () => { current.current = p; setProject(p); setActiveId(p.pages[0]?.id ?? ''); setSelected([]); })}><FolderOpen size={17} /><span>{p.name}<small>{p.pages.length} 页 · {new Date(p.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</small></span>{p.id === project?.id && <ChevronRight size={14} />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-note"><ShieldCheck size={20} /><strong>你的文档，由你掌握</strong><p>扫描与 OCR 在浏览器运行。<br />原始文件始终保留。</p></div><button className="cloud-open" onClick={() => setModal('cloud')} disabled={busy}><CloudUpload size={17} /> 云端项目与访问凭证</button><a className="repo-link" href="https://github.com/Jian018/Myscanner" target="_blank" rel="noreferrer">开源项目 <ExternalLink size={13} /></a></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">工作空间 <ChevronRight size={14} /><span>扫描工作台</span></div><div className="topbar-right"><span className="local-badge"><i /> 本地优先</span><button className="icon-button" aria-label="打开云端项目" disabled={busy} onClick={() => setModal('cloud')}><CloudUpload size={18} /></button><button className="icon-button" aria-label="查看 AI 用量" onClick={() => setModal('usage')}><Layers size={18} /></button></div></header>
      <main className="workspace"><section className="workspace-heading"><div><span className="eyebrow">FROM PAPER TO POSSIBILITY</span><h1>{pages.length ? '每一页，都值得留存。' : '把纸上的灵感，带到下一步。'}</h1><p>从扫描到整理，让文字可以被搜索、编辑和再次使用。</p></div><span className="phase-badge">WORKSPACE <span>01</span></span></section>
        <section className="project-bar"><div className="project-title"><span className="folder-square"><FolderOpen size={20} /></span><div><input aria-label="项目名称" maxLength={150} disabled={busy || !project} value={project?.name ?? ''} onChange={e => { if (current.current) commit({ ...current.current, name: e.target.value, updatedAt: new Date().toISOString() }).catch(x => setError(String(x))); }} /><span>{pages.length} 页文档 <b>·</b> {project?.cloud ? `云端版本 ${project.cloud.version}` : '本机项目'} <b>·</b> 原图保留</span></div></div><div className="project-actions"><button disabled={busy || !project || !config.cloud} title={config.cloud ? '主动保存到 Supabase' : '请先配置 Supabase 环境变量'} onClick={() => run('正在保存到云端…', cloudSave)}><CloudUpload size={16} />保存云端</button><button className="primary" disabled={busy || !pages.length} onClick={() => setModal('export')}><Download size={16} />导出文档</button></div></section>
        <input ref={input} hidden aria-label="上传图片或 PDF" type="file" accept="image/*,application/pdf" multiple onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; addFiles(files); }} /><input ref={camera} hidden aria-label="拍摄文档" type="file" accept="image/*" capture="environment" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; addFiles(files); }} />
        {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}><X size={16} /></button></div>}<div className="status-line" role="status" aria-live="polite"><span className={busy ? 'status-dot working' : 'status-dot'} />{status}{busy && <span className="busy-line" />}</div>
        {!pages.length ? <><section className="welcome-grid"><div className="upload-card" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) addFiles(Array.from(e.dataTransfer.files)); }}><span className="corner-mark top-left" /><span className="corner-mark top-right" /><span className="corner-mark bottom-left" /><span className="corner-mark bottom-right" /><div className="upload-symbol"><Upload size={29} strokeWidth={1.5} /></div><h2>你的下一份数字文档，从这里开始</h2><p>拖入文件，或选择一种方式开始扫描</p><div className="upload-actions"><button className="primary" disabled={busy || !project} onClick={() => input.current?.click()}><Plus size={17} />上传图片 / PDF</button><button disabled={busy || !project} onClick={() => camera.current?.click()}><Camera size={18} />拍照扫描</button></div><span className="upload-help">JPG、PNG、WebP、PDF · 每文件最多 30 MB</span><button className="sample-link" disabled={busy || !project} onClick={sample}>先用示例文档体验 <ArrowRight size={14} /></button></div><div className="intro-card"><div className="intro-top"><span className="eyebrow">LESS PAPER. MORE CLARITY.</span><span>↗</span></div><div className="paper-illustration" aria-hidden="true"><span className="paper-tag">SCAN / 001</span><div className="paper-title">Good ideas<br />deserve a<br /><em>second life.</em></div><div className="paper-rule" /><div className="paper-lines"><i /><i /><i /></div><span className="paper-stamp"><ScanLine size={31} /></span></div><p>纸张会泛黄，想法不会。<br /><span>让每一页，都有新的可能。</span></p></div></section><section className="workflow-strip">{[{ icon: Camera, title: '01 / 捕捉', text: '拍照、图片与 PDF' }, { icon: Crop, title: '02 / 校正', text: '自动裁切与透视调整' }, { icon: ScanText, title: '03 / 识别', text: '免费本地 OCR · 人工核对' }, { icon: BookOpen, title: '04 / 带走', text: 'PDF、JPG 与可编辑文档' }].map(item => <div key={item.title}><item.icon size={21} strokeWidth={1.5} /><div><strong>{item.title}</strong><p>{item.text}</p></div></div>)}</section></> : <section className="scanner-layout">
          <aside className="pages-panel"><header><strong>文档页面 <span>{pages.length}</span></strong><button className="icon-button" disabled={busy} aria-label="添加文件" onClick={() => input.current?.click()}><Plus size={18} /></button></header><div className="page-selection"><label><input type="checkbox" disabled={busy} checked={selected.length === pages.length} onChange={e => setSelected(e.target.checked ? pages.map(p => p.id) : [])} />全选</label><span>待核对 {reviewCount}</span></div><div className="page-thumbnails">{pages.map(p => <div key={p.id} className={`page-card ${page?.id === p.id ? 'current' : ''}`}><div className="page-card-top"><label><input type="checkbox" aria-label={`选择第 ${p.order + 1} 页`} disabled={busy} checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />{String(p.order + 1).padStart(2, '0')}</label><span className={needsReview(p) ? 'review-dot' : 'done-dot'} /></div><button className="thumbnail-button" aria-label={`打开第 ${p.order + 1} 页`} disabled={busy} onClick={() => { setActiveId(p.id); setOriginal(false); }}><AssetImage id={p.processedAssetId ?? p.originalAssetId} alt={`第 ${p.order + 1} 页缩略图`} /></button><div className="page-caption"><span title={p.sourceName}>{p.sourceName}</span><small>原页 {p.sourcePage}</small></div><div className="page-reorder"><button aria-label={`第 ${p.order + 1} 页上移`} disabled={busy || p.order === 0} onClick={() => movePage(p.id, -1)}><ArrowUp size={13} /></button><button aria-label={`第 ${p.order + 1} 页下移`} disabled={busy || p.order === pages.length - 1} onClick={() => movePage(p.id, 1)}><ArrowDown size={13} /></button></div></div>)}</div><button className="add-page" disabled={busy} onClick={() => camera.current?.click()}><Camera size={16} />继续拍照</button></aside>
          <div className="document-workspace"><div className="document-toolbar"><div className="recognize-actions"><select aria-label="OCR 语言" value={language} disabled={busy} onChange={e => setLanguage(e.target.value)}><option value="chi_sim+eng">简中 + English</option><option value="chi_tra+eng">繁中 + English</option><option value="eng">English</option></select><button className="primary" disabled={busy} onClick={localOcr}><ScanText size={16} />免费 OCR{targets.length > 1 ? ` (${targets.length} 页)` : ''}</button><button className="ai-button" disabled={busy || !config.ai} title={config.ai ? '只分析当前页，需再次确认' : '连接 Supabase、OpenAI 并配置价格后启用'} onClick={() => setModal('ai')}><Sparkles size={15} />AI 分析当前页</button></div><span className="page-count">{(page?.order ?? 0) + 1} / {pages.length}</span></div>
          {page && <><div className="compare-grid"><section className="image-panel"><header><span><ImageIcon size={16} />{original ? '原始页面' : '扫描预览'}</span><button disabled={busy} onClick={() => setOriginal(x => !x)}>{original ? '查看处理图' : '对照原图'}</button></header><div className="scan-preview"><AssetImage id={original ? (project?.sources.find(s => s.id === page.sourceId && s.type !== 'application/pdf')?.assetId ?? page.originalAssetId) : page.processedAssetId ?? page.originalAssetId} alt="当前扫描页面" /><span className="original-label">{original ? 'ORIGINAL · 原图保留' : 'SCAN PREVIEW'}</span></div><div className="image-tools"><button disabled={busy} onClick={() => setCropOpen(true)}><Crop size={15} />调整范围</button><button disabled={busy} onClick={() => run('正在自动识别边缘…', async () => { const { detectEdges } = await import('@/lib/client/images'); const found = await detectEdges((await getAsset(page.originalAssetId)).blob); if (!found.detected) throw new Error('未找到可靠边缘，请手动调整范围'); await transform(page, found.crop, page.rotation); })}><ScanLine size={15} />自动裁切</button><button disabled={busy} onClick={() => run('正在旋转页面…', () => transform(page, page.crop, (page.rotation + 90) % 360))}><RotateCw size={15} />旋转</button></div></section>
          <section className="result-panel"><header><div className="result-tabs" role="tablist" aria-label="识别结果视图">{(['text', 'structure', 'history'] as const).map((t, i) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{['识别文本', 'AI 结构', '修订记录'][i]}</button>)}</div>{latest?.confidence != null && <span className="confidence">{Math.round(latest.confidence)}%</span>}</header>{needsReview(page) && <div className="review-banner"><span>●</span><div><strong>需要人工检查</strong><p>{latest?.review[0] ?? (latest ? '置信度不代表正确性，请对照原图确认文字。' : '本页尚未识别。请对照原图核对。')}</p></div></div>}
          {tab === 'text' ? <TextEditor key={page.id} page={page} disabled={busy} onSave={text => saveText(page, text)} /> : tab === 'structure' ? <div className="structure-content">{latestAi?.analysis ? <><div className="ai-notice">AI 建议 · 尚未自动替换编辑文字</div>{latestAi.analysis.blocks.map((block, i) => <div className="analysis-block" key={i}><span>{({ heading: '标题', paragraph: '正文', table: '表格', image: '图片' })[block.kind]}</span><p>{block.text}</p>{block.rows.length > 0 && <div className="table-scroll"><table><tbody>{block.rows.map((row, k) => <tr key={k}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}</div>)}{latestAi.review.map((r, i) => <p className="warning" key={i}>{r}</p>)}<button className="primary" disabled={busy} onClick={() => { saveText(page, latestAi.text); setTab('text'); }}>采用 AI 文字并记录修订</button></> : <div className="empty-result"><Sparkles size={30} /><h3>按需使用 AI 视觉分析</h3><p>辅助识别标题、表格与图片。<br />确认后仅发送当前一页。</p><small>{config.ai ? config.model : '尚未连接 OpenAI；免费 OCR 可直接使用。'}</small></div>}</div> : <div className="history-content">{page.revisions.length ? [...page.revisions].reverse().map(r => <article key={r.id}><time>{new Date(r.createdAt).toLocaleString('zh-CN')}</time><details><summary>查看修订前后</summary><h4>修订前</h4><pre>{r.before || '（空）'}</pre><h4>修订后</h4><pre>{r.after || '（空）'}</pre></details></article>) : <div className="empty-result"><FileText size={28} /><p>人工修改会保存在这里。</p></div>}<h4>识别记录</h4>{[...(page.archivedResults ?? []), ...page.results].reverse().map(r => <article key={r.id}><span>{r.engine} · {new Date(r.createdAt).toLocaleTimeString('zh-CN')}</span><p>{r.text.slice(0, 140)}</p><button disabled={busy || r.text === page.text} onClick={() => { saveText(page, r.text); setTab('text'); }}>采用此版本</button></article>)}</div>}
          <div className="review-confirm"><label><input type="checkbox" disabled={busy} checked={page.reviewed} onChange={e => updatePage(page.id, p => ({ ...p, reviewed: e.target.checked })).catch(x => setError(String(x)))} />我已对照原图，人工核对本页</label><ShieldCheck size={16} /></div></section></div><div className="document-footnote"><ShieldCheck size={14} /><span>识别不等于确认。模糊文字需要人工核对，原图始终保留。</span><span>{page.width} × {page.height} px</span></div></>}
          </div></section>}
        <footer className="workspace-footer"><span>纸间 / AI SMART SCANNER</span><span>本地处理 · 自由编辑 · 原件留存</span></footer>
      </main></div>
    {cropOpen && page && <CropEditor assetId={page.originalAssetId} initial={page.crop} busy={busy} onClose={() => setCropOpen(false)} onApply={q => run('正在透视校正…', async () => { await transform(page, q, page.rotation); setCropOpen(false); })} />}
    {modal && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><span className="eyebrow">SMART SCANNER</span><h2 id="modal-title">{{ export: '带走你的文档', cloud: '云端项目', ai: '确认单页 AI 分析', usage: 'AI 调用与估算费用' }[modal]}</h2></div><button className="icon-button" aria-label="关闭窗口" disabled={busy} onClick={() => setModal(null)}><X size={21} /></button></header>
      {modal === 'export' && project && <><p className="muted">按当前顺序导出。{reviewCount ? `${reviewCount} 页尚待人工核对。` : '所有页面已标记核对。'}</p><div className="export-options">{[{ key: 'scan', title: '可搜索 PDF', text: '扫描图像 + 当前文本的隐藏文字层' }, { key: 'reflow', title: '重新排版 PDF', text: '使用已编辑文字，简洁段落排版' }, { key: 'docx', title: '可编辑 Word 文档', text: 'DOCX · 文字、已采用的 AI 标题与表格' }, { key: 'jpg', title: '当前页 JPG', text: '保存当前页面处理图' }, { key: 'all-jpg', title: '全部页面 JPG', text: '按顺序打包为 ZIP，页面各自独立' }, { key: 'original', title: '下载原始文件', text: '当前页来源的未修改原文件（图片或 PDF）' }].map(option => <button key={option.key} disabled={busy} onClick={() => { setModal(null); run('正在导出…', async () => { const exports = await import('@/lib/client/export'); if (option.key === 'original' && page) await exports.exportOriginal(current.current!, page); else if (option.key === 'all-jpg') await exports.exportAllJpg(current.current!, setStatus); else if (option.key === 'jpg' && page) await exports.exportJpg(current.current!, page); else if (option.key === 'docx') await exports.exportDocx(current.current!); else await exports.exportPdf(current.current!, option.key as 'scan' | 'reflow', setStatus); }); }}><FileText size={23} /><span><strong>{option.title}</strong><small>{option.text}</small></span><Download size={17} /></button>)}</div><p className="muted small">AI 结果需先采用。重新排版不保证还原原版式。</p></>}
      {modal === 'ai' && page && <><p>将当前第 <strong>{page.order + 1}</strong> 页（{page.sourceName} · 原页 {page.sourcePage}）的处理图发送到 OpenAI。</p><p className="muted">模型：{config.model}。产生 API 费用，记录 Token 与估算费用。调用前会主动保存项目到 Supabase。</p><div className="warning">不清晰内容要求标记“需要人工检查”。AI 仍可能出错，请对照原图核对。结果不会自动替换编辑文字。</div><footer><button onClick={() => setModal(null)}>取消</button><button className="primary" onClick={analyze}><Sparkles size={16} />确认，仅分析这一页</button></footer></>}
      {modal === 'cloud' && <><p className="muted">{config.cloud ? '在另一台设备输入项目 ID 和访问凭证载入。' : 'Supabase 尚未连接，本地扫描和 OCR 可继续使用。部署步骤见仓库 docs/SETUP.md。'}</p>{project?.cloud && <div className="credential-box"><strong>当前项目凭证 · 请私密保管</strong><label>项目 ID<input readOnly value={project.cloud.id} /></label><label>访问凭证<input type="password" readOnly value={project.cloud.token} /></label><button disabled={busy} onClick={() => run('导出访问凭证…', async () => { const { download } = await import('@/lib/client/export'); download(new Blob([JSON.stringify({ projectId: project.cloud!.id, token: project.cloud!.token }, null, 2)], { type: 'application/json' }), 'scanner-access-private.json'); })}><Download size={14} />保存访问凭证文件</button><small>持有者可读写项目。遗失无法找回。</small></div>}<div className="cloud-form"><h3>载入已有项目</h3><label>项目 ID<input value={cloudId} onChange={e => setCloudId(e.target.value.trim())} autoComplete="off" disabled={busy} /></label><label>访问凭证<input value={cloudToken} type="password" autoComplete="off" onChange={e => setCloudToken(e.target.value.trim())} disabled={busy} /></label><p className="muted small">若本机已有同一云项目，请先导出 DOCX 留底；载入将用云端版本更新本机内容。</p><button className="primary" disabled={busy || !config.cloud || !cloudId || !cloudToken} onClick={() => run('读取云端项目…', async () => { const p = await loadCloud(cloudId, cloudToken, setStatus), existing = projects.find(x => x.cloud?.id === cloudId); await commit(existing ? { ...p, id: existing.id } : p); setActiveId(p.pages[0]?.id ?? ''); setSelected([]); setModal(null); setCloudToken(''); })}>载入项目</button></div></>}
      {modal === 'usage' && <><p className="muted">免费 OCR 不消耗 API Tokens。费用按服务器配置单价估算，账单以 OpenAI 为准。</p><div className="usage-total">${(project?.usage.reduce((n, u) => n + (u.cost ?? 0), 0) ?? 0).toFixed(6)} <span>已知估算费用 · USD</span></div><div className="usage-list">{project?.usage.length ? project.usage.map(u => <article key={u.id}><strong>{u.model} <small>{u.status}</small></strong><p>输入 {u.inputTokens ?? '未知'} · 缓存 {u.cachedTokens ?? '未知'} · 输出 {u.outputTokens ?? '未知'}</p><span>{u.cost === null ? '费用未知，需核对' : `$${u.cost.toFixed(6)}`} · {new Date(u.createdAt).toLocaleString('zh-CN')}</span><code>{u.id}</code></article>) : <div className="empty-result"><Layers size={28} /><p>尚无 AI 调用。</p></div>}</div><p className="muted small">reserved / unknown 记录可能已产生费用，请核对后再重试。额度按全站 UTC 日期计算。</p></>}
    </section></div>}
  </div>;
}
