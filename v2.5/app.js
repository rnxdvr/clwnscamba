/** CLWNSCAM — standalone roulette. No dependencies or server required. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const els = {
    splash: $('splash'), introBlur: $('introBlur'), modalNick: $('modalNick'), modalWarmup: $('modalWarmup'),
    statsModal: $('statsModal'), testModal: $('testModal'), probModal: $('probModal'),
    nicknameInput: $('nicknameInput'), nickForm: $('nickForm'), currentNick: $('currentNick'),
    spinBtn: $('spinBtn'), warmupSpinBtn: $('warmupSpinBtn'), changeNickBtn: $('changeNickBtn'),
    rouletteItems: $('rouletteItems'), rouletteWrapper: $('rouletteWrapper'),
    statsList: $('statsListModal'), totalSpins: $('totalSpins'), scamSpins: $('scamSpins'), cleanSpins: $('cleanSpins'),
    reelState: $('reelState'), spinResult: $('spinResult'), resultDescription: $('resultDescription'),
    giantClown: $('giantClown'), clownRain: $('clownRain'),
    probInput: $('probInput'), currentProbDisplay: $('currentProbDisplay'),
    probFeedback: $('probFeedback'), chanceMetric: $('chanceMetric'),
    testSpinsInput: $('testSpinsInput'), testResults: $('testResults'), runTestBtn: $('runTestBtn'),
    toast: $('toast')
  };

  const ORIG_ELEMENTS = 20;
  // Reel sizes are provided by CSS and measured to stay aligned on every screen.
  let itemHeight = 120;
  let reelHeight = 360;
  const origHeight = () => ORIG_ELEMENTS * itemHeight;
  const SCAM = 'СКАМ';
  const NOT_SCAM = 'НЕ СКАМ';
  // The original spin SFX is 5.676563s (1.mp3). The reel runs alongside it;
  // use decoded metadata when available and a measured fallback otherwise.
  const SPIN_SOUND_MS = 5676.563;
  const STORAGE_STATS = 'clownStats';
  const STORAGE_PROB = 'clownScamProbability';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let nickname = '';
  let pendingInitialWarmup = false;
  let spinning = false;
  let currentY = 0;
  let spinFrame = null;
  let toastTimer = null;
  let giantTimer = null;
  let lastFocus = null;
  let testRunning = false;
  let scamProbability = 0.67;
  let stats = [];

  function readLocal(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch { return false; }
  }
  function formatDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  function formatDateOnly(date) {
    return formatDate(date).slice(0, 10);
  }
  function validOutcome(value) { return value === SCAM || value === NOT_SCAM; }

  // Old versions stored raw HTML strings in localStorage. Read them as *text* to
  // preserve the history without reintroducing HTML/script injection.
  function normaliseEntry(entry) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return {
        nickname: String(entry.nickname ?? '—').slice(0, 100),
        result: validOutcome(entry.result) ? entry.result : 'АРХИВ',
        date: String(entry.date ?? '').slice(0, 80),
        detail: String(entry.detail ?? '').slice(0, 300)
      };
    }
    if (typeof entry === 'string') {
      const holder = document.createElement('template');
      // DOM parsing does not insert the content into the live page; after this,
      // only textContent is used. Images and other legacy tags are never rendered.
      holder.innerHTML = entry;
      const name = holder.content.querySelector('.nickname')?.textContent || '—';
      const plain = holder.content.textContent.replace(/\s+/g, ' ').trim();
      const date = plain.match(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}/)?.[0] || '';
      const result = /ВИП/i.test(plain) ? NOT_SCAM : /успешно проебал/i.test(plain) ? SCAM : 'АРХИВ';
      return { nickname: name.slice(0, 100), result, date, detail: plain.slice(0, 300) };
    }
    return null;
  }
  function loadStats() {
    try {
      const stored = JSON.parse(readLocal(STORAGE_STATS) || '[]');
      if (Array.isArray(stored)) stats = stored.map(normaliseEntry).filter(Boolean).slice(-10000);
    } catch { stats = []; }
  }
  function persistStats() {
    if (!writeLocal(STORAGE_STATS, JSON.stringify(stats))) notify('Не удалось сохранить историю в браузере');
  }
  function loadProbability() {
    const raw = readLocal(STORAGE_PROB);
    if (raw !== null && raw.trim() !== '') {
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0 && value <= 1) scamProbability = value;
    }
    updateProbabilityLabels();
  }
  function updateProbabilityLabels() {
    els.chanceMetric.textContent = `${Math.round(scamProbability * 100)}%`;
    els.currentProbDisplay.textContent = scamProbability.toFixed(2);
  }
  function updateCounters() {
    const scams = stats.filter(s => s.result === SCAM).length;
    const clean = stats.filter(s => s.result === NOT_SCAM).length;
    els.totalSpins.textContent = String(stats.length);
    els.scamSpins.textContent = String(scams);
    els.cleanSpins.textContent = String(clean);
  }
  function addStatEntry(result, who) {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 31);
    stats.push({
      result, nickname: who, date: formatDate(now),
      detail: result === NOT_SCAM
        ? `ВИП с ${formatDateOnly(now)} по ${formatDateOnly(end)}`
        : 'Успешно проебал 15000 роторных клоунов'
    });
    persistStats();
    updateCounters();
  }
  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function renderStatsModal() {
    els.statsList.replaceChildren();
    if (!stats.length) {
      els.statsList.append(el('li', 'stats-item stats-empty', 'Здесь пока пусто. Крути рулетку — появятся результаты.'));
      $('resetStatsBtn').disabled = true;
      return;
    }
    $('resetStatsBtn').disabled = false;
    const fragment = document.createDocumentFragment();
    stats.forEach((s, i) => {
      const isClean = s.result === NOT_SCAM;
      const row = el('li', `stats-item${isClean ? ' clean' : ''}`);
      row.append(el('div', 'entry-symbol', isClean ? '✓' : '✳'));
      const body = el('div', 'entry-body');
      const top = el('div', 'entry-top');
      top.append(el('span', 'entry-nick', s.nickname), el('span', 'entry-outcome', s.result));
      body.append(top, el('p', 'entry-details', s.detail), el('div', 'entry-date', s.date));
      row.append(body);
      const del = el('button', 'delete-stat', '✕');
      del.type = 'button';
      del.dataset.index = String(i);
      del.setAttribute('aria-label', `Удалить результат ${s.nickname}`);
      row.append(del);
      fragment.append(row);
    });
    els.statsList.append(fragment);
  }
  function notify(message) {
    els.toast.textContent = message;
    els.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 3000);
  }

  const MODALS = [els.modalNick, els.modalWarmup, els.statsModal, els.testModal, els.probModal];
  function activeModal() { return MODALS.find(m => !m.classList.contains('hidden')) || null; }
  function openModal(modal, focusSelector) {
    lastFocus = document.activeElement;
    MODALS.forEach(m => { if (m !== modal) m.classList.add('hidden'); });
    modal.classList.remove('hidden');
    document.body.classList.add('has-modal');
    const focusTarget = focusSelector ? modal.querySelector(focusSelector) : modal.querySelector('input, button');
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }
  function closeModal(modal) {
    if (modal === els.modalNick || modal === els.modalWarmup) return; // Required onboarding
    modal.classList.add('hidden');
    if (!activeModal()) document.body.classList.remove('has-modal');
    if (lastFocus?.isConnected && !lastFocus.disabled) lastFocus.focus({ preventScroll: true });
  }
  function finishWarmupChoice(yes) {
    pendingInitialWarmup = yes;
    els.modalWarmup.classList.add('hidden');
    document.body.classList.remove('has-modal');
    els.spinBtn.focus({ preventScroll: true });
    els.reelState.textContent = yes ? 'ПРОГРЕВ ПОШЕЛ' : '';
  }

  function buildRoulette() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < ORIG_ELEMENTS * 2; i++) {
      const scam = i % 2 === 0;
      fragment.append(el('div', `roulette-item ${scam ? 'scam' : 'not-scam'}`, scam ? SCAM : NOT_SCAM));
    }
    els.rouletteItems.replaceChildren(fragment);
    measureReel();
    setReelY(0);
  }
  function measureReel() {
    const first = els.rouletteItems.firstElementChild;
    if (first) itemHeight = first.getBoundingClientRect().height || 120;
    reelHeight = els.rouletteWrapper.getBoundingClientRect().height || itemHeight * 3;
  }
  function setReelY(y) {
    const height = origHeight();
    currentY = ((y % height) + height) % height;
    els.rouletteItems.style.transform = `translate3d(0, -${currentY}px, 0)`;
  }
  function setResultStyle(outcome) {
    els.spinResult.classList.toggle('is-scam', outcome === SCAM);
    els.spinResult.classList.toggle('is-clean', outcome === NOT_SCAM);
    els.rouletteWrapper.classList.toggle('scam-lens', outcome === SCAM);
    els.rouletteWrapper.classList.toggle('not-scam-lens', outcome === NOT_SCAM);
    els.rouletteWrapper.classList.toggle('lens-effect', Boolean(outcome));
  }
  const spinSound = new Audio('1.mp3');
  const winSound = new Audio('2.mp3');
  spinSound.preload = 'auto';
  spinSound.load();
  winSound.preload = 'none';
  function safePlay(audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
      const result = audio.play();
      if (result?.catch) result.catch(() => {});
    } catch { /* Audio can be unavailable without breaking the spin. */ }
  }
  function stopSpinSound() {
    try { spinSound.pause(); spinSound.currentTime = 0; } catch { /* unavailable */ }
  }
  function showSpinDots() {
    els.spinResult.replaceChildren(document.createTextNode('Крутите уебан'), el('span', 'loading-dots'));
    els.spinResult.setAttribute('aria-label', 'Крутите уебан...');
  }
  function showGiantClown() {
    clearTimeout(giantTimer);
    els.giantClown.classList.remove('show');
    // Force a fresh transition when triggered repeatedly.
    void els.giantClown.offsetWidth;
    els.giantClown.classList.add('show');
    giantTimer = setTimeout(() => els.giantClown.classList.remove('show'), reducedMotion.matches ? 100 : 250);
  }
  function startSpin(isScam, explicitlyWarmup = false) {
    if (spinning || !nickname) return;
    spinning = true;
    const isWarmup = explicitlyWarmup || pendingInitialWarmup;
    pendingInitialWarmup = false;
    [els.spinBtn, els.warmupSpinBtn, els.changeNickBtn].forEach(b => b.disabled = true);
    setResultStyle(null);
    els.reelState.textContent = isWarmup ? 'ПРОГРЕВ ПОШЕЛ' : '';
    showSpinDots();
    els.resultDescription.hidden = false;
    els.resultDescription.textContent = "They see me rollin', they hatin'";
    measureReel();
    safePlay(spinSound);

    const index = Math.floor(Math.random() * (ORIG_ELEMENTS / 2)) * 2 + (isScam ? 0 : 1);
    const centerOffset = (reelHeight - itemHeight) / 2;
    const rotations = reducedMotion.matches ? 1 : 3 + Math.floor(Math.random() * 4);
    const target = (index + rotations * ORIG_ELEMENTS) * itemHeight - centerOffset;
    const initial = currentY;
    const duration = reducedMotion.matches ? 200 :
      (Number.isFinite(spinSound.duration) && spinSound.duration > 1 ? spinSound.duration * 1000 : SPIN_SOUND_MS);
    const begun = performance.now();

    function animate(now) {
      const t = Math.min(1, (now - begun) / duration);
      // Restore the original quadratic ease-out; the audio ends on the last frame.
      const eased = 2 * t - t * t;
      setReelY(initial + (target - initial) * eased);
      if (t < 1) { spinFrame = requestAnimationFrame(animate); return; }
      setReelY(target);
      spinning = false;
      spinFrame = null;
      [els.spinBtn, els.warmupSpinBtn, els.changeNickBtn].forEach(b => b.disabled = false);
      stopSpinSound(); // Never overlap the spin SFX with the result SFX.
      safePlay(winSound);
      els.spinResult.removeAttribute('aria-label');
      const result = isScam ? SCAM : NOT_SCAM;
      if (!isWarmup) addStatEntry(result, nickname);
      els.reelState.textContent = isWarmup ? 'ПРОГРЕВ ПОШЕЛ' : '';
      els.spinResult.textContent = result;
      els.resultDescription.hidden = false;
      els.resultDescription.textContent = isWarmup ? 'ПРОГРЕВ ПОШЕЛ' : isScam ? 'А на что ты надеялся?' : 'Это была прогревочная, короче, не щитово';
      setResultStyle(result);
      if (!reducedMotion.matches) showGiantClown();
    }
    spinFrame = requestAnimationFrame(animate);
  }

  // Decorative rain: 50% more sprites than v2.2 (14 -> 21, 33 -> 50),
  // and 20% higher falling velocity. A shuffled, jittered grid prevents
  // duplicate spawn coordinates; respawns check near-top neighbours.
  const RAIN_SPEED = 1.2;
  const CLOWN_SIZE = 62;
  let clowns = [];
  let rainFrame = null;
  let lastFrameTime = 0;
  let resizeTimer = null;
  let pointerX = -9999, pointerY = -9999;
  function randomBetween(min, max) { return min + Math.random() * (max - min); }
  function randomFallSpeed() { return randomBetween(.44, .88) * RAIN_SPEED; }
  function shuffledSpawnPositions(count, width, height) {
    // Equal-area cells guarantee well-spaced initial positions, even on phones.
    const columns = Math.max(2, Math.ceil(Math.sqrt(count * width / height)));
    const rows = Math.ceil(count / columns);
    const cellW = width / columns;
    const cellH = height / rows;
    const slots = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        // Keep jitter under 12%: sprites are never born in the same place.
        const x = Math.max(0, (col + .5 + randomBetween(-.12,.12)) * cellW - CLOWN_SIZE / 2);
        const y = (row + .5 + randomBetween(-.12,.12)) * cellH - CLOWN_SIZE / 2;
        slots.push({ x, y });
      }
    }
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    return slots.slice(0, count);
  }
  function respawnClown(c) {
    const maxX = Math.max(0, innerWidth - CLOWN_SIZE);
    let chosenX = 0;
    let bestGap = -1;
    // Reserve at least one sprite width near the top; when all lanes are
    // occupied, queue the new sprite further above the viewport instead.
    for (let attempt = 0; attempt < 36; attempt++) {
      const x = Math.random() * maxX;
      const neighbours = clowns.filter(other => other !== c && other.y < 35 && other.y > -195);
      const gap = neighbours.length ? Math.min(...neighbours.map(other => Math.abs(other.x - x))) : Infinity;
      if (gap > bestGap) { bestGap = gap; chosenX = x; }
      if (gap >= CLOWN_SIZE + 9) break;
    }
    c.x = chosenX;
    c.y = bestGap < CLOWN_SIZE + 9 ? -180 : -72;
    c.vy = randomBetween(.4,.8) * RAIN_SPEED;
    c.vx = randomBetween(-.08,.08);
  }
  function createClowns() {
    els.clownRain.replaceChildren();
    clowns = [];
    if (reducedMotion.matches) return;
    const count = innerWidth <= 560 ? 21 : 50;
    const positions = shuffledSpawnPositions(count, innerWidth, innerHeight);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const img = document.createElement('img');
      img.src = 'icon-4.png'; img.alt = ''; img.className = 'clown'; img.draggable = false;
      frag.append(img);
      clowns.push({img, x: positions[i].x, y: positions[i].y,
        vx: randomBetween(-.15,.15), vy: randomFallSpeed(),
        a: Math.random()*360, av: randomBetween(-.06,.06)});
      img.style.transform = `translate3d(${positions[i].x}px,${positions[i].y}px,0)`;
    }
    els.clownRain.append(frag);
  }
  function updateRain(timestamp) {
    rainFrame = requestAnimationFrame(updateRain);
    if (timestamp - lastFrameTime < 32) return;
    const dt = Math.min((timestamp - (lastFrameTime || timestamp)) / 32, 2);
    lastFrameTime = timestamp;
    for (const c of clowns) {
      c.vy = Math.min(1.43 * RAIN_SPEED, c.vy + .0055 * RAIN_SPEED * dt);
      const dx = c.x - pointerX, dy = c.y - pointerY;
      const distance = Math.hypot(dx, dy);
      if (distance > 1 && distance < 90) {
        c.vx += (dx/distance) * .32 * dt;
        c.vy += (dy/distance) * .32 * dt;
      }
      c.vx *= .965;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.a += c.av * dt;
      if (c.y > innerHeight + 80) respawnClown(c);
      if (c.x < -CLOWN_SIZE) c.x = innerWidth;
      if (c.x > innerWidth) c.x = -CLOWN_SIZE;
      c.img.style.transform = `translate3d(${c.x}px,${c.y}px,0) rotate(${c.a}deg)`;
    }
  }
  function syncRain() {
    if (rainFrame !== null) { cancelAnimationFrame(rainFrame); rainFrame = null; }
    if (document.hidden || reducedMotion.matches) return;
    lastFrameTime = 0;
    rainFrame = requestAnimationFrame(updateRain);
  }
  function rebuildRain() { createClowns(); syncRain(); }
  document.addEventListener('visibilitychange', syncRain);
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      rebuildRain();
      // Reset the idle reel to an exact slot when responsive dimensions change.
      if (!spinning) buildRoulette();
    }, 180);
  });
  window.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { pointerX = e.clientX; pointerY = e.clientY; } }, { passive: true });
  document.addEventListener('pointerleave', () => { pointerX = -9999; pointerY = -9999; });
  reducedMotion.addEventListener?.('change', rebuildRain);

  // Events
  els.nickForm.addEventListener('submit', e => {
    e.preventDefault();
    const value = els.nicknameInput.value.trim();
    if (!value) { els.nicknameInput.focus(); return; }
    nickname = value.slice(0,30);
    els.currentNick.textContent = nickname;
    setResultStyle(null);
    els.spinResult.textContent = 'ГРИГОРИЙ, ЗАВОДИ';
    els.resultDescription.textContent = '';
    els.resultDescription.hidden = true;
    openModal(els.modalWarmup, '#warmupYesBtn');
  });
  $('warmupYesBtn').addEventListener('click', () => finishWarmupChoice(true));
  $('warmupNoBtn').addEventListener('click', () => finishWarmupChoice(false));
  els.changeNickBtn.addEventListener('click', () => {
    if (spinning) return;
    els.nicknameInput.value = nickname;
    openModal(els.modalNick, '#nicknameInput');
  });
  els.spinBtn.addEventListener('click', () => startSpin(Math.random() < scamProbability));
  els.warmupSpinBtn.addEventListener('click', () => startSpin(Math.random() < scamProbability, true));
  $('openStatsBtn').addEventListener('click', () => { renderStatsModal(); openModal(els.statsModal, '.modal-x'); });
  $('closeStatsBtn').addEventListener('click', () => closeModal(els.statsModal));
  $('resetStatsBtn').addEventListener('click', () => {
    if (stats.length && window.confirm('Точно удалить всю историю прокрутов?')) {
      stats = []; persistStats(); renderStatsModal(); updateCounters(); notify('История очищена');
    }
  });
  els.statsList.addEventListener('click', e => {
    const button = e.target.closest('button.delete-stat');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < stats.length) {
      stats.splice(index, 1); persistStats(); renderStatsModal(); updateCounters();
    }
  });
  $('questionBtn').addEventListener('click', showGiantClown);
  $('testMenuBtn').addEventListener('click', () => openModal(els.testModal, '#testSpinsInput'));
  $('closeTestBtn').addEventListener('click', () => closeModal(els.testModal));
  $('probBtn').addEventListener('click', () => {
    els.probInput.value = scamProbability.toFixed(2);
    els.probFeedback.textContent = '';
    updateProbabilityLabels();
    openModal(els.probModal, '#probInput');
  });
  $('closeProbBtn').addEventListener('click', () => closeModal(els.probModal));
  $('saveProbBtn').addEventListener('click', () => {
    const raw = els.probInput.value.trim().replace(',', '.');
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value) || value < 0 || value > 1) {
      els.probFeedback.textContent = 'Введи число от 0 до 1.';
      els.probInput.focus();
      return;
    }
    scamProbability = Math.round(value*100)/100;
    const saved = writeLocal(STORAGE_PROB, String(scamProbability));
    updateProbabilityLabels();
    closeModal(els.probModal);
    notify(saved ? `Шанс СКАМа теперь ${Math.round(scamProbability*100)}%` : 'Шанс изменён, но сохранить его не удалось');
  });
  els.probInput.addEventListener('input', () => {
    const raw = els.probInput.value.trim().replace(',', '.');
    const val = Number(raw);
    els.currentProbDisplay.textContent = raw && Number.isFinite(val) ? val.toFixed(2) : '—';
    els.probFeedback.textContent = '';
  });

  els.runTestBtn.addEventListener('click', async () => {
    if (testRunning) return;
    const raw = els.testSpinsInput.value.trim();
    const count = Number(raw);
    if (raw === '' || !Number.isInteger(count) || count < 1 || count > 1_000_000) {
      els.testResults.textContent = 'Введите целое число от 1 до 1 000 000.';
      return;
    }
    testRunning = true;
    els.runTestBtn.disabled = true;
    els.testResults.textContent = 'Симуляция запущена…';
    let scamCount = 0;
    const chance = scamProbability; // Snapshot: editing settings cannot change an ongoing test.
    console.log(`[CLWNSCAM] Тест: ${count} прокрутов, шанс СКАМа ${chance}`);
    for (let i = 0; i < count; i += 20_000) {
      const batch = Math.min(count - i, 20_000);
      for (let j = 0; j < batch; j++) if (Math.random() < chance) scamCount++;
      if (count > 20_000) {
        els.testResults.textContent = `Выполнено ${Math.min(count, i+batch).toLocaleString('ru-RU')} из ${count.toLocaleString('ru-RU')}…`;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    const cleanCount = count - scamCount;
    const percent = (scamCount / count * 100).toFixed(2);
    els.testResults.replaceChildren();
    const line = el('div');
    line.append(el('span', null, 'СКАМ: '), el('strong', 'test-scam', `${scamCount.toLocaleString('ru-RU')} (${percent}%)`));
    const line2 = el('div');
    line2.append(el('span', null, 'НЕ СКАМ: '), el('strong', 'test-clean', `${cleanCount.toLocaleString('ru-RU')} (${(100 - Number(percent)).toFixed(2)}%)`));
    els.testResults.append(el('div', null, `Всего: ${count.toLocaleString('ru-RU')} · заданный шанс: ${Math.round(chance*100)}%`), line, line2);
    console.log(`[CLWNSCAM] Тест закончен: СКАМ ${scamCount} (${percent}%), НЕ СКАМ ${cleanCount}`);
    testRunning = false;
    els.runTestBtn.disabled = false;
  });

  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeModal($(button.dataset.close))));
  [els.statsModal, els.testModal, els.probModal].forEach(modal => {
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); });
  });
  document.addEventListener('keydown', e => {
    const modal = activeModal();
    if (!modal) return;
    if (e.key === 'Escape') {
      if (modal !== els.modalNick && modal !== els.modalWarmup) closeModal(modal);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')].filter(n => n.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });

  function finishSplash() {
    els.splash.classList.add('fading');
    // Fade the full-page background blur over 3.0 seconds: the original logo
    // finishes its 2.4-second fade 600ms earlier than the blur.
    els.introBlur.classList.add('clearing');
    const motion = !reducedMotion.matches;
    setTimeout(() => {
      els.splash.classList.add('hidden');
    }, motion ? 2450 : 15);
    setTimeout(() => {
      els.introBlur.classList.add('hidden');
      openModal(els.modalNick, '#nicknameInput');
    }, motion ? 3060 : 20);
  }
  // 7TV assets are hosted externally. Keep the heading neat if the CDN fails.
  const sevenTvEmote = document.querySelector('.seven-tv-emote');
  sevenTvEmote?.addEventListener('error', () => {
    const fallback = el('span', 'seven-tv-fallback', '✦');
    fallback.title = 'Эмоут 7TV недоступен';
    sevenTvEmote.replaceWith(fallback);
  }, { once: true });
  buildRoulette();
  loadStats();
  updateCounters();
  loadProbability();
  rebuildRain();
  window.addEventListener('pagehide', () => {
    if (spinFrame !== null) cancelAnimationFrame(spinFrame);
    if (rainFrame !== null) cancelAnimationFrame(rainFrame);
  }, { once: true });
  setTimeout(finishSplash, reducedMotion.matches ? 50 : 1800);
})();
