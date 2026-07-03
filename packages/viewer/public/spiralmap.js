/**
 * 나선 지도 v3 — 로드맵(레포)마다 하나의 작은 나선, 그 나선들이 더 큰 메타 나선 위에 놓인다.
 *
 * - 작은 나선: 로드맵의 subject들을 시간순(안→밖) 등호장 배치. 각자 제자리(home) 스프링.
 * - 메타 나선: 로드맵들을 학습 시작 순서로 큰 나선 위에 배치(겹치지 않게 간격 보장).
 * - 나선 사이 연결: 서로 다른 로드맵의 subject들이 태그/edge로 이어져 있으면
 *   나선 중심끼리 집계 곡선을 항상 표시(굵기·농도 = 연결 강도). 노드 호버 시엔
 *   그 노드의 개별 연결(다른 나선으로 건너가는 선 포함)만 점등.
 * - 물리·줌/팬·드래그·키보드·rAF 주차·⏸ 회전 토글은 v2와 동일.
 */

// 작은 나선 기하 (로컬 단위)
const M_A = 7, M_B = 11 / (2 * Math.PI), M_TH0 = 1.9;
// 메타 나선 기하
const G_A = 26, G_B = 30 / (2 * Math.PI);
const GAP = 16; // 나선 사이 최소 여백

// 물리 (60fps 프레임 기준 — dt 정규화)
const K_HOME = 0.030;
// 반발은 '드래그로 뭉쳤을 때'만 작동 — 컷오프(d<10)가 정지 간격(≥12)보다 작아
// 정지 상태에선 힘 0 → 노드가 나선 선 위에 정확히 앉는다.
const K_REP = 0.8;
const REP_CUT2 = 100;
const K_LINK = 0.010;
const DAMP = 0.85;
const ROT = 0.0011;     // rad/frame@60fps ≈ 95초/회전 (각 나선이 제자리에서 자전)
const PARK_EPS = 0.015;
const LABEL_BAND = 12;  // 나선 위 라벨이 차지하는 여유 (배치 간격 계산에 포함)

export function mount(canvas, data, opts = {}) {
  const ctx = canvas.getContext("2d");
  const onNavigate = opts.onNavigate ?? (() => {});
  const onAnnounce = opts.onAnnounce ?? (() => {});
  // 노드 클릭 시 이동할 라우트 — 기본은 subject 상세, 전체(레포) 지도에선 레포 지도로 주입
  const nodeRoute = opts.nodeRoute ?? ((id) => `#/s/${encodeURIComponent(id)}`);
  // 나선(그룹) 자체를 클릭해 안으로 들어가는 라우트 — 전체 지도에서만 주입됨
  const groupRoute = opts.groupRoute ?? null;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const P = readPalette();

  // ── 로드맵별 그룹핑 (레포 = 나선) ──
  const groupsMap = new Map();
  for (const n of data.nodes ?? []) {
    const key = n.roadmapId ?? "__misc";
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { key, title: n.roadmapTitle ?? "기타", nodes: [] });
    }
    groupsMap.get(key).nodes.push(n); // 입력이 시간순이라 그룹 내 순서도 시간순
  }
  // 학습 시작(가장 이른 lastTouched) 순서로 메타 나선 안→밖
  const groups = [...groupsMap.values()].sort(
    (a, b) =>
      a.nodes[0].lastTouched.localeCompare(b.nodes[0].lastTouched) ||
      a.key.localeCompare(b.key),
  );
  // 키보드 탐색 순서 = 그룹 순회 (나선 단위로 이어서)
  const nodes = groups.flatMap((g) => g.nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groupOf = new Map();
  for (const g of groups) for (const n of g.nodes) groupOf.set(n.id, g);

  const nbrSet = new Map(nodes.map((n) => [n.id, new Set((n.neighbors ?? []).map((m) => m.id))]));
  const isNbr = (ego, id) => ego === id || nbrSet.get(ego)?.has(id);

  // ── 작은 나선 레이아웃 (그룹 로컬 좌표) ──
  function arcTable(th0, th1, A, B) {
    const t = [{ th: th0, L: 0 }];
    let L = 0, prev = th0;
    for (let th = th0 + 0.01; th <= th1 + 1e-9; th += 0.01) {
      L += 0.5 * (Math.hypot(A + B * prev, B) + Math.hypot(A + B * th, B)) * (th - prev);
      t.push({ th, L });
      prev = th;
    }
    return t;
  }
  const thetaAt = (t, s) => {
    let lo = 0, hi = t.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid].L < s) lo = mid + 1; else hi = mid; }
    const a = t[Math.max(0, lo - 1)], b = t[lo];
    return a.th + (b.th - a.th) * ((s - a.L) / (b.L - a.L || 1));
  };

  for (const g of groups) {
    const k = g.nodes.length;
    const turns = k === 1 ? 0.9 : 0.9 + 0.28 * k;
    const th1 = M_TH0 + 2 * Math.PI * turns;
    g.thMax = th1;
    g.R = M_A + M_B * th1; // 나선 반경 (라벨·간격 계산용)
    if (k === 1) {
      const r = M_A + M_B * M_TH0;
      const ang = M_TH0 - Math.PI / 2;
      g.nodes[0]._lx = r * Math.cos(ang);
      g.nodes[0]._ly = -r * Math.sin(ang);
    } else {
      const t = arcTable(M_TH0, th1, M_A, M_B);
      const Ltot = t[t.length - 1].L;
      g.nodes.forEach((n, i) => {
        const th = thetaAt(t, (i * Ltot) / (k - 1));
        const r = M_A + M_B * th;
        const ang = th - Math.PI / 2;
        n._lx = r * Math.cos(ang);
        n._ly = -r * Math.sin(ang);
      });
    }
  }

  // ── 메타 나선 위에 그룹 중심 배치 ──
  // 간격 = 두 나선 반경 + 라벨 밴드 + 크기 비례 여유: 나선이 커질수록 사이 공간도 커진다.
  {
    const need = (a, b) => (a.R + LABEL_BAND) + (b.R + LABEL_BAND) + GAP + 0.18 * (a.R + b.R);
    let th = 1.6;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (i > 0) {
        let guard = 0;
        while (guard++ < 4000) {
          th += 0.04;
          const r = G_A + G_B * th;
          const ang = th - Math.PI / 2;
          const x = r * Math.cos(ang), y = -r * Math.sin(ang);
          const ok = groups.slice(0, i).every(
            (p) => Math.hypot(p.cx - x, p.cy - y) >= need(p, g),
          );
          if (ok) break;
        }
      }
      const r = G_A + G_B * th;
      const ang = th - Math.PI / 2;
      g.cx = r * Math.cos(ang);
      g.cy = -r * Math.sin(ang);
      g.th = th;
    }
  }
  const metaThMax = groups[groups.length - 1]?.th ?? 8;
  const RMAX = Math.max(...groups.map((g) => Math.hypot(g.cx, g.cy) + g.R), 60);

  // 시뮬 초기화 (reduce면 정확히 home — 정착 모션 없음)
  for (const g of groups) {
    for (const n of g.nodes) {
      n._gcx = g.cx; n._gcy = g.cy;
      n._r = 3.8 + 1.3 * Math.sqrt(Math.max(n.degW, 0));
      n.x = g.cx + n._lx + (reduce ? 0 : (Math.random() - 0.5) * 18);
      n.y = g.cy + n._ly + (reduce ? 0 : (Math.random() - 0.5) * 18);
      n.vx = 0; n.vy = 0; n.fx = 0; n.fy = 0;
    }
  }

  // ── 엣지 (무방향 dedup) + 나선 사이 집계 ──
  const edges = [];
  const inter = new Map(); // "gA|gB" → {a:group, b:group, w}
  {
    const seen = new Set();
    for (const n of nodes) for (const m of n.neighbors ?? []) {
      const key = n.id < m.id ? `${n.id}|${m.id}` : `${m.id}|${n.id}`;
      if (seen.has(key) || !byId.has(m.id)) continue;
      seen.add(key);
      edges.push({ a: n.id, b: m.id, kind: m.kind, score: m.score ?? 1 });
      const ga = groupOf.get(n.id), gb = groupOf.get(m.id);
      if (ga !== gb) {
        const ik = ga.key < gb.key ? `${ga.key}|${gb.key}` : `${gb.key}|${ga.key}`;
        const rec = inter.get(ik) ?? { a: ga, b: gb, w: 0 };
        rec.w += m.score ?? 1;
        inter.set(ik, rec);
      }
    }
  }

  // ── 뷰 (투영 + 줌/팬) ──
  let dpr = 1, W = 0, H = 0, cx = 0, cy = 0, fit = 1;
  let zoom = 1, panX = 0, panY = 0;
  function computeView() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width || 600; H = rect.height || 400;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2;
    fit = (Math.min(W, H) * 0.5 * 0.9) / RMAX;
  }
  const eff = () => fit * zoom;
  const toScreen = (x, y) => [cx + panX + x * eff(), cy + panY + y * eff()];
  const toLocal = (sx, sy) => [(sx - cx - panX) / eff(), (sy - cy - panY) / eff()];

  // ── 상태 ──
  let angle = 0;
  let hot = null;
  let hotGroup = null; // 호버 중인 나선(그룹) — groupRoute 있을 때만 사용
  let pinned = opts.focus && byId.has(opts.focus) ? opts.focus : null;
  let dragNode = null;
  let panning = false;
  let downX = 0, downY = 0, lastX = 0, lastY = 0;

  const MOTION_KEY = "helix.map.motion";
  let motion = !reduce && safeGet(MOTION_KEY) !== "off";

  // 툴팁
  const tip = document.createElement("div");
  tip.className = "spiral-tip";
  tip.hidden = true;
  let tipFor = null, tipW = 0, tipH = 0;
  const hostEl = canvas.parentElement;
  if (hostEl) hostEl.appendChild(tip);

  // 회전 토글
  const motionBtn = document.createElement("button");
  motionBtn.type = "button";
  motionBtn.className = "map-motion";
  function paintMotionBtn() {
    motionBtn.textContent = motion ? "⏸ 회전" : "▶ 회전";
    motionBtn.title = motion ? "회전 멈추기" : "회전 켜기";
    motionBtn.setAttribute("aria-pressed", String(motion));
  }
  paintMotionBtn();
  motionBtn.addEventListener("click", () => {
    motion = !motion;
    try { localStorage.setItem(MOTION_KEY, motion ? "on" : "off"); } catch { /* 프라이빗 모드 등 */ }
    paintMotionBtn();
    wake();
  });
  if (hostEl) hostEl.appendChild(motionBtn);

  const interacting = () => dragNode || panning || hot != null;
  const ego = () => dragNode || hot || pinned;

  // ── 물리 ──
  function tick(dt) {
    // pinned 중엔 회전 정지(포커스 노드가 흐르지 않게). Escape로 해제하면 재개.
    // 회전은 노드 위치에 '강체'로 직접 적용 — 스프링이 home을 쫓아가며 선에서 뒤처지는
    // 현상(회전 중 이탈 ↔ 정지 시 정착의 비일관)을 없앤다. 스프링은 교란 복원만 담당.
    if (motion && !interacting() && pinned == null) {
      const dth = ROT * dt;
      angle += dth;
      const c = Math.cos(dth), s = Math.sin(dth);
      for (const n of nodes) {
        const rx = n.x - n._gcx, ry = n.y - n._gcy;
        n.x = n._gcx + rx * c - ry * s;
        n.y = n._gcy + rx * s + ry * c;
        const vx = n.vx, vy = n.vy;
        n.vx = vx * c - vy * s;
        n.vy = vx * s + vy * c;
      }
    }
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (const n of nodes) {
      // home = 그룹 중심 + (자기 나선 중심 기준으로 회전한 로컬 좌표)
      n._hx = n._gcx + (n._lx * ca - n._ly * sa);
      n._hy = n._gcy + (n._lx * sa + n._ly * ca);
      n.fx = K_HOME * (n._hx - n.x);
      n.fy = K_HOME * (n._hy - n.y);
    }
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const m = nodes[j];
        const dx = n.x - m.x, dy = n.y - m.y;
        const d2 = dx * dx + dy * dy + 0.01;
        if (d2 >= REP_CUT2) continue;
        const f = Math.min(K_REP / d2, 0.6);
        n.fx += f * dx; n.fy += f * dy;
        m.fx -= f * dx; m.fy -= f * dy;
      }
    }
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      // rest = '현재' home 간 거리 — 나선들이 각자 회전하면 나선을 건너는 거리가 변하므로
      // 고정 rest를 쓰면 회전할수록 스프링이 노드를 선 밖으로 끌어낸다. 홈 기준이면 항상 제자리 힘 0.
      const rest = Math.hypot(a._hx - b._hx, a._hy - b._hy);
      const f = K_LINK * (d - rest) / d;
      a.fx += f * dx; a.fy += f * dy;
      b.fx -= f * dx; b.fy -= f * dy;
    }
    const damp = Math.pow(DAMP, dt);
    let maxV = 0;
    for (const n of nodes) {
      if (n.id === dragNode) { n.vx = 0; n.vy = 0; continue; }
      n.vx = (n.vx + n.fx * dt) * damp;
      n.vy = (n.vy + n.fy * dt) * damp;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      const v = n.vx * n.vx + n.vy * n.vy;
      if (v > maxV) maxV = v;
    }
    return Math.sqrt(maxV);
  }

  // ── 그리기 ──
  function spiralPath(cxL, cyL, th0, th1, A, B, rot) {
    // 로컬 나선 폴리라인 (rot = 자기 중심 기준 회전)
    ctx.beginPath();
    let started = false;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    for (let th = th0 - 0.1; th <= th1 + 0.12; th += 0.06) {
      const r = A + B * th, ang = th - Math.PI / 2;
      const lx = r * Math.cos(ang), ly = -r * Math.sin(ang);
      const [sx, sy] = toScreen(cxL + lx * ca - ly * sa, cyL + lx * sa + ly * ca);
      started ? ctx.lineTo(sx, sy) : (ctx.moveTo(sx, sy), started = true);
    }
    ctx.stroke();
  }

  /** 메타 나선 — 각 나선의 원판(disc) 안을 지나는 구간은 끊어서 그린다(겹침 인상 제거) */
  function drawMetaSpine() {
    ctx.strokeStyle = P.ghost;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let pen = false;
    for (let th = 0.9; th <= metaThMax + 0.3; th += 0.05) {
      const r = G_A + G_B * th, ang = th - Math.PI / 2;
      const x = r * Math.cos(ang), y = -r * Math.sin(ang);
      const inside = groups.some((g) => (g.cx - x) ** 2 + (g.cy - y) ** 2 < (g.R + 5) ** 2);
      if (inside) { pen = false; continue; }
      const [sx, sy] = toScreen(x, y);
      if (!pen) { ctx.moveTo(sx, sy); pen = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function chord(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dist = Math.hypot(x1 - x2, y1 - y2);
    const toCx = cx + panX - mx, toCy = cy + panY - my;
    const tl = Math.hypot(toCx, toCy) || 1;
    const pull = Math.min(0.16 * dist, 0.4 * RMAX * eff());
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx + (toCx / tl) * pull, my + (toCy / tl) * pull, x2, y2);
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const n of nodes) { [n._sx, n._sy] = toScreen(n.x, n.y); }
    const e = ego();

    // 1) 메타 나선 (더 큰 나선 — 나선 원판 안은 끊어서)
    drawMetaSpine();

    // 2) 각 로드맵의 작은 나선 척추 (자기 중심 기준 회전, 호버 시 밝게)
    for (const g of groups) {
      ctx.strokeStyle = g.key === hotGroup ? P.soft : P.ghost;
      ctx.lineWidth = 1;
      spiralPath(g.cx, g.cy, M_TH0, g.thMax, M_A, M_B, angle);
    }

    // 3) 나선 사이 집계 연결 — 기본은 숨김, 나선(원판)을 호버한 동안 그 나선의 것만 점등
    if (hotGroup) {
      for (const rec of inter.values()) {
        if (rec.a.key !== hotGroup && rec.b.key !== hotGroup) continue;
        const [x1, y1] = toScreen(rec.a.cx, rec.a.cy);
        const [x2, y2] = toScreen(rec.b.cx, rec.b.cy);
        const dx = x2 - x1, dy = y2 - y1;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const r1 = (rec.a.R + 2) * eff(), r2 = (rec.b.R + 2) * eff();
        ctx.strokeStyle = P.link;
        ctx.globalAlpha = Math.min(0.25 + rec.w * 0.03, 0.5);
        ctx.lineWidth = Math.min(1 + rec.w * 0.16, 2.6);
        chord(x1 + ux * r1, y1 + uy * r1, x2 - ux * r2, y2 - uy * r2);
      }
      ctx.globalAlpha = 1;
    }

    // 4) ego 개별 연결 (호버/드래그/포커스 노드의 이웃만 — 나선을 건너는 선 포함)
    if (e) {
      const self = byId.get(e);
      for (const m of byId.get(e)?.neighbors ?? []) {
        const t = byId.get(m.id);
        if (!self || !t) continue;
        ctx.strokeStyle = P.link;
        ctx.globalAlpha = m.kind === "sibling" ? 0.55 : 0.4;
        ctx.lineWidth = m.kind === "edge" ? 1.8 : 1.2;
        ctx.setLineDash(m.kind === "tag" ? [3, 3] : []);
        chord(self._sx, self._sy, t._sx, t._sy);
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // 5) 노드
    for (const n of nodes) {
      const dim = e && !isNbr(e, n.id);
      const hotN = n.id === hot, foc = n.id === pinned;
      const r = n._r * (hotN || n.id === dragNode ? 1.28 : 1);
      ctx.globalAlpha = dim ? 0.3 : 1;
      if ((hotN || foc) && n.oqCount) {
        ctx.strokeStyle = P.ghost; ctx.lineWidth = 1; ctx.setLineDash([1.5, 2.5]);
        ctx.beginPath(); ctx.arc(n._sx, n._sy, r + 4, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(n._sx, n._sy, r, 0, Math.PI * 2);
      ctx.fillStyle = foc ? P.accent : P.paper; ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = foc ? P.accent : (hotN || (e && isNbr(e, n.id))) ? P.link : P.soft;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 6) 라벨 — 로드맵 이름(항상) + (전체 지도) 열기 → 유도 + 호버/포커스 노드 제목
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const g of groups) {
      const [sx, sy] = toScreen(g.cx, g.cy);
      const topY = sy - g.R * eff() - 10;
      ctx.font = "11.5px Pretendard, system-ui, sans-serif";
      ctx.fillStyle = g.key === hotGroup ? P.text : P.soft;
      ctx.fillText(g.title, sx, topY);
      if (groupRoute) {
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.fillStyle = g.key === hotGroup ? P.link : P.faint;
        ctx.fillText("들어가기 →", sx, topY + 14);
      }
    }
    for (const n of nodes) {
      if (n.id === e || n.id === pinned) {
        ctx.font = "12px Pretendard, system-ui, sans-serif";
        const right = n._sx - cx - panX >= 0;
        ctx.textAlign = right ? "left" : "right";
        ctx.fillStyle = n.id === e ? P.text : P.soft;
        ctx.fillText(displayTitle(n.title), n._sx + (right ? n._r + 6 : -(n._r + 6)), n._sy);
      }
    }
  }

  function hitTest(px, py) {
    let best = null, bd = Infinity;
    for (const n of nodes) {
      const d = (n._sx - px) ** 2 + (n._sy - py) ** 2;
      const rr = (n._r + 6) ** 2;
      if (d < rr && d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  /** 나선 원판(라벨 밴드 포함) 히트 — 노드가 우선이므로 노드 미스 후에만 호출 */
  function groupHit(px, py) {
    for (const g of groups) {
      const [sx, sy] = toScreen(g.cx, g.cy);
      const rr = (g.R + 6) * eff();
      if ((px - sx) ** 2 + (py - sy) ** 2 < rr * rr) return g;
      // 라벨 영역(나선 위쪽 밴드)도 클릭 가능
      if (Math.abs(px - sx) < 70 && py > sy - rr - 24 && py < sy - rr + 6) return g;
    }
    return null;
  }

  // ── 루프 (dt 정규화 + 정착 시 주차) ──
  let raf = 0, alive = true, lastTs = 0;
  function loop(ts) {
    if (!alive) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(Math.max((ts - lastTs) / 16.667, 0.25), 3);
    lastTs = ts;
    const maxV = tick(dt);
    draw();
    if (!motion && !interacting() && maxV < PARK_EPS) { raf = 0; lastTs = 0; return; }
    raf = requestAnimationFrame(loop);
  }
  function wake() {
    if (alive && !raf) { lastTs = 0; raf = requestAnimationFrame(loop); }
  }

  function showTip(n, px, py) {
    if (tipFor !== n.id) {
      const meta =
        n.tipMeta ??
        `${n.lastTouched} · layer ${n.layerCount}${n.oqCount ? ` · 열린 질문 ${n.oqCount}` : ""}`;
      tip.innerHTML =
        `<strong>${escapeHtml(displayTitle(n.title))}</strong>` +
        `<span>${escapeHtml(meta)}</span>` +
        (n.roadmapTitle ? `<span>${escapeHtml(n.roadmapTitle)}</span>` : "") +
        `<span>연결 ${(n.neighbors ?? []).length}</span>`;
      tip.hidden = false;
      tipFor = n.id;
      tipW = tip.offsetWidth; tipH = tip.offsetHeight;
    }
    let x = px + 14, y = py + 14;
    if (x + tipW > W) x = px - tipW - 14;
    if (y + tipH > H) y = py - tipH - 14;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  }
  function hideTip() { tip.hidden = true; tipFor = null; }

  function showGroupTip(g, px, py) {
    const key = `g:${g.key}`;
    if (tipFor !== key) {
      tip.innerHTML =
        `<strong>${escapeHtml(g.title)}</strong>` +
        `<span>항목 ${g.nodes.length}개 · 클릭하면 이 나선으로 들어갑니다</span>`;
      tip.hidden = false;
      tipFor = key;
      tipW = tip.offsetWidth; tipH = tip.offsetHeight;
    }
    let x = px + 14, y = py + 14;
    if (x + tipW > W) x = px - tipW - 14;
    if (y + tipH > H) y = py - tipH - 14;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  }

  // ── 이벤트 ──
  function localFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  }
  function onDown(ev) {
    const [px, py] = localFromEvent(ev);
    downX = lastX = px; downY = lastY = py;
    const id = hitTest(px, py);
    if (id) dragNode = id;
    else panning = true;
    hideTip();
    canvas.setPointerCapture?.(ev.pointerId);
    wake();
  }
  function onMove(ev) {
    const [px, py] = localFromEvent(ev);
    if (dragNode) {
      const [lx, ly] = toLocal(px, py);
      const n = byId.get(dragNode);
      n.x = lx; n.y = ly; n.vx = 0; n.vy = 0;
    } else if (panning) {
      panX += px - lastX; panY += py - lastY;
    } else {
      const id = hitTest(px, py);
      if (id !== hot) hot = id;
      if (id) {
        hotGroup = null;
        showTip(byId.get(id), px, py);
        canvas.style.cursor = "pointer";
      } else if (groupRoute) {
        const g = groupHit(px, py);
        hotGroup = g?.key ?? null;
        if (g) { showGroupTip(g, px, py); canvas.style.cursor = "pointer"; }
        else { hideTip(); canvas.style.cursor = "grab"; }
      } else {
        hideTip();
        canvas.style.cursor = "grab";
      }
    }
    lastX = px; lastY = py;
    wake();
  }
  function onUp(ev) {
    const [px, py] = localFromEvent(ev);
    const d2 = (px - downX) ** 2 + (py - downY) ** 2;
    if (dragNode && d2 < 25) {
      onNavigate(nodeRoute(dragNode), ev.metaKey || ev.ctrlKey);
    } else if (panning && d2 < 25 && groupRoute) {
      // 빈 곳 클릭이지만 나선 원판 안이면 → 그 나선으로 들어가기
      const g = groupHit(px, py);
      if (g) onNavigate(groupRoute(g.key), ev.metaKey || ev.ctrlKey);
    }
    dragNode = null; panning = false;
    hideTip();
    wake();
  }
  function onCancel() {
    dragNode = null; panning = false; hot = null; hotGroup = null;
    hideTip();
    wake();
  }
  function onLeave() { hot = null; hotGroup = null; hideTip(); wake(); }
  function onWheel(ev) {
    // deltaY 비례 지수 스케일 — 트랙패드(작은 델타 다발)는 부드럽게, 휠 한 칸(±100)은 ×1.09 정도로 완만하게
    const nz = Math.min(3, Math.max(0.45, zoom * Math.exp(-ev.deltaY * 0.0009)));
    if (nz === zoom) return; // 줌 한계 — 페이지 스크롤로 통과
    ev.preventDefault();
    const [px, py] = localFromEvent(ev);
    const [lx, ly] = toLocal(px, py);
    zoom = nz;
    panX = px - cx - lx * eff();
    panY = py - cy - ly * eff();
    wake();
  }
  function onKey(ev) {
    if (!nodes.length) return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      ev.preventDefault();
      const cur = pinned ?? hot ?? nodes[0].id;
      let i = nodes.findIndex((n) => n.id === cur);
      i = (i + (ev.key === "ArrowRight" ? 1 : -1) + nodes.length) % nodes.length;
      pinned = nodes[i].id;
      const n = nodes[i];
      const [sx, sy] = toScreen(n.x, n.y);
      if (sx < 30 || sx > W - 30 || sy < 30 || sy > H - 30) {
        panX = -n.x * eff(); panY = -n.y * eff();
      }
      announce(n);
    } else if (ev.key === "Enter" && (pinned ?? hot)) {
      onNavigate(nodeRoute(pinned ?? hot), ev.metaKey || ev.ctrlKey);
    } else if (ev.key === "Escape") {
      pinned = null; // 선택 해제 → 회전 재개
    }
    wake();
  }
  function announce(n) {
    const g = groupOf.get(n.id);
    const meta = n.tipMeta ?? `layer ${n.layerCount}, 열린 질문 ${n.oqCount}개`;
    onAnnounce(
      `현재: ${displayTitle(n.title)}${g ? `, ${g.title} 나선` : ""}, ${meta}, 연결 ${(n.neighbors ?? []).length}개`,
    );
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKey);
  const ro = new ResizeObserver(() => { computeView(); draw(); wake(); });
  ro.observe(canvas);
  const onVis = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; lastTs = 0; }
    else wake();
  };
  document.addEventListener("visibilitychange", onVis);

  canvas.style.cursor = "grab";
  computeView();
  wake();
  if (pinned) announce(byId.get(pinned));

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      tip.remove();
      motionBtn.remove();
    },
  };
}

/* ---------- utils ---------- */

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const g = (name, fb) => css.getPropertyValue(name).trim() || fb;
  return {
    paper: g("--paper", "#16181d"),
    text: g("--text", "#e6e8ec"),
    soft: g("--text-soft", "#9aa0aa"),
    faint: g("--text-faint", "rgba(230,232,236,0.58)"),
    ghost: g("--text-ghost", "rgba(230,232,236,0.34)"),
    accent: g("--accent", "#5e9bff"),
    link: g("--link", "#7fb39a"),
  };
}
function displayTitle(t) { return String(t).replace(/^\d+[.)]\s*/, ""); }
function escapeHtml(raw) {
  return String(raw).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
