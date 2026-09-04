/* 生成 assets/js/china-map.js —— 省级行政区 SVG 路径（Albers 等积圆锥投影）
 * 数据源：阿里 DataV.GeoAtlas 100000_full.json（国家标准审图数据，含九段线 100000_JD）
 * 用法：node tools/gen-china-map.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'china_full.json'), 'utf8'));

const D2R = Math.PI / 180;
// Albers 等积圆锥投影（中国常用标准纬线 25°N / 47°N，中央经线 105°E）
const phi1 = 25 * D2R, phi2 = 47 * D2R, phi0 = 36 * D2R, lam0 = 105 * D2R;
const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
function project(lon, lat) {
  const lam = lon * D2R, phi = lat * D2R;
  const theta = n * (lam - lam0);
  const rho = Math.sqrt(C - 2 * n * Math.sin(phi)) / n;
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n;
  return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
}

// 环的质心（多边形质心公式），用于省名标注点
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    a += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) { // 退化：退回顶点平均
    let sx = 0, sy = 0; ring.forEach(p => { sx += p[0]; sy += p[1]; });
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (6 * a), cy / (6 * a)];
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
}

// 读取 feature 的全部多边形（Polygon / MultiPolygon），投影后返回 { polys: [ [outerRing, hole...] ] , biggest: ringIdx }
function featurePolys(f) {
  const g = f.geometry; if (!g) return { polys: [] };
  const coords = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
  const polys = coords.map(poly => poly.map(ring => ring.map(pt => project(pt[0], pt[1]))));
  return { polys };
}
function ringToPath(ring, sx, sy, ox, oy) {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const x = (ring[i][0] * sx + ox).toFixed(1), y = (ring[i][1] * sy + oy).toFixed(1);
    d += (i ? 'L' : 'M') + x + ' ' + y;
  }
  return d + 'Z';
}

const provinces = {};
let mainMinX = 1e9, mainMinY = 1e9, mainMaxX = -1e9, mainMaxY = -1e9;

for (const f of geo.features) {
  const name = f.properties.name;
  if (!name) continue;
  const { polys } = featurePolys(f);
  if (!polys.length) continue;
  // 记录主图 bbox（排除九段线）
  if (f.properties.adcode !== '100000_JD') {
    polys.forEach(poly => poly[0].forEach(([x, y]) => {
      if (x < mainMinX) mainMinX = x; if (x > mainMaxX) mainMaxX = x;
      if (y < mainMinY) mainMinY = y; if (y > mainMaxY) mainMaxY = y;
    }));
  }
  // 最大环质心 = 标注点
  let bigIdx = 0, bigA = -1;
  polys.forEach((poly, i) => { const a = ringArea(poly[0]); if (a > bigA) { bigA = a; bigIdx = i; } });
  const [ccx, ccy] = ringCentroid(polys[bigIdx][0]);
  provinces[name] = { polys, cx: ccx, cy: ccy, adcode: f.properties.adcode };
}

// 主图缩放：viewBox 0 0 1000 760，留 10px 边距
const W = 1000, H = 760, PAD = 12;
const sx = (W - 2 * PAD) / (mainMaxX - mainMinX);
const sy = (H - 2 * PAD) / (mainMaxY - mainMinY);
const scale = Math.min(sx, sy);
const ox = PAD + (W - 2 * PAD - (mainMaxX - mainMinX) * scale) / 2 - mainMinX * scale;
const oy = PAD + (H - 2 * PAD - (mainMaxY - mainMinY) * scale) / 2 - mainMinY * scale;

// 九段线附图：投影后独立归一化到右下角 inset (x:850-975, y:560-745)
const jd = provinces[''] // placeholder (deleted below)
delete provinces[''];
const jdFeature = geo.features.find(f => f.properties.adcode === '100000_JD');
let jdPath = '', jdLabel = null;
if (jdFeature) {
  const { polys } = featurePolys(jdFeature);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  polys.forEach(poly => poly[0].forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }));
  const iw = 108, ih = 190, ix = 872, iy = 545; // inset 区域
  const jsx = iw / (maxX - minX), jsy = ih / (maxY - minY);
  const jscale = Math.min(jsx, jsy);
  const jox = ix + (iw - (maxX - minX) * jscale) / 2 - minX * jscale;
  const joy = iy + (ih - (maxY - minY) * jscale) / 2 - minY * jscale;
  jdPath = polys.map(poly => poly.map(ring => ringToPath(ring, jscale, jscale, jox, joy)).join('')).join('');
  jdLabel = { x: ix + iw / 2, y: iy + ih + 14 };
}

const out = {};
for (const [name, p] of Object.entries(provinces)) {
  const d = p.polys.map(poly => poly.map(ring => ringToPath(ring, scale, scale, ox, oy)).join('')).join('');
  out[name] = { d, cx: +(p.cx * scale + ox).toFixed(1), cy: +(p.cy * scale + oy).toFixed(1) };
}

const js = `/* 中国省级行政区 SVG 路径 —— 由 tools/gen-china-map.js 自动生成，勿手改
 * 数据源：阿里 DataV.GeoAtlas 100000_full.json（国家审图标准，含台湾/香港/澳门/南海九段线附图）
 * 投影：Albers 等积圆锥（标准纬线 25°N/47°N，中央经线 105°E），viewBox 0 0 ${W} ${H}
 */
window.CHINA_MAP = {
  W: ${W}, H: ${H},
  provinces: ${JSON.stringify(out)},
  nineDash: ${JSON.stringify(jdPath)},
  nineDashLabel: ${JSON.stringify(jdLabel)}
};
`;
fs.writeFileSync(path.join(ROOT, 'assets', 'js', 'china-map.js'), js);
console.log('生成完成：', Object.keys(out).length, '个省级区域');
console.log('含九段线附图:', !!jdPath);
console.log('文件大小:', (js.length / 1024).toFixed(0), 'KB');
