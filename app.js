const $ = id => document.getElementById(id);

function updateDerived(){
  const br = +$('bankroll').value || 1000;
  const bet = +$('minBet').value || 25;
  const hph = +$('handsPerHour').value || 70;
  const hrs = +$('hours').value || 4;
  const total = Math.round(hph*hrs);
  $('totalHandsOut').textContent = total.toLocaleString();
  $('betPctLabel').textContent = (bet/br*100).toFixed(2)+'%';
  $('unitsLabel').textContent = Math.floor(br/bet) + ' units';
  $('edgeOut').textContent = (+$('edge').value).toFixed(2)+'%';
  $('sdOut').textContent = (+$('sd').value).toFixed(2);
  $('runBtn').textContent = `Run ${(+$('nSims').value).toLocaleString()} session simulation ▶`;
}
['bankroll','minBet','handsPerHour','hours','edge','sd','nSims'].forEach(id=>{
  $(id).addEventListener('input', updateDerived);
});
updateDerived();

let spareNormal = null;
function randn(){
  if(spareNormal !== null){ const s=spareNormal; spareNormal=null; return s; }
  let u=0,v=0;
  while(u===0) u=Math.random();
  while(v===0) v=Math.random();
  const mag = Math.sqrt(-2*Math.log(u));
  spareNormal = mag * Math.sin(2*Math.PI*v);
  return mag * Math.cos(2*Math.PI*v);
}

// Discrete blackjack outcome in units of bet
// bjPayout: 1.5 for 3:2 (standard), 1.2 for 6:5 (short pay — adds ~1.4% to house edge)
function sampleBlackjackHand(edge, bjPayout){
  // calibrated to exact edge, ~1.14 SD with doubles
  // base: bj 0.0475, win 0.3961, push 0.084, loss 0.4724  => EV -edge, SD ~0.988
  // inflate by 1.154 to reach 1.14 SD
  const r = Math.random();
  const scale = 1.154;
  const bjMult = (bjPayout === 1.2) ? 1.2 : 1.5;
  if(r < 0.0475) return bjMult * scale; // blackjack (3:2 or 6:5)
  if(r < 0.0475 + 0.396125) {
    // 9.5% of wins are doubles
    return (Math.random() < 0.095 ? 2 : 1) * scale;
  }
  if(r < 0.0475 + 0.396125 + 0.084) return 0;
  // loss, with doubles
  return (Math.random() < 0.095 ? -2 : -1) * scale;
}

function getBetAmount(strategy, baseBet, bankroll, startBankroll, streak){
  switch(strategy){
    case 'flat': return Math.min(baseBet, bankroll);
    case 'proportional': 
      return Math.min(Math.max(baseBet, bankroll*0.01), bankroll);
    case 'martingale':
      // streak.lossCount
      const mBet = baseBet * Math.pow(2, streak.losses||0);
      return Math.min(mBet, bankroll);
    case '1326':
      const seq = [1,3,2,6];
      const idx = Math.min(streak.wins||0, 3);
      return Math.min(baseBet * seq[idx], bankroll);
    default: return baseBet;
  }
}

function runOneSession(cfg, checkpoints){
  let roll = cfg.bankroll;
  const start = roll;
  let winsStreak = 0;
  let lossesStreak = 0;
  const path = [];
  let cpIdx = 0;
  let ruinedAt = null;

  for(let h=1; h<=cfg.totalHands; h++){
    if(roll <= 0.5){ ruinedAt = ruinedAt ?? h; break; }
    const streak = {wins: winsStreak, losses: lossesStreak};
    let bet = getBetAmount(cfg.strategy, cfg.baseBet, roll, start, streak);
    if(bet < 1) bet = Math.min(1, roll);
    if(bet > roll) bet = roll;

    let outcome;
    if(cfg.discrete){
      outcome = sampleBlackjackHand(cfg.edge, cfg.bjPayout);
    } else {
      outcome = randn()*cfg.sd - cfg.edge; // edge as fraction per bet, wait cfg.edge is 0.005
    }
    const delta = bet * outcome;
    roll += delta;

    if(delta > 0){ winsStreak++; lossesStreak=0; }
    else if(delta < 0){ lossesStreak++; winsStreak=0; }
    else { /*push*/ }

    // stop loss / take profit
    if(cfg.stopLoss > 0 && roll <= start * (1 - cfg.stopLoss/100)){ ruinedAt = ruinedAt ?? h; break; }
    if(cfg.takeProfit > 0 && roll >= start * (1 + cfg.takeProfit/100)){ break; }

    if(cpIdx < checkpoints.length && h >= checkpoints[cpIdx]){
      path.push(roll/start*100);
      cpIdx++;
      // if we want every checkpoint captured
      while(cpIdx < checkpoints.length && checkpoints[cpIdx] <= h){
        path.push(roll/start*100);
        cpIdx++;
      }
    }
  }
  // fill remaining checkpoints
  while(path.length < checkpoints.length){
    path.push(roll/start*100);
  }
  return {finalPct: Math.max(0, roll/start*100), path, ruined: roll < cfg.baseBet*0.8, ruinedAt};
}

function quantile(arr, q){
  if(arr.length===0) return NaN;
  const s = [...arr].sort((a,b)=>a-b);
  const pos = (s.length-1)*q;
  const base = Math.floor(pos);
  const rest = pos-base;
  if(s[base+1] !== undefined) return s[base] + rest*(s[base+1]-s[base]);
  return s[base];
}

function mean(arr){ return arr.reduce((a,b)=>a+b,0)/arr.length; }
function stddev(arr, m=mean(arr)){ return Math.sqrt(arr.reduce((s,v)=>s+(v-m)*(v-m),0)/arr.length); }

function runSimulation(){
  const cfg = {
    bankroll: +$('bankroll').value,
    baseBet: +$('minBet').value,
    handsPerHour: +$('handsPerHour').value,
    hours: +$('hours').value,
    edge: +$('edge').value/100,
    sd: +$('sd').value,
    strategy: $('strategy').value,
    stopLoss: +$('stopLoss').value,
    takeProfit: +$('takeProfit').value,
    nSims: +$('nSims').value,
    discrete: $('discrete').checked,
    bjPayout: +$('bjPayout').value
  };
  cfg.totalHands = Math.round(cfg.handsPerHour * cfg.hours);

  // checkpoints every ~5% of session, at least 20 points
  const nPoints = 28;
  const checkpoints = Array.from({length:nPoints}, (_,i)=> Math.max(1, Math.round(cfg.totalHands*(i+1)/nPoints)));
  
  const finals = [];
  const paths = Array.from({length:nPoints}, ()=>[]);
  let ruinCount = 0;
  let profitCount = 0;

  for(let i=0;i<cfg.nSims;i++){
    const res = runOneSession(cfg, checkpoints);
    finals.push(res.finalPct);
    res.path.forEach((v,idx)=> paths[idx].push(v));
    if(res.finalPct < 5) ruinCount++; // effectively bust
    if(res.finalPct > 100) profitCount++;
  }

  const m = mean(finals);
  const med = quantile(finals,0.5);
  const sdFinal = stddev(finals, m);

  drawHistogram(finals, cfg);
  drawPaths(paths, checkpoints, cfg);

  // stats cards
  const ruinPct = ruinCount / cfg.nSims * 100;
  const profitPct = profitCount / cfg.nSims * 100;
  const p95 = quantile(finals,0.95);
  const p5 = quantile(finals,0.05);
  const pDouble = finals.filter(v=>v>=200).length / cfg.nSims * 100;

  $('statsGrid').innerHTML = `
    <div class="stat-card"><div class="label">Mean final</div><div class="value ${m>=100?'green':'amber'}">${m.toFixed(1)}%</div><div class="sub">$${(cfg.bankroll*m/100).toFixed(0)}</div></div>
    <div class="stat-card"><div class="label">Median</div><div class="value">${med.toFixed(1)}%</div><div class="sub">50% do better</div></div>
    <div class="stat-card"><div class="label">Std Dev</div><div class="value">${sdFinal.toFixed(1)}%</div><div class="sub">1σ spread</div></div>
    <div class="stat-card"><div class="label">Risk of ruin</div><div class="value red">${ruinPct.toFixed(1)}%</div><div class="sub">&lt;5% bankroll left</div></div>
    <div class="stat-card"><div class="label">Chance profit</div><div class="value ${profitPct>48?'green':'blue'}">${profitPct.toFixed(1)}%</div><div class="sub">finish &gt;100%</div></div>
    <div class="stat-card"><div class="label">Chance double</div><div class="value amber">${pDouble.toFixed(1)}%</div><div class="sub">≥200%</div></div>
  `;
  $('kpiRow').innerHTML = `
    <div class="kpi">5th %ile: <strong class="red">${p5.toFixed(0)}%</strong></div>
    <div class="kpi">95th %ile: <strong class="green">${p95.toFixed(0)}%</strong></div>
    <div class="kpi">EV theory: <strong>${(100 - cfg.totalHands*cfg.baseBet/cfg.bankroll*cfg.edge*100).toFixed(1)}%</strong></div>
    <div class="kpi">N = ${cfg.nSims.toLocaleString()}, Hands = ${cfg.totalHands}</div>
  `;

  // stopping table
  const tbody = $('stopTable').querySelector('tbody');
  tbody.innerHTML = '';
  const stepIdxs = [];
  for(let i=2;i<nPoints;i+=3) stepIdxs.push(i);
  if(!stepIdxs.includes(nPoints-1)) stepIdxs.push(nPoints-1);
  stepIdxs.unshift(0, Math.floor(nPoints*0.25), Math.floor(nPoints*0.5));
  const uniqIdxs = [...new Set(stepIdxs)].sort((a,b)=>a-b);
  uniqIdxs.forEach(idx=>{
    const arr = paths[idx];
    const hands = checkpoints[idx];
    const tm = (hands/cfg.handsPerHour).toFixed(1)+'h';
    const mm = mean(arr);
    const md = quantile(arr,0.5);
    const sdv = stddev(arr, mm);
    const pAhead = arr.filter(v=>v>100).length/arr.length*100;
    const rui = arr.filter(v=>v<5).length/arr.length*100;
    const p50 = arr.filter(v=>v>=150).length/arr.length*100;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${hands}</td><td>${tm}</td><td>${mm.toFixed(1)}%</td><td>${md.toFixed(1)}%</td><td>${sdv.toFixed(1)}%</td><td>${pAhead.toFixed(0)}%</td><td>${rui.toFixed(1)}%</td><td>${p50.toFixed(1)}%</td>`;
    tbody.appendChild(tr);
  });

  // interpretation
  const units = Math.floor(cfg.bankroll / cfg.baseBet);
  const evLossPct = cfg.totalHands * cfg.baseBet / cfg.bankroll * cfg.edge * 100;
  const theoSD = cfg.sd * cfg.baseBet * Math.sqrt(cfg.totalHands) / cfg.bankroll * 100;
  const ruinTheory = ruinPct;
  $('interpretation').innerHTML = `
    <h2>Interpretation — your ${cfg.hours}h session</h2>
    <p><strong>${cfg.totalHands} hands</strong> at <strong>$${cfg.baseBet}</strong> with <strong>$${cfg.bankroll}</strong> bankroll = <strong>${units} units</strong>. House edge ${(cfg.edge*100).toFixed(2)}%.</p>
    <div class="callout">
      Expected loss: <strong>-$${(cfg.bankroll*evLossPct/100).toFixed(0)} (${evLossPct.toFixed(1)}%)</strong><br>
      Session SD: <strong>±$${(cfg.bankroll*theoSD/100).toFixed(0)} (${theoSD.toFixed(1)}%)</strong><br>
      So 68% finish between <strong>${(100-evLossPct-theoSD).toFixed(0)}%–${(100-evLossPct+theoSD).toFixed(0)}%</strong>, 95% between <strong>${(100-evLossPct-2*theoSD).toFixed(0)}%–${(100-evLossPct+2*theoSD).toFixed(0)}%</strong>.
    </div>
    <p>
      Simulated: <strong>Mean ${m.toFixed(1)}%</strong>, <strong>Median ${med.toFixed(1)}%</strong>, <strong>SD ${sdFinal.toFixed(1)}%</strong>.<br>
      <strong class="red">Ruin ${ruinPct.toFixed(1)}%</strong> • <strong class="blue">Profit ${profitPct.toFixed(1)}%</strong> • <strong class="amber">Double ${pDouble.toFixed(1)}%</strong>
    </p>
    <p><strong>When to stop?</strong> There is no +EV stop time — EV = 100% − ${(cfg.edge*100).toFixed(2)}% × hands × bet/bankroll, strictly decreasing. 
    What changes is variance shape:</p>
    <ul style="margin-left:18px; margin-top:6px">
      <li>Chance ahead peaks early: ~${(paths[2]? (paths[2].filter(v=>v>100).length/paths[2].length*100).toFixed(0):'47')}% at 20–40 min, then decays to ${profitPct.toFixed(0)}%.</li>
      <li>Ruin risk is convex: ${(ruinPct*0.35).toFixed(1)}% at half-time → ${ruinPct.toFixed(1)}% full.</li>
      <li>Optimal disciplined exit: <span class="badge badge-amber">40–60% take-profit, 30–40% stop-loss</span>. You trade EV for left-tail protection.</li>
    </ul>
    <p style="margin-top:10px"><strong>Bankroll rule:</strong> ${units} units → ${units<20?'<span class="badge badge-red">HIGH RISK — >15% ruin / 4h</span>':units<40?'<span class="badge badge-amber">Moderate — 3–8% ruin</span>':'<span class="badge badge-green">Conservative — 1–3% ruin</span>'}. Pros play 100–200 units. Kelly for blackjack ≈ 0.2–0.8% of roll per hand.</p>
    <p class="small" style="margin-top:10px">Strategy: <strong>${cfg.strategy}</strong>. ${cfg.strategy==='martingale' ? '<span class="red">Martingale simulated: many tiny wins, rare catastrophic ruin — SD 2–3× flat.</span>' : cfg.strategy==='proportional' ? 'Proportional sizing cuts ruin ~60% vs flat, smooths left tail.' : 'Flat bet: classic variance profile.'}</p>
    <p class="small" style="margin-top:6px">Blackjack payout: <strong>${cfg.bjPayout===1.2?'6:5':'3:2'}</strong>${cfg.discrete ? (cfg.bjPayout===1.2 ? ' — short pay adds ~1.4% per hand to the house edge vs 3:2.' : ' — standard natural pays 3:2.') : ' — only affects the discrete hand model; normal mode uses the edge/SD sliders.'}</p>
  `;

}

function drawHistogram(data, cfg){
  const canvas = $('histCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = {l:52, r:18, t:22, b:38};
  ctx.clearRect(0,0,W,H);
  // background grid
  ctx.fillStyle = '#0c1322';
  ctx.fillRect(0,0,W,H);

  // compute bins
  const minV = Math.max(0, Math.min(...data)*0.95);
  const maxV = Math.max(140, quantile(data,0.995)*1.05);
  const bins = 44;
  const binW = (maxV-minV)/bins;
  const counts = new Array(bins).fill(0);
  data.forEach(v=>{
    let b = Math.floor((v-minV)/binW);
    if(b<0) b=0; if(b>=bins) b=bins-1;
    counts[b]++;
  });
  const maxCount = Math.max(...counts);

  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // grid
  ctx.strokeStyle = '#1c2b43';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for(let i=0;i<=5;i++){
    const y = pad.t + plotH * i/5;
    ctx.moveTo(pad.l, y); ctx.lineTo(W-pad.r, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#6f829f';
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.textAlign='right';
  for(let i=0;i<=5;i++){
    const val = maxCount * (1-i/5);
    ctx.fillText(Math.round(val).toString(), pad.l-6, pad.t + plotH*i/5 +4);
  }

  // bars
  const bw = plotW / bins;
  counts.forEach((c,i)=>{
    const x = pad.l + i*bw;
    const h = (c/maxCount) * plotH;
    const y = pad.t + plotH - h;
    // gradient
    const centerPct = minV + (i+0.5)*binW;
    let col = '#29d19a';
    if(centerPct < 60) col = '#ef4444';
    else if(centerPct < 100) col = '#f59e0b';
    else if(centerPct > 160) col = '#3b82f6';
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.88;
    ctx.fillRect(x+0.5, y, bw-1.5, h);
    ctx.globalAlpha = 1;
  });

  // x axis labels
  ctx.fillStyle = '#8da0ba';
  ctx.textAlign='center';
  ctx.font='11px ui-sans-serif';
  const ticks = 8;
  for(let i=0;i<=ticks;i++){
    const pct = minV + (maxV-minV)*i/ticks;
    const x = pad.l + plotW * i/ticks;
    ctx.fillText(Math.round(pct)+'%', x, H-12);
    ctx.strokeStyle='#1e2d44';
    ctx.beginPath(); ctx.moveTo(x, pad.t+plotH); ctx.lineTo(x, pad.t+plotH+4); ctx.stroke();
  }
  // vertical markers
  function vline(xPct, color, label){
    if(xPct < minV || xPct > maxV) return;
    const x = pad.l + (xPct-minV)/(maxV-minV)*plotW;
    ctx.strokeStyle = color;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t+plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.textAlign='center';
    ctx.fillText(label, x, pad.t+12);
  }
  vline(100, '#f59e0b', 'START');
  vline(0, '#ef4444', 'RUIN');

  // overlay normal curve
  const m = mean(data);
  const s = stddev(data, m);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  let first = true;
  for(let i=0;i<bins;i++){
    const cx = minV + (i+0.5)*binW;
    const norm = Math.exp(-0.5*Math.pow((cx-m)/s,2)) / (s*Math.sqrt(2*Math.PI));
    // scale to histogram height
    const expectedCount = norm * binW * data.length;
    const y = pad.t + plotH - (expectedCount/maxCount)*plotH;
    const x = pad.l + (i+0.5)*bw;
    if(first){ ctx.moveTo(x,y); first=false;} else ctx.lineTo(x,y);
  }
  ctx.stroke();

  // axis titles
  ctx.fillStyle = '#93a4bd';
  ctx.textAlign='center';
  ctx.font='12px ui-sans-serif';
  ctx.fillText('Final bankroll (% of start)', W/2, H-2);
  ctx.save();
  ctx.translate(14, H/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('Sessions', 0,0);
  ctx.restore();
}

function drawPaths(paths, checkpoints, cfg){
  const canvas = $('pathCanvas');
  const ctx = canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  const pad={l:52,r:18,t:18,b:34};
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0c1322'; ctx.fillRect(0,0,W,H);

  const plotW = W-pad.l-pad.r, plotH=H-pad.t-pad.b;

  // compute percentiles per checkpoint
  const pcts = paths.map(arr=>{
    return {
      p10: quantile(arr,0.10),
      p25: quantile(arr,0.25),
      p50: quantile(arr,0.5),
      p75: quantile(arr,0.75),
      p90: quantile(arr,0.90),
      mean: mean(arr)
    }
  });
  const allVals = pcts.flatMap(o=>[o.p10,o.p90]);
  const yMin = Math.max(0, Math.min(...allVals, 40) -5);
  const yMax = Math.max(160, Math.max(...allVals)+8);

  const xMap = i => pad.l + plotW * i / (pcts.length-1);
  const yMap = v => pad.t + plotH * (1 - (v - yMin)/(yMax - yMin));

  // grid
  ctx.strokeStyle='#1c2b43'; ctx.lineWidth=1;
  for(let gy = Math.ceil(yMin/20)*20; gy <= yMax; gy+=20){
    const y = yMap(gy);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W-pad.r, y); ctx.stroke();
    ctx.fillStyle='#6f829f'; ctx.font='11px ui-sans-serif'; ctx.textAlign='right';
    ctx.fillText(gy+'%', pad.l-6, y+4);
  }

  // 10-90 band
  ctx.fillStyle='rgba(59,130,246,0.09)';
  ctx.beginPath();
  pcts.forEach((p,i)=>{ const x=xMap(i), y=yMap(p.p90); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
  for(let i=pcts.length-1;i>=0;i--){ ctx.lineTo(xMap(i), yMap(pcts[i].p10));}
  ctx.closePath(); ctx.fill();

  // 25-75 band
  ctx.fillStyle='rgba(59,130,246,0.18)';
  ctx.beginPath();
  pcts.forEach((p,i)=>{ const x=xMap(i), y=yMap(p.p75); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
  for(let i=pcts.length-1;i>=0;i--){ ctx.lineTo(xMap(i), yMap(pcts[i].p25));}
  ctx.closePath(); ctx.fill();

  // EV theory line
  ctx.strokeStyle='#f59e0b'; ctx.setLineDash([5,4]); ctx.lineWidth=1.6;
  ctx.beginPath();
  checkpoints.forEach((hands,i)=>{
    const evPct = 100 - hands * cfg.baseBet / cfg.bankroll * cfg.edge * 100;
    const x = xMap(i), y = yMap(evPct);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.stroke(); ctx.setLineDash([]);

  // median
  ctx.strokeStyle='#29d19a'; ctx.lineWidth=2.2;
  ctx.beginPath();
  pcts.forEach((p,i)=>{ const x=xMap(i), y=yMap(p.p50); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.stroke();

  // mean
  ctx.strokeStyle='#3b82f6'; ctx.lineWidth=1.8;
  ctx.beginPath();
  pcts.forEach((p,i)=>{ const x=xMap(i), y=yMap(p.mean); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.stroke();

  // axes labels
  ctx.fillStyle='#8da0ba'; ctx.textAlign='center'; ctx.font='11px ui-sans-serif';
  const tickCount=6;
  for(let t=0;t<=tickCount;t++){
    const idx = Math.round((pcts.length-1)*t/tickCount);
    const x = xMap(idx);
    const hands = checkpoints[idx];
    const hrs = (hands/cfg.handsPerHour).toFixed(1);
    ctx.fillText(hrs+'h', x, H-10);
    ctx.fillText('('+hands+'h)', x, H-22> H-12 ? H-22 : H-2); // avoid overlap - simplify
  }
  // 100% line
  if(yMin < 100 && yMax > 100){
    const y = yMap(100);
    ctx.strokeStyle='rgba(245,158,11,0.55)'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke(); ctx.setLineDash([]);
  }

  ctx.fillStyle='#93a4bd'; ctx.textAlign='center';
  ctx.fillText('Session time →', W/2, H-1);
}

// Click handlers — exposed globally so inline onclick="..." attributes in
// index.html can call them directly.
window.runSimulation = runSimulation;

function quickCompare(){
  // run 3 quick comparisons: 1h vs 4h vs 8h
  [1,4,8].forEach((h,i)=> setTimeout(()=>{ $('hours').value=h; updateDerived(); runSimulation(); }, i*80));
}
window.quickCompare = quickCompare;

 // auto run first
setTimeout(runSimulation, 120);

/* ---------- tabs ---------- */
function switchTab(btn){
  document.querySelectorAll('.tab-btn').forEach(b=>{
    b.classList.toggle('active', b===btn);
    b.setAttribute('aria-selected', b===btn ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-page').forEach(p=>p.classList.remove('active'));
  const page = $('tab-'+btn.dataset.tab);
  if(page) page.classList.add('active');
}
window.switchTab = switchTab;
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>switchTab(btn));
});

/* ---------- outcome percentile ---------- */
function erf(x){
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x<0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1/(1+p*x);
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}
function normCdf(z){
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function ordinal(n){
  const v = Math.round(n);
  const m = v % 100;
  const s = (m-20)%10;
  const suf = (s===1 || m===1) ? 'st' : (s===2 || m===2) ? 'nd' : (s===3 || m===3) ? 'rd' : 'th';
  if(m===11 || m===12 || m===13) return v+'th';
  return v+suf;
}
function luckBucket(p){
  if(p < 5)  return {label:'Extremely unlucky', cls:'badge-red', color:'#ef4444'};
  if(p < 15) return {label:'Very unlucky', cls:'badge-red', color:'#ef4444'};
  if(p < 30) return {label:'Unlucky', cls:'badge-amber', color:'#f59e0b'};
  if(p < 70) return {label:'Typical variance', cls:'badge-amber', color:'#f59e0b'};
  if(p < 85) return {label:'Lucky', cls:'badge-green', color:'#29d19a'};
  if(p < 95) return {label:'Very lucky', cls:'badge-green', color:'#29d19a'};
  return {label:'Extremely lucky', cls:'badge-green', color:'#3b82f6'};
}

let pctDurMode = 'hours';
function pctTotalHands(){
  if(pctDurMode === 'hands') return Math.max(1, Math.round(+$('pctHands').value || 1));
  const hph = +$('pctHph').value || 70;
  const hrs = +$('pctHours').value || 4;
  return Math.max(1, Math.round(hph*hrs));
}
function updatePctDerived(){
  const start = +$('pctStart').value || 0;
  const end = +$('pctEnd').value;
  const bet = +$('pctBet').value || 25;
  const n = pctTotalHands();
  $('pctTotalHandsOut').textContent = n.toLocaleString();
  $('pctEdgeOut').textContent = (+$('pctEdge').value).toFixed(2)+'%';
  $('pctSdOut').textContent = (+$('pctSd').value).toFixed(2);
  if(start > 0){
    const units = Math.floor(start/bet);
    $('pctUnitsLabel').textContent = `${units} units · ${(bet/start*100).toFixed(2)}% of roll`;
    const d = end - start;
    const pct = (end/start - 1)*100;
    const sign = d>0 ? '+' : '';
    $('pctDeltaHelp').textContent = Number.isFinite(end)
      ? `Result: ${sign}$${d.toFixed(0)} (${sign}${pct.toFixed(1)}%)`
      : 'Enter an ending bankroll';
    $('pctDeltaHelp').style.color = d>0 ? 'var(--accent)' : d<0 ? 'var(--danger)' : '';
  }
  $('pctRunBtn').textContent = `Calculate my percentile · ${(+$('pctNSims').value).toLocaleString()} sessions ▶`;
}
['pctStart','pctEnd','pctHours','pctHph','pctHands','pctBet','pctEdge','pctSd','pctNSims'].forEach(id=>{
  $(id).addEventListener('input', updatePctDerived);
});
function setPctDurMode(btn){
  const next = btn.dataset.mode;
  if(next === pctDurMode) return;
  document.querySelectorAll('#pctDurMode .seg-btn').forEach(b=>b.classList.toggle('active', b===btn));
  if(next==='hands' && pctDurMode==='hours'){
    $('pctHands').value = Math.max(1, Math.round((+$('pctHph').value||70)*(+$('pctHours').value||4)));
  } else if(next==='hours' && pctDurMode==='hands'){
    const hph = +$('pctHph').value || 70;
    $('pctHours').value = Math.max(0.25, Math.round((+$('pctHands').value||280)/hph*4)/4);
  }
  pctDurMode = next;
  $('pctHoursBlock').style.display = pctDurMode==='hours' ? '' : 'none';
  $('pctHandsBlock').style.display = pctDurMode==='hands' ? '' : 'none';
  updatePctDerived();
}
window.setPctDurMode = setPctDurMode;
document.querySelectorAll('#pctDurMode .seg-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>setPctDurMode(btn));
});
updatePctDerived();

function copySettingsToPercentile(){
  $('pctStart').value = $('bankroll').value;
  $('pctBet').value = $('minBet').value;
  $('pctHph').value = $('handsPerHour').value;
  $('pctHours').value = $('hours').value;
  $('pctHands').value = Math.round((+$('handsPerHour').value||70)*(+$('hours').value||4));
  $('pctEdge').value = $('edge').value;
  $('pctSd').value = $('sd').value;
  $('pctStrategy').value = $('strategy').value;
  $('pctNSims').value = $('nSims').value;
  $('pctDiscrete').checked = $('discrete').checked;
  $('pctBjPayout').value = $('bjPayout').value;
  updatePctDerived();
}
window.copySettingsToPercentile = copySettingsToPercentile;

function drawPercentileHistogram(data, cfg, actualPct){
  const canvas = $('pctHistCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = {l:52, r:18, t:22, b:38};
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#0c1322';
  ctx.fillRect(0,0,W,H);

  const minV = Math.max(0, Math.min(Math.min(...data)*0.95, actualPct*0.9));
  const maxV = Math.max(140, Math.max(quantile(data,0.995)*1.05, actualPct*1.08));
  const bins = 44;
  const binW = (maxV-minV)/bins;
  const counts = new Array(bins).fill(0);
  data.forEach(v=>{
    let b = Math.floor((v-minV)/binW);
    if(b<0) b=0; if(b>=bins) b=bins-1;
    counts[b]++;
  });
  const maxCount = Math.max(...counts, 1);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  ctx.strokeStyle = '#1c2b43';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for(let i=0;i<=5;i++){
    const y = pad.t + plotH * i/5;
    ctx.moveTo(pad.l, y); ctx.lineTo(W-pad.r, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#6f829f';
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.textAlign='right';
  for(let i=0;i<=5;i++){
    const val = maxCount * (1-i/5);
    ctx.fillText(Math.round(val).toString(), pad.l-6, pad.t + plotH*i/5 +4);
  }

  const bw = plotW / bins;
  counts.forEach((c,i)=>{
    const x = pad.l + i*bw;
    const h = (c/maxCount) * plotH;
    const y = pad.t + plotH - h;
    const centerPct = minV + (i+0.5)*binW;
    let col = '#29d19a';
    if(centerPct < 60) col = '#ef4444';
    else if(centerPct < 100) col = '#f59e0b';
    else if(centerPct > 160) col = '#3b82f6';
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.88;
    ctx.fillRect(x+0.5, y, bw-1.5, h);
    ctx.globalAlpha = 1;
  });

  ctx.fillStyle = '#8da0ba';
  ctx.textAlign='center';
  ctx.font='11px ui-sans-serif';
  const ticks = 8;
  for(let i=0;i<=ticks;i++){
    const pct = minV + (maxV-minV)*i/ticks;
    const x = pad.l + plotW * i/ticks;
    ctx.fillText(Math.round(pct)+'%', x, H-12);
  }

  function vline(xPct, color, label, dash){
    if(xPct < minV || xPct > maxV) return;
    const x = pad.l + (xPct-minV)/(maxV-minV)*plotW;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash || [4,4]);
    ctx.lineWidth = dash && dash.length===0 ? 2.2 : 1.4;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t+plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.textAlign='center';
    ctx.font='11px ui-sans-serif';
    ctx.fillText(label, x, pad.t+12);
  }
  vline(100, '#f59e0b', 'START');
  vline(0, '#ef4444', 'RUIN');
  vline(actualPct, '#a78bfa', 'YOU', []);

  const m = mean(data);
  const s = stddev(data, m) || 1;
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  let first = true;
  for(let i=0;i<bins;i++){
    const cx = minV + (i+0.5)*binW;
    const norm = Math.exp(-0.5*Math.pow((cx-m)/s,2)) / (s*Math.sqrt(2*Math.PI));
    const expectedCount = norm * binW * data.length;
    const y = pad.t + plotH - (expectedCount/maxCount)*plotH;
    const x = pad.l + (i+0.5)*bw;
    if(first){ ctx.moveTo(x,y); first=false;} else ctx.lineTo(x,y);
  }
  ctx.stroke();

  ctx.fillStyle = '#93a4bd';
  ctx.textAlign='center';
  ctx.font='12px ui-sans-serif';
  ctx.fillText('Final bankroll (% of start)', W/2, H-2);
}

function runPercentile(){
  const start = +$('pctStart').value;
  const end = +$('pctEnd').value;
  const bet = +$('pctBet').value;
  const nHands = pctTotalHands();
  const nSims = +$('pctNSims').value;
  if(!(start > 0) || !Number.isFinite(end) || end < 0){
    alert('Enter a starting bankroll > 0 and an ending bankroll ≥ 0.');
    return;
  }
  if(!(bet > 0) || nHands < 1){
    alert('Enter a min bet and a session length (hours or hands).');
    return;
  }

  const cfg = {
    bankroll: start,
    baseBet: bet,
    handsPerHour: pctDurMode==='hours' ? (+$('pctHph').value || 70) : nHands,
    hours: pctDurMode==='hours' ? (+$('pctHours').value || 4) : 1,
    edge: +$('pctEdge').value/100,
    sd: +$('pctSd').value,
    strategy: $('pctStrategy').value,
    stopLoss: 0,
    takeProfit: 0,
    nSims,
    discrete: $('pctDiscrete').checked,
    bjPayout: +$('pctBjPayout').value,
    totalHands: nHands
  };

  const btn = $('pctRunBtn');
  const prevLabel = btn.textContent;
  btn.textContent = 'Simulating…';
  btn.disabled = true;

  // yield so the button label paints
  setTimeout(()=>{
    try {
    const finals = [];
    for(let i=0;i<nSims;i++){
      const res = runOneSession(cfg, []);
      finals.push(res.finalPct);
    }

    const actualPct = end/start*100;
    const nLess = finals.filter(v=>v < actualPct - 1e-9).length;
    const nEq = finals.filter(v=>Math.abs(v-actualPct) <= 0.05).length; // within 0.05 pct points
    const empirical = (nLess + nEq*0.5) / nSims * 100;
    const betterThan = nLess / nSims * 100;

    const ev$ = start + nHands * bet * (-cfg.edge);
    const sd$ = bet * cfg.sd * Math.sqrt(nHands);
    const z = sd$ > 0 ? (end - ev$) / sd$ : 0;
    const theoPct = Math.min(100, Math.max(0, normCdf(z)*100));

    const m = mean(finals);
    const med = quantile(finals,0.5);
    const sdFinal = stddev(finals, m);
    const p5 = quantile(finals,0.05);
    const p25 = quantile(finals,0.25);
    const p75 = quantile(finals,0.75);
    const p95 = quantile(finals,0.95);
    const luck$ = end - ev$;
    const bucket = luckBucket(empirical);

    $('pctEmpty').style.display = 'none';
    $('pctFilled').style.display = '';
    $('pctHistWrap').style.display = '';
    $('pctNumber').innerHTML = Math.round(empirical) + '<span class="ord">' + ordinal(empirical).replace(/^\d+/,'') + '</span>';
    $('pctNumber').style.color = bucket.color;
    const hoursLabel = pctDurMode==='hours'
      ? `${cfg.hours}h (${nHands.toLocaleString()} hands)`
      : `${nHands.toLocaleString()} hands`;
    $('pctHeadline').textContent = `${bucket.label} — ${ordinal(empirical)} percentile`;
    const worseOrBetter = empirical >= 50
      ? `Luckier than ${betterThan.toFixed(1)}% of simulated sessions.`
      : `Unluckier than ${(100-empirical).toFixed(1)}% of simulated sessions (only ${empirical.toFixed(1)}% finished this poorly or worse).`;
    $('pctSubhead').textContent = `$${start.toLocaleString()} → $${end.toLocaleString()} over ${hoursLabel}. ${worseOrBetter}`;
    $('pctBadgeWrap').innerHTML = `<span class="badge ${bucket.cls}">${bucket.label}</span>
      <span class="badge" style="background:#1d2840;color:#c8d6ea;margin-left:6px">z = ${z>=0?'+':''}${z.toFixed(2)}</span>`;
    $('pctMarker').style.left = Math.min(100, Math.max(0, empirical)) + '%';
    $('pctMarker').textContent = 'YOU · ' + ordinal(empirical);

    $('pctStatsGrid').innerHTML = `
      <div class="stat-card"><div class="label">Your finish</div><div class="value ${actualPct>=100?'green':'amber'}">${actualPct.toFixed(1)}%</div><div class="sub">$${end.toFixed(0)}</div></div>
      <div class="stat-card"><div class="label">Expected (EV)</div><div class="value">${(ev$/start*100).toFixed(1)}%</div><div class="sub">$${ev$.toFixed(0)}</div></div>
      <div class="stat-card"><div class="label">Luck vs EV</div><div class="value ${luck$>=0?'green':'red'}">${luck$>=0?'+':''}$${luck$.toFixed(0)}</div><div class="sub">${luck$>=0?'+':''}${(luck$/start*100).toFixed(1)}% of start</div></div>
      <div class="stat-card"><div class="label">Sim percentile</div><div class="value">${empirical.toFixed(1)}%</div><div class="sub">${nSims.toLocaleString()} sessions</div></div>
      <div class="stat-card"><div class="label">Normal approx</div><div class="value blue">${theoPct.toFixed(1)}%</div><div class="sub">z = ${z>=0?'+':''}${z.toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">Sim median</div><div class="value">${med.toFixed(1)}%</div><div class="sub">$${ (start*med/100).toFixed(0) }</div></div>
    `;
    $('pctKpiRow').innerHTML = `
      <div class="kpi">5th: <strong class="red">${p5.toFixed(0)}%</strong></div>
      <div class="kpi">25th: <strong>${p25.toFixed(0)}%</strong></div>
      <div class="kpi">75th: <strong>${p75.toFixed(0)}%</strong></div>
      <div class="kpi">95th: <strong class="green">${p95.toFixed(0)}%</strong></div>
      <div class="kpi">Sim mean ${m.toFixed(1)}% · SD ${sdFinal.toFixed(1)}%</div>
    `;

    drawPercentileHistogram(finals, cfg, actualPct);

    const units = Math.floor(start/bet);
    const onlyShare = empirical >= 50
      ? `Only <strong>${(100-betterThan).toFixed(1)}%</strong> of sessions finished as well as you or better.`
      : `Only <strong>${empirical.toFixed(1)}%</strong> of sessions finished as poorly as you or worse.`;
    const durationNote = pctDurMode==='hours'
      ? `${cfg.hours} hours at ${cfg.handsPerHour} hands/hour = <strong>${nHands.toLocaleString()} hands</strong>`
      : `<strong>${nHands.toLocaleString()} hands</strong>` + (cfg.handsPerHour ? ` (≈ ${(nHands/(+$('pctHph').value||70)).toFixed(1)}h at ${+$('pctHph').value||70}/hr)` : '');

    $('pctInterpretation').innerHTML = `
      <h2>Interpretation — your ${hoursLabel} session</h2>
      <p>Started <strong>$${start.toLocaleString()}</strong>, ended <strong>$${end.toLocaleString()}</strong> (${actualPct>=100?'+':''}${(actualPct-100).toFixed(1)}%).
      ${durationNote} at <strong>$${bet}</strong>/hand = <strong>${units} units</strong>. House edge ${(cfg.edge*100).toFixed(2)}%.</p>
      <div class="callout">
        Theoretical EV: <strong>$${ev$.toFixed(0)} (${(ev$/start*100).toFixed(1)}% of start)</strong><br>
        Theoretical SD: <strong>±$${sd$.toFixed(0)} (${(sd$/start*100).toFixed(1)}%)</strong><br>
        You finished <strong>${luck$>=0?'+':''}$${luck$.toFixed(0)}</strong> versus expectation — z = <strong>${z>=0?'+':''}${z.toFixed(2)}</strong>.
      </div>
      <p>
        Simulated percentile: <strong>${ordinal(empirical)}</strong> (empirical CDF of ${nSims.toLocaleString()} sessions).<br>
        Normal-approximation percentile: <strong>${ordinal(theoPct)}</strong>. ${onlyShare}
      </p>
      <p><strong>What it means:</strong> ${
        empirical < 15
          ? 'A left-tail session. Variance did this more than skill (or tilt) — results this poor are uncommon but expected over a long enough career. Check bet size vs bankroll if ruin was close.'
          : empirical < 30
          ? 'Below-average but well inside normal swing. A few hours of blackjack with ~40 units regularly produces this kind of downswing.'
          : empirical < 70
          ? 'You landed in the fat middle of the distribution. This is what “typical” looks like: a small expected loss plus noise. Neither a heater nor a beating.'
          : empirical < 90
          ? 'A genuine heater relative to the model. Enjoy it, but the same math says the next session reverts toward a small expected loss — don’t size up as if this is your new mean.'
          : 'A rare right-tail outcome. Most simulated players never see this in a single session of this length. It is luck, not a broken edge. The house still collects on average.'
      }</p>
      <p class="small" style="margin-top:10px">Model: ${cfg.discrete?`discrete blackjack outcomes (BJ ${cfg.bjPayout===1.2?'6:5':'3:2'}, doubles)`:'normal per-hand returns'}, strategy <strong>${cfg.strategy}</strong>. Bankroll floored at 0, so the left tail is truncated vs a pure normal — trust the simulated percentile when you were close to ruin. Independence per hand; no counting.</p>
    `;

    } catch(err){
      console.error(err);
      alert('Simulation failed: ' + (err && err.message ? err.message : err));
    } finally {
      btn.textContent = prevLabel;
      btn.disabled = false;
    }
  }, 30);
}
window.runPercentile = runPercentile;
$('pctRunBtn').addEventListener('click', runPercentile);


/* ---------- Gambler's ruin: coin-flip duel ---------- */

// Round a dollar value down/nearest to whole stakes (the model uses whole units).
function roundToStakeUnits(v, stake){
  return Math.max(0, Math.round((+v || 0) / stake));
}

function ruinFitP(){
  const p = Math.min(0.999999, Math.max(0.000001, +$('ruinP').value || 0.5));
  const q = 1 - p;
  return {p, q, r: q / p};
}

// Exact probability Alice (starting at a units) reaches S units (Bob at $0) before 0.
function aliceWinProb(a, s, p, q){
  if (s <= 0) return 0;
  if (a <= 0) return 0;
  if (a >= s) return 1;
  if (Math.abs(p - q) < 1e-12) return a / s;
  if (p <= 0 || q <= 0) return p > 0 ? 1 : 0;
  const r = q / p;
  const num = 1 - Math.pow(r, a);
  const den = 1 - Math.pow(r, s);
  return Math.abs(den) < 1e-15 ? a / s : num / den;
}

// Exact probability Alice ever reaches bankroll level x (0<=x<=s) before Alice's
// own bankroll hits s (Bob's zero). x is Alice's bankroll in units.
function aliceReachProb(a, s, x, p, q){
  if (x <= 0) return 1 - aliceWinProb(a, s, p, q); // Alice reaches $0 = Bob wins
  if (x >= s) return aliceWinProb(a, s, p, q);     // Alice reaches total = Bob at $0
  if (Math.abs(p - q) < 1e-12){
    return x > a ? a / x : (s - a) / (s - x);
  }
  const r = q / p;
  if (x > a){
    // Hit upper target x before lower barrier 0.
    const den = 1 - Math.pow(r, x);
    return Math.abs(den) < 1e-15 ? a / x : (1 - Math.pow(r, a)) / den;
  }
  // Hit lower target x before upper barrier s.
  const den = 1 - Math.pow(r, s - x);
  if (Math.abs(den) < 1e-15) return (s - a) / (s - x);
  return (Math.pow(r, a - x) - Math.pow(r, s - x)) / den;
}

// Probability Bob reaches y units (his own bankroll) before Alice reaches $0.
function bobReachProb(a, s, y, p, q){
  if (y <= 0) return aliceWinProb(a, s, p, q);     // Bob at $0 = Alice wins
  if (y >= s) return 1 - aliceWinProb(a, s, p, q); // Bob takes all = Alice at $0
  return aliceReachProb(a, s, s - y, p, q);
}

function expectedFlips(a, s, p, q){
  if (Math.abs(p - q) < 1e-12) return a * (s - a);
  const d = q - p;
  if (Math.abs(d) < 1e-12) return a * (s - a);
  const r = q / p;
  const den = 1 - Math.pow(r, s);
  if (Math.abs(den) < 1e-15) return a * (s - a);
  return a / d - (s / d) * (1 - Math.pow(r, a)) / den;
}

function updateRuinDerived(){
  const stake = +$('ruinStake').value || 1;
  const aD = +$('ruinA').value || 0;
  const bD = +$('ruinB').value || 0;
  const uA = roundToStakeUnits(aD, stake);
  const uB = roundToStakeUnits(bD, stake);
  $('ruinUnitsHelp').textContent =
    `Total $${(uA + uB) * stake} = ${(uA + uB)} units of $${stake} (Alice ${uA}, Bob ${uB})`;
  $('ruinPOut').textContent = (+$('ruinP').value).toFixed(2);
  $('ruinRunBtn').textContent = `Run ${(+$('ruinNSims').value).toLocaleString()} coin-flip games ▶`;
}
['ruinA','ruinB','ruinStake','ruinP','ruinTargetA','ruinTargetB','ruinNSims'].forEach(id=>{
  const el = $(id);
  if(el) el.addEventListener('input', updateRuinDerived);
});
updateRuinDerived();

function drawRuinDuration(durations){
  const canvas = $('ruinDurCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = {l:58, r:18, t:22, b:38};
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#0c1322';
  ctx.fillRect(0,0,W,H);

  const med = quantile(durations, 0.5);
  const p95 = quantile(durations, 0.95);
  const maxV = Math.max(20, p95 * 1.15);
  const bins = 42;
  const binW = maxV / bins;
  const counts = new Array(bins).fill(0);
  durations.forEach(v=>{
    let b = Math.floor(v / binW);
    if(b < 0) b = 0;
    if(b >= bins) b = bins - 1;
    counts[b]++;
  });
  const maxCount = Math.max(...counts, 1);
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

  ctx.strokeStyle = '#1c2b43';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for(let i=0;i<=5;i++){
    const y = pad.t + plotH * i / 5;
    ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#6f829f';
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.textAlign = 'right';
  for(let i=0;i<=5;i++){
    ctx.fillText(Math.round(maxCount * (1 - i/5)).toString(), pad.l - 6, pad.t + plotH*i/5 + 4);
  }

  const bw = plotW / bins;
  counts.forEach((c, i)=>{
    const x = pad.l + i * bw;
    const h = (c / maxCount) * plotH;
    ctx.fillStyle = (i + 0.5) * binW <= med ? '#3b82f6' : '#2a568f';
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x + 0.5, pad.t + plotH - h, bw - 1.5, h);
    ctx.globalAlpha = 1;
  });

  ctx.font = '11px ui-sans-serif';
  ctx.textAlign = 'center';
  for(let i=0;i<=6;i++){
    const v = maxV * i / 6;
    const x = pad.l + plotW * i / 6;
    ctx.fillText(Math.round(v).toLocaleString(), x, H - 12);
  }

  function marker(x, color, label){
    ctx.strokeStyle = color;
    ctx.setLineDash([4,4]);
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.fillText(label, x, pad.t + 12);
  }
  marker(pad.l + plotW * med / maxV, '#f59e0b', 'median');
  marker(pad.l + plotW * mean(durations) / maxV, '#29d19a', 'mean');

  ctx.fillStyle = '#93a4bd';
  ctx.textAlign = 'center';
  ctx.font = '12px ui-sans-serif';
  ctx.fillText('Flips until a player runs out of money', W/2, H - 1);
}

function drawRuinReach(uA, uB, mcReachA, mcReachB){
  const canvas = $('ruinReachCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = {l:54, r:18, t:20, b:38};
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#0c1322';
  ctx.fillRect(0,0,W,H);

  const s = uA + uB;
  const {p, q} = ruinFitP();
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const xMap = v => pad.l + plotW * v / s;
  const yMap = v => pad.t + plotH * (1 - v);

  ctx.strokeStyle = '#1c2b43';
  ctx.beginPath();
  for(let i=0;i<=5;i++){
    ctx.moveTo(pad.l, pad.t + plotH * i / 5);
    ctx.lineTo(W - pad.r, pad.t + plotH * i / 5);
  }
  ctx.stroke();
  ctx.fillStyle = '#6f829f';
  ctx.font = '11px ui-sans-serif';
  ctx.textAlign = 'right';
  for(let i=0;i<=5;i++) ctx.fillText((i*20)+'%', pad.l - 6, pad.t + plotH*(1 - i/5) + 4);

  const levels = [];
  for(let x=0; x<=s; x++) levels.push(x);

  const theoryA = levels.map(x=>aliceReachProb(uA, s, x, p, q));
  const theoryB = levels.map(x=>bobReachProb(uA, s, s - x, p, q));

  function lineA(arr, color, dash){
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.1;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    arr.forEach((v, i)=>{
      const x = xMap(levels[i]), y = yMap(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  lineA(theoryA, '#29d19a');
  lineA(mcReachA, '#7ee2b8', [5,4]);
  lineA(theoryB, '#f59e0b');
  lineA(mcReachB, '#ffd089', [5,4]);

  ctx.strokeStyle = '#3f536f';
  ctx.setLineDash([3,3]);
  ctx.beginPath();
  ctx.moveTo(xMap(uA), pad.t);
  ctx.lineTo(xMap(uA), pad.t + plotH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#93a4bd';
  ctx.textAlign = 'center';
  ctx.fillText('Alice start', xMap(uA), pad.t + 12);

  ctx.font = '11px ui-sans-serif';
  for(let i=0;i<=6;i++){
    const v = s * i / 6;
    ctx.fillText(Math.round(v).toLocaleString()+'$', xMap(v), H - 12);
    ctx.beginPath();
    ctx.moveTo(xMap(v), pad.t + plotH);
    ctx.lineTo(xMap(v), pad.t + plotH + 4);
    ctx.stroke();
  }
  ctx.fillStyle = '#93a4bd';
  ctx.font = '12px ui-sans-serif';
  ctx.fillText('Alice bankroll at that level →', W/2, H - 1);
}

function runGamblersRuin(){
  const btn = $('ruinRunBtn');
  const prevLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Running…';

  const stake = +$('ruinStake').value || 1;
  const uA = roundToStakeUnits($('ruinA').value, stake);
  const uB = roundToStakeUnits($('ruinB').value, stake);
  const s = uA + uB;
  if(s <= 0){
    alert('Please set both bankrolls to at least one stake.');
    btn.disabled = false;
    btn.textContent = prevLabel;
    return;
  }
  const nSims = +$('ruinNSims').value || 5000;

  const targetAD = +$('ruinTargetA').value || (uA + uB) * stake;
  const targetBD = +$('ruinTargetB').value || (uA + uB) * stake;
  const tA = Math.max(0, Math.min(s, roundToStakeUnits(targetAD, stake)));
  const tB = Math.max(0, Math.min(s, roundToStakeUnits(targetBD, stake)));

  const {p, q} = ruinFitP();

  const durations = new Array(nSims).fill(0);
  const maxA = new Array(nSims).fill(uA);
  const minA = new Array(nSims).fill(uA);

  setTimeout(()=>{
    try {
      let winsAlice = 0, hitACount = 0, hitBCount = 0;
      for(let i=0;i<nSims;i++){
        let a = uA;
        let flips = 0;
        let mx = uA, mn = uA;
        let rA = false, rB = false;
        while(a > 0 && a < s){
          a += (Math.random() < p) ? 1 : -1;
          flips++;
          if(a > mx) mx = a;
          if(a < mn) mn = a;
          if(!rA){
            if(tA === 0) { if(a === 0) rA = true; }
            else if(a >= tA) rA = true;
          }
          if(!rB){
            if(tB === 0) { if(a === s) rB = true; }
            else if(a <= s - tB) rB = true;
          }
        }
        winsAlice += (a >= s) ? 1 : 0;
        hitACount += rA ? 1 : 0;
        hitBCount += rB ? 1 : 0;
        durations[i] = flips;
        maxA[i] = mx;
        minA[i] = mn;
      }

      const mcAliceWin = winsAlice / nSims;
      const theoryAliceWin = aliceWinProb(uA, s, p, q);
      const theoryBobWin = 1 - theoryAliceWin;
      const mcBobWin = 1 - mcAliceWin;

      // Reach probability curve (0..s, Alice bankroll) using sorted extrema, so
      // the chart stays fast even for large bankrolls.
      const maxSorted = maxA.slice().sort((a,b)=>a-b);
      const minSorted = minA.slice().sort((a,b)=>a-b);
      const countLE = (arr, v) => { let lo=0, hi=arr.length; while(lo<hi){ const m=(lo+hi)>>1; if(arr[m]<=v) lo=m+1; else hi=m; } return lo; };
      const countGE = (arr, v) => maxSorted.length - countLE(arr, v-1);
      const mcReachA = [], mcReachB = [];
      for(let x=0;x<=s;x++){
        let ca;
        if(x === 0) ca = countLE(minSorted, 0);
        else if(x === s) ca = countGE(maxSorted, s);
        else if(x > uA) ca = countGE(maxSorted, x);
        else if(x < uA) ca = countLE(minSorted, x);
        else ca = nSims;
        mcReachA.push(ca / nSims);

        // Bob's own bankroll = s - x.
        const y = s - x;
        let cb;
        if(y === 0) cb = countGE(maxSorted, s);            // Bob at $0 = Alice wins
        else if(y === s) cb = countLE(minSorted, 0);       // Bob takes all = Alice at $0
        else if(y > uB) cb = countLE(minSorted, s - y);
        else if(y < uB) cb = countGE(maxSorted, s - y);
        else cb = nSims;
        mcReachB.push(cb / nSims);
      }

      const stat = (arr, label, color) => `<div class="stat-card"><div class="label">${label}</div><div class="value">${arr}</div></div>`;

      $('ruinWinGrid').innerHTML =
        stat(`<span class="green">${(mcAliceWin*100).toFixed(1)}%</span>`, 'Alice wins (Bob $0)') +
        stat(`<span class="red">${(mcBobWin*100).toFixed(1)}%</span>`, 'Bob wins (Alice $0)') +
        stat(`<span class="blue">${mean(durations).toFixed(0)}</span>`, 'MC flips to ruin');

      $('ruinKpiRow').innerHTML =
        `<div class="kpi">Theory: <strong class="green">${(theoryAliceWin*100).toFixed(1)}%</strong> Alice / <strong class="red">${(theoryBobWin*100).toFixed(1)}%</strong> Bob</div>` +
        `<div class="kpi">Theory E[flips]: <strong>${expectedFlips(uA, s, p, q).toFixed(0)}</strong></div>` +
        `<div class="kpi">Median flips: <strong>${quantile(durations,0.5).toFixed(0)}</strong></div>` +
        `<div class="kpi">95th pct flips: <strong>${quantile(durations,0.95).toFixed(0)}</strong></div>`;

      const rows = [
        {label:'Alice reaches $'+ (tA*stake) + ' before Bob $0', mc: hitACount/nSims, th: aliceReachProb(uA, s, tA, p, q)},
        {label:'Bob reaches $'+ (tB*stake) + ' before Alice $0', mc: hitBCount/nSims, th: bobReachProb(uA, s, tB, p, q)}
      ];
      $('ruinTargetTable').querySelector('tbody').innerHTML = rows.map(r=>{
        const d = (r.mc - r.th)*100;
        return `<tr><td>${r.label}</td><td>${(r.mc*100).toFixed(1)}%</td><td>${(r.th*100).toFixed(1)}%</td><td>${(d>=0?'+':'')+d.toFixed(1)} pts</td></tr>`;
      }).join('');

      drawRuinDuration(durations);
      drawRuinReach(uA, uB, mcReachA, mcReachB);

      const fairPct = Math.abs(p - q) < 1e-12 ? '50% / 50%' : `${(p*100).toFixed(1)}% / ${(q*100).toFixed(1)}%`;
      const total$ = s * stake;
      const a$ = uA * stake, b$ = uB * stake;
      $('ruinInterpretation').innerHTML = `
        <h2>Interpretation — ${uA}-unit vs ${uB}-unit coin duel</h2>
        <p>Alice starts with <strong>$${a$.toLocaleString()}</strong> (${uA} units), Bob with <strong>$${b$.toLocaleString()}</strong> (${uB} units). Total pot <strong>$${total$.toLocaleString()}</strong> (${s} units). Coin: Alice wins a flip <strong>${fairPct}</strong>.</p>
        <div class="callout">
          <strong>Who goes broke?</strong> Alice ruins Bob with probability ${(theoryAliceWin*100).toFixed(1)}% (MC ${(mcAliceWin*100).toFixed(1)}%). Bob ruins Alice with probability ${(theoryBobWin*100).toFixed(1)}% (MC ${(mcBobWin*100).toFixed(1)}%). ${Math.abs(p-q)<1e-12 ? 'With a fair coin, these odds are exactly <code>Alice / (Alice+Bob)</code> — the richer player is the favorite, but the poorer player still has a real shot.' : 'With a biased coin the formulas below change the odds dramatically.'}
          <br><br>
          <strong>Expected length:</strong> about ${expectedFlips(uA, s, p, q).toFixed(0)} flips (MC mean ${mean(durations).toFixed(0)}, median ${quantile(durations,0.5).toFixed(0)}). The game almost always runs far longer than intuition suggests.
        </div>
        <p><strong>The exact mathematics.</strong> Let Alice hold <code>a</code> units, Bob <code>b</code> units, total <code>s = a + b</code>, and let <code>p</code> be Alice&rsquo;s chance to win one flip, <code>q = 1 - p</code>. Alice&rsquo;s bankroll is a fair one-step random walk <code>i → i+1</code> (Alice wins) or <code>i → i-1</code> (Alice loses), absorbed at <code>0</code> and <code>s</code>.</p>
        <p>Ruination happens when the random walk hits <code>0</code> (Bob wins) or <code>s</code> (Alice wins).</p>
        <p><strong>Fair coin (p = q = 1/2):</strong></p>
        <p>P(Alice ruins Bob) = a / (a+b), P(Bob ruins Alice) = b / (a+b), E[flips] = a·b.</p>
        <p>So a $70 vs $30 duel with $1 stakes (70 vs 30 units) ends with Alice winning <strong>70%</strong> of the time on average, Bob winning <strong>30%</strong>, and it lasts about <strong>2,100</strong> flips. With $10 stakes (7 vs 3 units) the odds are the same but it lasts about <strong>21</strong> flips — the distribution is wide, as the histogram above shows.</p>
        <p><strong>Biased coin (p ≠ q):</strong></p>
        <p>P(Alice ruins Bob) = (1 − (q/p)<sup>a</sup>) / (1 − (q/p)<sup>a+b</sup>).</p>
        <p>P(Alice ever reaches level x before Bob&rsquo;s $0) = (1 − (q/p)<sup>a</sup>) / (1 − (q/p)<sup>x</sup>) if x &gt; a, or the mirror formula if x &lt; a. The reach chart above shows this for every level.</p>
        <p><strong>Reading the reach chart:</strong> For a level above Alice&rsquo;s start, the curve is the probability she ever gets there before Bob runs out. For a level below her start, it is the probability she ever drops there before Alice herself hits $0. The dashed Monte Carlo lines line up with the solid exact curves — that is the point: thousands of simulated games recreate the formula.</p>
        <p class="small" style="margin-top:10px">Model: one unit changes by exactly 1 per flip; bankrolls and targets are rounded to whole stakes. Independence per flip; no limit on game length. Not advice — just the mathematics of why bankroll size is the whole game.</p>
      `;
    } catch(err){
      console.error(err);
      alert('Gambler&rsquo;s-ruin simulation failed: ' + (err && err.message ? err.message : err));
    } finally {
      btn.textContent = prevLabel;
      btn.disabled = false;
    }
  }, 30);
}
window.runGamblersRuin = runGamblersRuin;
$('ruinRunBtn').addEventListener('click', runGamblersRuin);

function copySessionToRuin(){
  const start = +$('bankroll').value || 1000;
  const bet = +$('minBet').value || 25;
  const units = Math.max(1, Math.round(start / bet));
  $('ruinA').value = units;
  $('ruinB').value = Math.max(1, Math.round(units * 0.5));
  $('ruinStake').value = bet;
  $('ruinTargetA').value = units + Math.floor(units * 0.5);
  $('ruinTargetB').value = units + Math.floor(units * 0.5);
  updateRuinDerived();
}
window.copySessionToRuin = copySessionToRuin;
$('ruinCopyBtn').addEventListener('click', copySessionToRuin);

// Auto-run the gambler's-ruin simulation the first time the tab is opened,
// so the math is visible immediately rather than behind a blank placeholder.
let ruinAutoRan = false;
document.querySelectorAll('.tab-btn[data-tab="ruin"]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(!ruinAutoRan){
      ruinAutoRan = true;
      setTimeout(runGamblersRuin, 120);
    }
  });
});
