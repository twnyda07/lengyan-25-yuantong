/* 掌相八觀：由手掌照片的明暗、紋理與輪廓推估（只在本機運算，影像不上傳）
 * BYPalm.analyze(rgbaData, W, H) → {form, head, heart, life, fate, mount, density, finger, raw} 或 null
 *   回 null 時 BYPalm.lastReason 說明原因（nohand／bg／cut／closed），頁面據以請對方重拍。
 * raw 為八觀的原始量測（純數字），隨結果一併記錄，供日後校正。 */
(function(root){
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const N = v => clamp(Math.round(v), 2, 98);

  /* 各觀的中點與倍率：分數＝50＋(原始量−中點)×倍率 */
  const CAL = {
    form:    {c: 0.72,   k: 250},
    head:    {c: 1.1402, k: 82},
    heart:   {c: 1.3232, k: 82},
    life:    {c: 0.8526, k: 78},
    fate:    {c: 0.5486, k: 72},
    mount:   {off: -12},
    density: {c: 0.44,   k: 125},
    finger:  {c: 0.25,   k: 200, rc: 1.45, rk: 30}
  };

  function isSkin(r, g, b, lum){
    return r > 55 && r >= g && g >= b - 12 && (r - b) > 8 && lum > 42 && lum < 245;
  }
  function median(a){ if(!a.length) return 0; const s = a.slice().sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; }

  /* ── 掌形：量手本身的輪廓——手指長（指縫到指尖）÷ 掌寬 ── */
  function handShape(d, W, H){
    const sw = 240, sh = 320, n = sw*sh;
    const rn = new Float32Array(n), gn = new Float32Array(n), lu = new Float32Array(n), sk = new Uint8Array(n);
    for(let y=0; y<sh; y++) for(let x=0; x<sw; x++){
      const p = (Math.floor((y+0.5)/sh*H)*W + Math.floor((x+0.5)/sw*W))*4;
      const r = d[p], g = d[p+1], b = d[p+2], s = r + g + b + 1, i = y*sw + x;
      rn[i] = r/s; gn[i] = g/s; lu[i] = r*0.299 + g*0.587 + b*0.114;
      sk[i] = isSkin(r, g, b, lu[i]) ? 1 : 0;
    }
    /* 掌心（框線中央）取這隻手自己的膚色 */
    const bx0 = Math.floor(sw*0.36), bx1 = Math.floor(sw*0.64), by0 = Math.floor(sh*0.50), by1 = Math.floor(sh*0.74);
    const R = [], G = [], L = [];
    for(let y=by0; y<by1; y++) for(let x=bx0; x<bx1; x++){ const i = y*sw+x; if(sk[i]){ R.push(rn[i]); G.push(gn[i]); L.push(lu[i]); } }
    if(R.length < (bx1-bx0)*(by1-by0)*0.3) return null;
    const mr = median(R), mg = median(G), ml = median(L);
    const madR = median(R.map(v=>Math.abs(v-mr))), madG = median(G.map(v=>Math.abs(v-mg)));
    const tR = Math.max(0.028, madR*5), tG = Math.max(0.022, madG*5);
    const lo = ml*0.38, hi = Math.min(252, ml*1.6 + 25);
    const m0 = new Uint8Array(n);
    for(let i=0; i<n; i++) m0[i] = (Math.abs(rn[i]-mr) <= tR && Math.abs(gn[i]-mg) <= tG && lu[i] >= lo && lu[i] <= hi) ? 1 : 0;
    /* 去雜點、補掌紋造成的小洞 */
    const m = new Uint8Array(n);
    for(let y=1; y<sh-1; y++) for(let x=1; x<sw-1; x++){
      let c = 0; for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++) c += m0[(y+dy)*sw + x+dx];
      m[y*sw+x] = c >= 5 ? 1 : 0;
    }
    /* 由掌心連出去的那一塊才算手 */
    const comp = new Uint8Array(n), st = [];
    for(let y=by0; y<by1; y++) for(let x=bx0; x<bx1; x++){ const i = y*sw+x; if(m[i] && !comp[i]){ comp[i]=1; st.push(i); } }
    while(st.length){
      const i = st.pop(), x = i % sw, y = (i - x)/sw;
      if(x>0 && m[i-1] && !comp[i-1]){ comp[i-1]=1; st.push(i-1); }
      if(x<sw-1 && m[i+1] && !comp[i+1]){ comp[i+1]=1; st.push(i+1); }
      if(y>0 && m[i-sw] && !comp[i-sw]){ comp[i-sw]=1; st.push(i-sw); }
      if(y<sh-1 && m[i+sw] && !comp[i+sw]){ comp[i+sw]=1; st.push(i+sw); }
    }
    /* 逐列：膚色段（縫 ≤2 點視為同一段，短於 3 點不計） */
    const rows = [];
    let edgeRows = 0, anyRows = 0;
    for(let y=0; y<sh; y++){
      const runs = []; let s = -1, gap = 0;
      for(let x=0; x<=sw; x++){
        const on = x < sw && comp[y*sw+x];
        if(on){ if(s < 0) s = x; gap = 0; }
        else if(s >= 0){
          gap++;
          if(gap > 2 || x === sw){ const e = x - gap; if(e - s + 1 >= 3) runs.push([s, e]); s = -1; gap = 0; }
        }
      }
      rows.push(runs);
      if(runs.length){ anyRows++; if(runs[0][0] <= 1 && runs[runs.length-1][1] >= sw-2) edgeRows++; }
    }
    const span = r => rows[r].length ? rows[r][rows[r].length-1][1] - rows[r][0][0] + 1 : 0;
    let top = -1; for(let y=0; y<sh; y++) if(rows[y].length){ top = y; break; }
    if(top < 0) return null;
    /* 手與背景連成一片（膚色區碰到畫面三邊以上，或多數列從左緣連到右緣）：量不到手的輪廓 */
    let eT = 0, eB = 0, eL = 0, eR = 0;
    for(let x=0; x<sw; x++){ if(comp[x] || comp[sw+x]) eT = 1; if(comp[(sh-1)*sw+x] || comp[(sh-2)*sw+x]) eB = 1; }
    for(let y=0; y<sh; y++){ if(comp[y*sw] || comp[y*sw+1]) eL = 1; if(comp[y*sw+sw-1] || comp[y*sw+sw-2]) eR = 1; }
    const bleed = anyRows && edgeRows/anyRows > 0.3;
    if(bleed || eT + eB + eL + eR >= 3) return {ratio: null, q: 0, why: "bg"};
    if(top <= 1) return {ratio: null, q: 0, why: "cut"};      // 指尖出了畫面上緣
    const spans = []; for(let y=top; y<sh; y++) if(rows[y].length) spans.push(span(y));
    const wEst = spans.slice().sort((a,b)=>a-b)[Math.floor(spans.length*0.75)] || 1;

    /* 指縫：由上往下，一列有兩段以上；之後連續一段（掌）夠長即為指根 */
    const need = Math.max(4, Math.round(wEst*0.10));
    let firstMulti = -1, base = -1, single = 0;
    for(let y=top; y<sh; y++){
      const k = rows[y].length;
      if(k >= 2){ if(firstMulti < 0) firstMulti = y; base = y; single = 0; }
      else if(firstMulti >= 0){ if(k === 1) single++; if(single >= need) break; }
    }
    if(base < 0) return {ratio: null, q: 2, why: "closed"};
    const w0 = Math.max(1, span(Math.min(sh-1, base+1)));
    const ws = []; let wcut = false;
    for(let y=base+1; y<=Math.min(sh-1, base + Math.max(2, Math.round(w0*0.35))); y++){
      if(!rows[y].length) continue;
      ws.push(span(y));
      if(rows[y][0][0] <= 1 || rows[y][rows[y].length-1][1] >= sw-2) wcut = true;
    }
    const palmW = median(ws);
    if(palmW < 12) return null;
    /* 指縫只在指尖附近出現＝手指併攏，量不到指根 */
    if((base - top) / palmW < 0.35) return {ratio: null, q: 2, why: "closed"};
    if(wcut) return {ratio: null, q: 0, why: "cut"};          // 手掌碰到畫面左右緣
    return {ratio: (base - top) / palmW, q: 1};   // 1＝量得完整；2＝手指併攏；0＝手出框或與背景相連（後兩者都請對方重拍）
  }

  function analyze(d, W, H){
    const gw = 120, gh = 160;
    const g = new Float32Array(gw*gh), skin = new Uint8Array(gw*gh);
    let skinN = 0;
    for(let y=0; y<gh; y++) for(let x=0; x<gw; x++){
      const p = (Math.floor(y/gh*H)*W + Math.floor(x/gw*W))*4;
      const r = d[p], gg = d[p+1], b = d[p+2];
      const lum = r*0.299 + gg*0.587 + b*0.114;
      g[y*gw+x] = lum;
      if(isSkin(r, gg, b, lum)){ skin[y*gw+x] = 1; skinN++; }
    }
    api.lastReason = "nohand";
    if(skinN < gw*gh*0.10) return null;
    /* 先確認畫面裡真的有一隻完整的手：量不到手的輪廓與指根，據實請對方重拍，不以別的量值代估 */
    const hs = handShape(d, W, H);
    if(!hs) return null;
    if(hs.ratio == null){ api.lastReason = hs.why || "nohand"; return null; }
    api.lastReason = "";

    const gx = new Float32Array(gw*gh), gy = new Float32Array(gw*gh), mag = new Float32Array(gw*gh);
    for(let y=1; y<gh-1; y++) for(let x=1; x<gw-1; x++){
      const i = y*gw+x;
      gx[i] = (g[i-gw+1] + 2*g[i+1] + g[i+gw+1]) - (g[i-gw-1] + 2*g[i-1] + g[i+gw-1]);
      gy[i] = (g[i+gw-1] + 2*g[i+gw] + g[i+gw+1]) - (g[i-gw-1] + 2*g[i-gw] + g[i-gw+1]);
      mag[i] = Math.sqrt(gx[i]*gx[i] + gy[i]*gy[i]);
    }
    /* 以這隻手自身的明暗落差定線條門檻，免受相片對比度／光線影響 */
    const lums = [];
    for(let i=0; i<gw*gh; i++) if(skin[i]) lums.push(g[i]);
    lums.sort((a,b)=> a-b);
    const contrast = Math.max(12, lums[Math.floor(lums.length*0.95)] - lums[Math.floor(lums.length*0.05)]);
    const thr = contrast * 0.42;
    const skinMean = lums[Math.floor(lums.length*0.5)];

    function lineFrac(x0,x1,y0,y1,arr){
      let hit=0, n=0;
      for(let y=Math.floor(y0*gh); y<Math.floor(y1*gh); y++)
        for(let x=Math.floor(x0*gw); x<Math.floor(x1*gw); x++){
          const i=y*gw+x; if(!skin[i]) continue;
          if(Math.abs(arr[i]) > thr) hit++;
          n++;
        }
      return n ? hit/n : 0;
    }
    function meanLum(x0,x1,y0,y1){
      let s=0,n=0;
      for(let y=Math.floor(y0*gh); y<Math.floor(y1*gh); y++)
        for(let x=Math.floor(x0*gw); x<Math.floor(x1*gw); x++){
          const i=y*gw+x; if(!skin[i]) continue; s+=g[i]; n++;
        }
      return n ? s/n : skinMean;
    }

    let minX=gw, maxX=0, minY=gh, maxY=0, topN=0;
    for(let y=0; y<gh; y++) for(let x=0; x<gw; x++){
      if(!skin[y*gw+x]) continue;
      if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
      if(y < gh*0.30) topN++;
    }
    const boxRatio = Math.max(1, maxY-minY) / Math.max(1, maxX-minX);

    const base  = Math.max(0.012, lineFrac(0.12,0.88,0.14,0.92, mag));
    const upper = lineFrac(0.18,0.85,0.26,0.44, mag);   // 感情線帶
    const mid   = lineFrac(0.18,0.85,0.44,0.62, mag);   // 智慧線帶
    const lower = lineFrac(0.14,0.52,0.56,0.88, mag);   // 生命線帶
    const vert  = lineFrac(0.36,0.68,0.42,0.88, gx);    // 縱向線（事業線）
    const mLum  = meanLum(0.14,0.52,0.58,0.88);         // 金星丘亮度
    const mLine = lineFrac(0.14,0.52,0.58,0.88, mag);   // 金星丘紋理

    const topFrac = topN / skinN;
    const raw = {
      form:    hs.ratio,
      formQ:   hs.q,
      head:    mid / base,
      heart:   upper / base,
      life:    lower / base,
      fate:    vert / base,
      mountLum: mLum / Math.max(skinMean, 1),
      mountLine: mLine / base,
      density: base,
      finger:  topFrac,
      box:     boxRatio
    };
    const lin = (k, v) => 50 + (v - CAL[k].c) * CAL[k].k;
    const fingerScore = 50 + (topFrac - CAL.finger.c) * CAL.finger.k + (boxRatio - CAL.finger.rc) * CAL.finger.rk;
    const formScore = lin("form", hs.ratio);
    const out = {
      form:    N(formScore),
      head:    N(lin("head",  raw.head)),
      heart:   N(lin("heart", raw.heart)),
      life:    N(lin("life",  raw.life)),
      fate:    N(lin("fate",  raw.fate)),
      mount:   N(50 + CAL.mount.off + (raw.mountLum - 1)*120 + (1 - raw.mountLine)*30),
      density: N(lin("density", raw.density)),
      finger:  N(fingerScore)
    };
    out.raw = raw;
    return out;
  }

  /* 原始量測化成一行短字串（只有數字），隨寄送紀錄存檔 */
  function rawText(raw){
    if(!raw) return "";
    const f = (v, n) => (v == null || !isFinite(v)) ? "NA" : Number(v).toFixed(n);
    return ["form=" + f(raw.form,3), "formQ=" + raw.formQ, "head=" + f(raw.head,3), "heart=" + f(raw.heart,3),
            "life=" + f(raw.life,3), "fate=" + f(raw.fate,3), "mountLum=" + f(raw.mountLum,3),
            "mountLine=" + f(raw.mountLine,3), "density=" + f(raw.density,4), "finger=" + f(raw.finger,4),
            "box=" + f(raw.box,3)].join(" ");
  }

  /* lastReason：最近一次 analyze 回 null 的原因——nohand 看不到手、bg 手與背景連成一片、cut 手出了畫面、closed 手指併攏 */
  const api = {analyze, rawText, CAL, lastReason: ""};
  root.BYPalm = api;
  if(typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
