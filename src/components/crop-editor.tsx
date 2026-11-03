'use client';
import { useEffect, useRef, useState } from 'react';
import type { Quad } from '@/lib/types';
import { fullQuad } from '@/lib/types';
import { getAsset } from '@/lib/client/storage';
import { quadSchema } from '@/lib/validation';
export function AssetImage({ id, alt, className = '' }: { id: string; alt: string; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true, url = '';
    setSrc('');
    getAsset(id).then(a => { if (alive) { url = URL.createObjectURL(a.blob); setSrc(url); } }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  // Blob URLs are generated locally; next/image provides no benefit here.
  return src ? <img src={src} alt={alt} className={className} /> : <div className="image-loading">正在载入图片…</div>;
}
export default function CropEditor({ assetId, initial, busy, onApply, onClose }: { assetId: string; initial: Quad; busy: boolean; onApply: (q: Quad) => void; onClose: () => void }) {
  const [quad, setQuad] = useState<Quad>(initial);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const valid = quadSchema.safeParse(quad).success;
  function move(clientX: number, clientY: number) {
    const rect = svg.current!.getBoundingClientRect();
    const index = dragging.current;
    if (index === null) return;
    setQuad(q => q.map((p, i) => i === index ? { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) } : p) as Quad);
  }
  return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="crop-title" className="modal crop-modal">
    <header><div><span className="eyebrow">PERSPECTIVE CROP</span><h2 id="crop-title">调整扫描范围</h2></div><button onClick={onClose} disabled={busy}>关闭</button></header>
    <p className="muted">拖动四个角，或聚焦角点后使用方向键微调。</p>
    <div className="crop-stage"><AssetImage id={assetId} alt="调整裁切的原始页面" />
      <svg ref={svg} viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerMove={e => move(e.clientX, e.clientY)} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
        <polygon points={quad.map(p => `${p.x * 1000},${p.y * 1000}`).join(' ')} fill="rgba(68,158,129,.12)" stroke="#6de0b2" strokeWidth="4" />
        {quad.map((p, i) => <circle key={i} cx={p.x * 1000} cy={p.y * 1000} r="18" fill="white" stroke="#18594b" strokeWidth="6" tabIndex={0} role="slider" aria-label={`角点 ${i + 1}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.x * 100)} aria-valuetext={`横向 ${Math.round(p.x * 100)}%，纵向 ${Math.round(p.y * 100)}%`} onPointerDown={e => { dragging.current = i; e.currentTarget.setPointerCapture(e.pointerId); }} onKeyDown={e => {
          const delta = e.shiftKey ? 0.02 : 0.002;
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault(); setQuad(q => q.map((point, k) => k === i ? { x: Math.max(0, Math.min(1, point.x + (e.key === 'ArrowRight' ? delta : e.key === 'ArrowLeft' ? -delta : 0))), y: Math.max(0, Math.min(1, point.y + (e.key === 'ArrowDown' ? delta : e.key === 'ArrowUp' ? -delta : 0))) } : point) as Quad);
        }} />)}
      </svg>
    </div>
    {!valid && <p className="warning">范围不能交叉或过小，请按左上、右上、右下、左下排列。</p>}
    <footer><button onClick={() => setQuad(fullQuad())} disabled={busy}>恢复全幅</button><button className="primary" disabled={!valid || busy} onClick={() => onApply(quad)}>应用透视校正</button></footer>
  </section></div>;
}
