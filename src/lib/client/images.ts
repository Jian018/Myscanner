import { fullQuad, type Quad } from '../types';
import { quadSchema } from '../validation';
import type CV from '@techstark/opencv-js';
type Cv = typeof CV;
let cvPromise: Promise<Cv> | null = null;
export function loadCv(): Promise<Cv> {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/opencv.js';
    const timer = setTimeout(() => { script.remove(); cvPromise = null; reject(new Error('OpenCV 加载超时，请刷新后重试')); }, 90000);
    script.onerror = () => { clearTimeout(timer); script.remove(); cvPromise = null; reject(new Error('OpenCV 无法加载')); };
    script.onload = async () => {
      try {
        const cv = await (window as unknown as { cv: Cv | Promise<Cv> }).cv;
        if (cv.Mat) { clearTimeout(timer); resolve(cv); }
        else { (cv as Cv & { onRuntimeInitialized: () => void }).onRuntimeInitialized = () => { clearTimeout(timer); resolve(cv); }; }
      } catch { clearTimeout(timer); cvPromise = null; reject(new Error('OpenCV 初始化失败')); }
    };
    document.head.appendChild(script);
  });
  return cvPromise;
}
export async function imageCanvas(blob: Blob, maxSide = 2200): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch { throw new Error('无法解码图片。iPhone HEIC 请先转换为 JPG，或在相机设置中选择“兼容性最佳”。'); }
  finally { URL.revokeObjectURL(url); }
}
export const canvasBlob = (canvas: HTMLCanvasElement, quality = 0.94): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片编码失败')), 'image/jpeg', quality));
export async function detectEdges(blob: Blob): Promise<{ crop: Quad; detected: boolean }> {
  const [cv, canvas] = await Promise.all([loadCv(), imageCanvas(blob, 1000)]);
  const src = cv.imread(canvas), gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat(), contours = new cv.MatVector(), hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    // Otsu also finds low-contrast paper boundaries that Canny can miss.
    cv.threshold(blur, edges, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    let best: Quad | null = null, bestArea = canvas.width * canvas.height * 0.18;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i), approx = new cv.Mat();
      try {
        cv.approxPolyDP(contour, approx, 0.02 * cv.arcLength(contour, true), true);
        const area = cv.contourArea(approx);
        if (approx.rows !== 4 || area <= bestArea || area > canvas.width * canvas.height * 0.98 || !cv.isContourConvex(approx)) continue;
        const pts = Array.from({ length: 4 }, (_, k) => ({ x: approx.data32S[k * 2] / canvas.width, y: approx.data32S[k * 2 + 1] / canvas.height }));
        const cx = pts.reduce((n, p) => n + p.x, 0) / 4, cy = pts.reduce((n, p) => n + p.y, 0) / 4;
        pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
        const start = pts.reduce((idx, p, k) => p.x + p.y < pts[idx].x + pts[idx].y ? k : idx, 0);
        const q = [...pts.slice(start), ...pts.slice(0, start)] as Quad;
        if (quadSchema.safeParse(q).success) { best = q; bestArea = area; }
      } finally { approx.delete(); contour.delete(); }
    }
    return { crop: best ?? fullQuad(), detected: !!best };
  } finally { [src, gray, blur, edges, contours, hierarchy].forEach(m => m.delete()); }
}
export async function processImage(blob: Blob, crop: Quad, rotation: number) {
  quadSchema.parse(crop);
  const [cv, canvas] = await Promise.all([loadCv(), imageCanvas(blob)]);
  const points = crop.map(p => ({ x: p.x * (canvas.width - 1), y: p.y * (canvas.height - 1) }));
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  const width = Math.max(1, Math.round(Math.max(distance(0, 1), distance(3, 2)))), height = Math.max(1, Math.round(Math.max(distance(0, 3), distance(1, 2))));
  const src = cv.imread(canvas), dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, points.flatMap(p => [p.x, p.y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
  const matrix = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(src, dst, matrix, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const warped = document.createElement('canvas'); cv.imshow(warped, dst);
    const output = document.createElement('canvas');
    output.width = rotation % 180 ? height : width; output.height = rotation % 180 ? width : height;
    const ctx = output.getContext('2d')!;
    ctx.translate(output.width / 2, output.height / 2); ctx.rotate(rotation * Math.PI / 180); ctx.drawImage(warped, -width / 2, -height / 2);
    return { blob: await canvasBlob(output), width: output.width, height: output.height };
  } finally { [src, dst, from, to, matrix].forEach(m => m.delete()); }
}
