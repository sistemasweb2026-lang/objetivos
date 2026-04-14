'use strict';
// ═══════════════════════════════════════════════════════════
//  MI SISTEMA — app.js  v6.0
//  Módulos: AUTH · CLOUD · SOUND · DATA · UI · POMODORO
// ═══════════════════════════════════════════════════════════

// ── UTILS GLOBALES ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const uid  = () => Math.random().toString(36).slice(2,9);
const esc  = s  => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmtD = s  => s ? (()=>{ const [y,m,d]=s.split('-'); return `${d}/${m}`; })() : '';
const pClr = p  => p>=70?'var(--grn)':p>=35?'var(--yel)':'var(--red)';
const isIOS  = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isAnd  = /Android/.test(navigator.userAgent);
const isStan = window.matchMedia('(display-mode:standalone)').matches || !!window.navigator.standalone;

// ── DATE / TIME — TIMEZONE SAFE ─────────────────────────────
function localStr(offset = 0) {
  const d = new Date();
  if (offset) d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const today    = () => localStr(0);
const tomorrow = () => localStr(1);
const inDays   = n  => localStr(n);

function parseLD(s) {
  if (!s) return null;
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

function dtl(dateStr) {
  if (!dateStr) return null;
  const target  = parseLD(dateStr);
  const now     = new Date();
  const todayMid= new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - todayMid) / 86400000);
}

function localDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y,m,d] = dateStr.split('-').map(Number);
  if (timeStr) {
    const [h,mi] = timeStr.split(':').map(Number);
    return new Date(y, m-1, d, h, mi, 0, 0);
  }
  return new Date(y, m-1, d, 0, 0, 0, 0);
}

// ══════════════════════════════════════════════════════════════
//  AUTH MODULE
// ══════════════════════════════════════════════════════════════
const AUTH = {
  user:  null,  // { id, username, email } | null (guest)
  token: null,
  isGuest: false,

  init() {
    const stored = localStorage.getItem('ms_auth');
    if (stored) {
      try {
        const d = JSON.parse(stored);
        this.user    = d.user;
        this.token   = d.token;
        this.isGuest = d.isGuest || false;
      } catch(e) { localStorage.removeItem('ms_auth'); }
    }
  },

  save() {
    localStorage.setItem('ms_auth', JSON.stringify({
      user: this.user, token: this.token, isGuest: this.isGuest
    }));
  },

  clear() {
    this.user = null; this.token = null; this.isGuest = false;
    localStorage.removeItem('ms_auth');
  },

  get username() { return this.user?.username || 'Usuario'; },
  get loggedIn()  { return !!this.user || this.isGuest; },

  headers() {
    return { 'Content-Type': 'application/json',
      ...(this.token ? { 'Authorization': 'Bearer ' + this.token } : {}) };
  },

  async verify() {
    if (!this.token) return false;
    try {
      const r = await fetch('api/auth.php', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ action: 'verify' })
      });
      const d = await r.json();
      return d.ok;
    } catch(e) { return false; }
  },

  async register(username, email, password) {
    const localData = hasLocalData() ? S : null;
    const r = await fetch('api/auth.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', username, email, password,
        ...(localData ? { initialData: localData } : {}) })
    });
    const d = await r.json();
    if (d.ok) {
      this.user    = d.user;
      this.token   = d.token;
      this.isGuest = false;
      this.save();
    }
    return d;
  },

  async login(identifier, password) {
    const r = await fetch('api/auth.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', identifier, password })
    });
    const d = await r.json();
    if (d.ok) {
      this.user    = d.user;
      this.token   = d.token;
      this.isGuest = false;
      this.save();
    }
    return d;
  },

  async logout() {
    if (this.token) {
      fetch('api/auth.php', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ action: 'logout' })
      }).catch(()=>{});
    }
    this.clear();
    CLOUD.clearSyncTimer();
    // Reload to show auth screen
    location.reload();
  },

  setGuest() {
    this.isGuest = true;
    this.user    = null;
    this.token   = null;
    this.save();
  }
};

// ══════════════════════════════════════════════════════════════
//  CLOUD SYNC MODULE
// ══════════════════════════════════════════════════════════════
const CLOUD = {
  syncTimer: null,
  lastSync:  null,
  pending:   false,

  clearSyncTimer() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
  },

  setSyncStatus(state, msg) {
    const el = $('syncStatus');
    if (!el) return;
    el.className = 'top-acts-sync ' + (state || '');
    el.textContent = msg || '';
  },

  // Debounced save: waits 3s after last change before syncing
  queueSync() {
    if (AUTH.isGuest || !AUTH.token) return;
    this.pending = true;
    this.setSyncStatus('syncing', '↑ Guardando…');
    this.clearSyncTimer();
    this.syncTimer = setTimeout(() => this.pushToCloud(), 3000);
  },

  async pushToCloud() {
    if (!AUTH.token) return;
    try {
      const r = await fetch('api/sync.php', {
        method: 'POST',
        headers: AUTH.headers(),
        body: JSON.stringify({ action: 'save', data: S })
      });
      const d = await r.json();
      if (d.ok) {
        this.lastSync = new Date();
        this.pending  = false;
        this.setSyncStatus('', '✓ Sincronizado');
        setTimeout(() => this.setSyncStatus('', ''), 3000);
      } else {
        this.setSyncStatus('error', '⚠ Error al guardar');
      }
    } catch(e) {
      this.setSyncStatus('error', '⚠ Sin conexión');
    }
  },

  async loadFromCloud() {
    if (!AUTH.token) return null;
    try {
      const r = await fetch('api/sync.php', {
        method: 'POST',
        headers: AUTH.headers(),
        body: JSON.stringify({ action: 'load' })
      });
      const d = await r.json();
      return d.ok ? d : null;
    } catch(e) { return null; }
  }
};

// ══════════════════════════════════════════════════════════════
//  SOUND ENGINE
// ══════════════════════════════════════════════════════════════
const SND = {
  ctx: null,
  enabled: localStorage.getItem('snd') !== 'off',
  vol: parseFloat(localStorage.getItem('snd_vol') || '0.3'),

  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
  },

  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  },

  _tone(freq, dur, type = 'sine', vol, delay = 0) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.connect(g); g.connect(this.ctx.destination);
      o.type = type;
      const t = this.ctx.currentTime + delay;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol || this.vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur + 0.01);
    } catch(e){}
  },

  alert()    { this._tone(880,.12,'square',.28); this._tone(880,.15,'square',.28,.24); this._tone(660,.18,'square',.22,.5); },
  success()  { this._tone(440,.1,'sine',.22); this._tone(554,.1,'sine',.22,.12); this._tone(659,.28,'sine',.25,.25); this._tone(880,.32,'sine',.2,.45); },
  pomodoro() { [0,.35,.7].forEach((d,i)=>this._tone([800,640,760][i],.4,'sine',.3,d)); },
  reminder() { this._tone(640,.16,'sine',.2); this._tone(800,.28,'sine',.2,.2); },
  pop()      { this._tone(520,.07,'sine',.15); },
  urgent()   { [0,.15,.3,.45].forEach(d=>this._tone(d<.3?940:660,.12,'square',.3,d)); },
};
SND.init();

const doUnlock = () => {
  SND.unlock();
  document.removeEventListener('touchstart', doUnlock);
  document.removeEventListener('click', doUnlock);
};
document.addEventListener('touchstart', doUnlock, { passive: true });
document.addEventListener('click', doUnlock, { once: true });

// ══════════════════════════════════════════════════════════════
//  NOTIFICATION LOG
// ══════════════════════════════════════════════════════════════
let nlog = []; try { nlog = JSON.parse(localStorage.getItem('nlog') || '[]'); } catch{}
nlog = nlog.slice(0, 60);
let unread = parseInt(localStorage.getItem('nread') || '0');

function addLog(title, body, icon = '🔔') {
  nlog.unshift({ title, body, icon, ts: Date.now() });
  nlog = nlog.slice(0, 60);
  localStorage.setItem('nlog', JSON.stringify(nlog));
  unread++;
  localStorage.setItem('nread', unread);
  updateBell();
}

function updateBell() {
  const el = $('bellC');
  if (!el) return;
  if (unread > 0) { el.textContent = unread > 99 ? '99+' : unread; el.style.display = ''; }
  else el.style.display = 'none';
  const td = today();
  const late = [...S.tareas, ...S.trabajo, ...S.objetivos, ...S.metas].filter(x => !x.done && x.fecha && x.fecha < td).length;
  const nbt = $('nb-t'); if(nbt){ nbt.textContent = late || ''; nbt.style.display = late ? '' : 'none'; }
  const nbd = $('nb-d'); if(nbd){ nbd.textContent = late || ''; nbd.style.display = late ? '' : 'none'; }
  const snbt = $('snb-t'); if(snbt){ snbt.textContent = late || ''; snbt.style.display = late ? '' : 'none'; }
  const snbd = $('snb-d'); if(snbd){ snbd.textContent = late || ''; snbd.style.display = late ? '' : 'none'; }
}

function fmtTs(ts) {
  const d = new Date(ts), now = new Date(), diff = Math.round((now - d) / 60000);
  if (diff < 1) return 'ahora';
  if (diff < 60) return `hace ${diff} min`;
  if (diff < 1440) return `hace ${Math.round(diff/60)}h`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// ══════════════════════════════════════════════════════════════
//  FIRE NOTIFICATION
// ══════════════════════════════════════════════════════════════
function fireNotif(title, body, icon = '⏰', snd = 'alert', urgent = false) {
  SND[snd]?.();
  if (navigator.vibrate) navigator.vibrate(urgent ? [400,100,400,100,400] : [200,100,200]);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body, icon: '/icon.svg', badge: '/icon.svg', tag: 'ms-' + Date.now(),
        requireInteraction: urgent, renotify: true, silent: false,
        vibrate: urgent ? [400,100,400,100,400] : [200,100,200],
      });
    } catch(e){}
  }
  addLog(title, body, icon);
  toast(`${icon} ${title}`, urgent ? 4000 : 2800);
}

function reqNotif() {
  if (!('Notification' in window)) { toast('Tu navegador no soporta notificaciones'); return; }
  if (isIOS && !isStan) { $('iosBanner').classList.add('show'); toast('📲 Primero instala la app en tu pantalla de inicio'); return; }
  Notification.requestPermission().then(p => {
    if (p === 'granted') {
      $('notifPerm').classList.remove('show');
      SND.success();
      toast('🔔 Notificaciones activadas ✓');
      addLog('Notificaciones activadas', 'Recibirás alertas en tiempo real', '🔔');
      scheduleSwNotifs();
    } else {
      toast('❌ Permiso denegado — ve a Ajustes del navegador');
    }
  });
}

function checkNotifPerm() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') $('notifPerm').classList.add('show');
  if (isIOS && !isStan) setTimeout(() => $('iosBanner').classList.add('show'), 3000);
}

// ══════════════════════════════════════════════════════════════
//  SERVICE WORKER
// ══════════════════════════════════════════════════════════════
let swReady = false;
function scheduleSwNotifs() {
  if (!navigator.serviceWorker?.controller) return;
  const now = Date.now(), td = today();
  const items = [];
  S.tareas.filter(t => !t.done && t.fecha && t.hora).forEach(t => {
    const fireAt = localDateTime(t.fecha, t.hora)?.getTime();
    if (!fireAt || fireAt <= now) return;
    const urgent = t.prio === 'alta';
    items.push({ tag: `t-${t.id}`, taskId: t.id, title: `⏰ ${t.nombre}`, body: t.nota || `Hora: ${t.hora}`, fireAt, urgent });
    if (fireAt - 15*60000 > now) items.push({ tag: `t-${t.id}-15`, taskId: t.id, title: `🔔 En 15 min: ${t.nombre}`, body: `A las ${t.hora}`, fireAt: fireAt-15*60000, urgent: false });
    if (fireAt - 5*60000 > now)  items.push({ tag: `t-${t.id}-5`,  taskId: t.id, title: `⚡ En 5 min: ${t.nombre}`,  body: `A las ${t.hora}`, fireAt: fireAt-5*60000,  urgent });
  });
  navigator.serviceWorker.controller.postMessage({ type: 'SCHEDULE', items });
}

function pingSwAlive() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'PING' });
}

navigator.serviceWorker?.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'MARK_DONE' && e.data.taskId) {
    const it = S.tareas.find(x => x.id === e.data.taskId);
    if (it) { it.done = true; it.progreso = 100; save(); renderAll(); toast('✅ Completado desde notificación'); }
  }
  if (e.data.type === 'SNOOZE' && e.data.taskId) snoozeTask(e.data.taskId, 10);
});

// ══════════════════════════════════════════════════════════════
//  URGENT ALERT OVERLAY
// ══════════════════════════════════════════════════════════════
let urgentTaskId = null;

function showUrgent(task) {
  urgentTaskId = task.id;
  $('uEmoji').textContent = task.prio === 'alta' ? '🚨' : '⏰';
  $('uTitle').textContent = task.nombre;
  $('uSub').textContent   = `${task.hora} · ${task.cat}${task.nota ? '\n' + task.nota : ''}`;
  $('urgentOverlay').classList.add('show');
  SND.urgent();
  if (navigator.vibrate) navigator.vibrate([500,100,500,100,500]);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(`⏰ ${task.nombre}`, { body: `Hora: ${task.hora}`, icon: '/icon.svg', requireInteraction: true }); } catch(e){}
  }
  addLog(`⏰ ${task.nombre}`, `Hora: ${task.hora}`, '⏰');
}

function dismissUrgent() { $('urgentOverlay').classList.remove('show'); urgentTaskId = null; }

function doneUrgent() {
  if (urgentTaskId) qToggle('tareas', urgentTaskId);
  dismissUrgent();
}

function snoozeUrgent() {
  if (urgentTaskId) snoozeTask(urgentTaskId, 10);
  dismissUrgent();
}

function snoozeTask(id, minutes = 10) {
  const it = S.tareas.find(x => x.id === id); if (!it) return;
  const n = new Date(); n.setMinutes(n.getMinutes() + minutes);
  it.hora  = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
  it.fecha = today();
  save(); renderAll(); scheduleSwNotifs();
  toast(`⏰ Pospuesto a las ${it.hora}`);
}

// ══════════════════════════════════════════════════════════════
//  DATA
// ══════════════════════════════════════════════════════════════
const DATA_KEY = 'ms_v6';

function defData() {
  return {
    tareas: [
      { id: uid(), tipo: 'tarea', nombre: 'Revisar correos',    nota: '',                cat: 'trabajo',   prio: 'alta',  fecha: today(), hora: '09:00', done: false, rep: 'nunca' },
      { id: uid(), tipo: 'tarea', nombre: 'Ejercicio 30 min',   nota: 'Cardio o fuerza', cat: 'salud',     prio: 'media', fecha: today(), hora: '07:00', done: false, rep: 'diario' },
      { id: uid(), tipo: 'tarea', nombre: 'Planificar el día',  nota: 'Revisar agenda',  cat: 'personal',  prio: 'alta',  fecha: today(), hora: '08:00', done: false, rep: 'diario' },
      { id: uid(), tipo: 'tarea', nombre: 'Leer 20 páginas',    nota: '',                cat: 'educación', prio: 'baja',  fecha: today(), hora: '21:00', done: false, rep: 'diario' },
    ],
    trabajo: [
      { id: uid(), tipo: 'trabajo', nombre: 'Presentación Q2', nota: 'Entregar fin de mes', cat: 'trabajo', prio: 'alta',  fecha: inDays(12), hora: '', done: false, progreso: 40, rep: 'nunca' },
      { id: uid(), tipo: 'trabajo', nombre: 'Informe mensual', nota: '',                    cat: 'trabajo', prio: 'media', fecha: inDays(5),  hora: '', done: false, progreso: 65, rep: 'nunca' },
    ],
    objetivos: [
      { id: uid(), tipo: 'objetivo', nombre: 'Certificación online', nota: 'Curso liderazgo',   cat: 'educación', prio: 'alta',  fecha: inDays(45), hora: '', done: false, progreso: 30, rep: 'nunca' },
      { id: uid(), tipo: 'objetivo', nombre: 'Correr 10 km',         nota: 'Entrenar 3x semana', cat: 'salud',    prio: 'media', fecha: inDays(90), hora: '', done: false, progreso: 15, rep: 'nunca' },
    ],
    metas: [
      { id: uid(), tipo: 'meta', nombre: 'Independencia financiera', nota: 'Ahorrar e invertir 20% mensual', cat: 'finanzas',  prio: 'alta',  fecha: inDays(730), hora: '', done: false, progreso: 10, rep: 'nunca' },
      { id: uid(), tipo: 'meta', nombre: 'Dominar inglés avanzado',  nota: 'Nivel B2 – 30 min diarios',     cat: 'educación', prio: 'media', fecha: inDays(365), hora: '', done: false, progreso: 28, rep: 'nunca' },
    ]
  };
}

function hasLocalData() {
  const raw = localStorage.getItem(DATA_KEY);
  if (!raw) return false;
  try {
    const d = JSON.parse(raw);
    const total = (d.tareas?.length || 0) + (d.trabajo?.length || 0) + (d.objetivos?.length || 0) + (d.metas?.length || 0);
    return total > 0;
  } catch(e) { return false; }
}

let S;
try { S = JSON.parse(localStorage.getItem(DATA_KEY)) || defData(); } catch { S = defData(); }

function save() {
  localStorage.setItem(DATA_KEY, JSON.stringify(S));
  scheduleSwNotifs();
  CLOUD.queueSync();
}

// ══════════════════════════════════════════════════════════════
//  AUTH UI
// ══════════════════════════════════════════════════════════════
let authTab = 'login';

function showAuthTab(tab) {
  authTab = tab;
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  $('loginForm').classList.toggle('auth-form-hidden', tab !== 'login');
  $('registerForm').classList.toggle('auth-form-hidden', tab !== 'register');
  $('authError').textContent = '';
}

function setAuthError(msg) {
  $('authError').textContent = msg;
}

async function authLogin() {
  const identifier = $('lEmail').value.trim();
  const password   = $('lPass').value;
  if (!identifier || !password) { setAuthError('Completa todos los campos'); return; }

  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'Iniciando sesión…';
  setAuthError('');

  const r = await AUTH.login(identifier, password);

  if (r.ok) {
    // Cargar datos del servidor
    if (r.data) {
      const localHasData = hasLocalData();
      if (localHasData) {
        // Preguntar al usuario qué datos usar
        await handleDataMerge(r.data, r.updatedAt);
      } else {
        S = r.data;
        localStorage.setItem(DATA_KEY, JSON.stringify(S));
      }
    }
    showApp();
  } else {
    setAuthError(r.error || 'Error al iniciar sesión');
    $('loginBtn').disabled = false;
    $('loginBtn').textContent = 'Iniciar sesión';
  }
}

async function authRegister() {
  const username = $('rUser').value.trim();
  const email    = $('rEmail').value.trim();
  const password = $('rPass').value;
  const pass2    = $('rPass2').value;

  if (!username || !email || !password) { setAuthError('Completa todos los campos'); return; }
  if (password !== pass2) { setAuthError('Las contraseñas no coinciden'); return; }
  if (password.length < 8) { setAuthError('La contraseña debe tener al menos 8 caracteres'); return; }

  $('registerBtn').disabled = true;
  $('registerBtn').textContent = 'Creando cuenta…';
  setAuthError('');

  const r = await AUTH.register(username, email, password);

  if (r.ok) {
    showApp();
    toast('🎉 ¡Cuenta creada exitosamente!', 3000);
  } else {
    setAuthError(r.error || 'Error al registrarse');
    $('registerBtn').disabled = false;
    $('registerBtn').textContent = 'Crear cuenta';
  }
}

function useAsGuest() {
  AUTH.setGuest();
  showApp();
}

async function handleDataMerge(cloudData, cloudUpdatedAt) {
  return new Promise(resolve => {
    const cloudDate = cloudUpdatedAt ? new Date(cloudUpdatedAt).toLocaleString('es-ES') : 'Desconocido';
    const localCount = (S.tareas?.length||0)+(S.trabajo?.length||0)+(S.objetivos?.length||0)+(S.metas?.length||0);
    const cloudCount = (cloudData.tareas?.length||0)+(cloudData.trabajo?.length||0)+(cloudData.objetivos?.length||0)+(cloudData.metas?.length||0);

    // Show merge dialog in detail sheet (reuse overlay)
    $('detSheet').innerHTML = `
      <div class="shdl"></div>
      <div class="shtitle">🔄 Datos existentes</div>
      <p style="font-size:.84rem;color:var(--mut);margin-bottom:16px;text-align:center;line-height:1.5">
        Encontramos datos guardados en dos lugares. ¿Cuáles quieres conservar?
      </p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn-big" style="margin:0;background:var(--acc)" onclick="useMergeOption('cloud')">
          ☁️ Usar datos de la nube<br>
          <small style="font-weight:400;opacity:.8">${cloudCount} ítems · Guardado: ${cloudDate}</small>
        </button>
        <button class="btn-big" style="margin:0;background:var(--grn);color:#000" onclick="useMergeOption('local')">
          📱 Usar datos de este dispositivo<br>
          <small style="font-weight:400;opacity:.8">${localCount} ítems</small>
        </button>
        <button class="btn-big" style="margin:0;background:var(--sur2);color:var(--txt);border:1px solid var(--bdr)" onclick="useMergeOption('merge')">
          🔀 Combinar ambos (sin duplicados)
        </button>
      </div>`;
    $('detModal').classList.add('open');

    window._resolveMerge = (choice) => {
      $('detModal').classList.remove('open');
      if (choice === 'cloud') {
        S = cloudData;
      } else if (choice === 'local') {
        // keep S as is, will upload on next save
      } else {
        // Merge: combine by id, cloud takes precedence for existing ids
        ['tareas','trabajo','objetivos','metas'].forEach(k => {
          const cloudIds = new Set(cloudData[k].map(x => x.id));
          const localOnly = (S[k] || []).filter(x => !cloudIds.has(x.id));
          S[k] = [...cloudData[k], ...localOnly];
        });
      }
      localStorage.setItem(DATA_KEY, JSON.stringify(S));
      delete window._resolveMerge;
      resolve();
    };
  });
}

function useMergeOption(choice) {
  if (window._resolveMerge) window._resolveMerge(choice);
}

function showApp() {
  $('authOverlay').classList.add('hidden');
  $('app').classList.remove('hidden');
  updateUserUI();
  initApp();
}

function updateUserUI() {
  // Top bar user info
  const sbUser = $('sbUser');
  if (sbUser) {
    if (AUTH.isGuest) {
      sbUser.innerHTML = '<strong>Invitado</strong><span>Solo en este dispositivo</span>';
    } else if (AUTH.user) {
      sbUser.innerHTML = `<strong>${esc(AUTH.user.username)}</strong><span>${esc(AUTH.user.email)}</span>`;
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════
let toastT;
function toast(msg, dur = 2700) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), dur);
}

// ══════════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════════
const PMAP = { dash: 'pDash', tareas: 'pTareas', enfoque: 'pEnfoque', objetivos: 'pObjetivos', metas: 'pMetas' };
const NMAP = { dash: 'n-dash', tareas: 'n-tareas', enfoque: 'n-enfoque', objetivos: 'n-objetivos', metas: 'n-metas' };
const SNMAP = { dash: 'sn-dash', tareas: 'sn-tareas', enfoque: 'sn-enfoque', objetivos: 'sn-objetivos', metas: 'sn-metas' };
const TMAP = { dash: '🎯 Mi Sistema', tareas: '✅ Tareas', enfoque: '🍅 Enfoque', objetivos: '🏆 Objetivos', metas: '🚀 Metas' };
let cur = 'dash';

function goTo(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.snav-item').forEach(x => x.classList.remove('active'));
  $(PMAP[p]).classList.add('active');
  const nb = $(NMAP[p]); if (nb) nb.classList.add('active');
  const sn = $(SNMAP[p]); if (sn) sn.classList.add('active');
  $('topTitle').textContent = TMAP[p];
  cur = p;
  renderAll();
}

// ══════════════════════════════════════════════════════════════
//  FILTERS
// ══════════════════════════════════════════════════════════════
let TF = 'hoy', OF = 'activos', MF = 'activas';
function setTF(f, b) { TF = f; document.querySelectorAll('#tChips .chip').forEach(c => c.classList.remove('active')); b.classList.add('active'); renderTareas(); }
function setOF(f, b) { OF = f; document.querySelectorAll('#pObjetivos .sb').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderObjetivos(); }
function setMF(f, b) { MF = f; document.querySelectorAll('#pMetas .sb').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderMetas(); }

// ══════════════════════════════════════════════════════════════
//  ADD / EDIT
// ══════════════════════════════════════════════════════════════
let addType = 'tarea', editId = null, editSec = null;
const t2s = { tarea: 'tareas', trabajo: 'trabajo', objetivo: 'objetivos', meta: 'metas' };

function openAdd(type, id, sec) {
  editId = id || null; editSec = sec || null;
  const pMap = { tareas: 'tarea', enfoque: 'trabajo', objetivos: 'objetivo', metas: 'meta' };
  const t = type || pMap[cur] || 'tarea';
  const ti = ['tarea','trabajo','objetivo','meta'].indexOf(t);
  $('fN').value = ''; $('fNota').value = ''; $('fCat').value = 'personal';
  $('fPrio').value = 'media'; $('fF').value = today();
  $('fH').value = ''; $('fPR').value = 0; $('fPV').textContent = '0'; $('fRep').value = 'nunca';
  if (id && sec) {
    const it = S[sec].find(x => x.id === id);
    if (it) {
      $('fN').value = it.nombre || ''; $('fNota').value = it.nota || '';
      $('fCat').value = it.cat || 'personal'; $('fPrio').value = it.prio || 'media';
      $('fF').value = it.fecha || today(); $('fH').value = it.hora || '';
      const pv = it.progreso || 0; $('fPR').value = pv; $('fPV').textContent = pv;
      $('fRep').value = it.rep || 'nunca';
    }
  }
  document.querySelectorAll('.tbtn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tbtn')[Math.max(0, ti)].classList.add('active');
  setAT(t, document.querySelectorAll('.tbtn')[Math.max(0, ti)]);
  $('addTitle').textContent = (id ? 'Editar ' : 'Nueva ') + t;
  $('addModal').classList.add('open');
  setTimeout(() => $('fN').focus(), 250);
}

function setAT(t, btn) {
  addType = t;
  document.querySelectorAll('.tbtn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $('fPRG').style.display = t !== 'tarea' ? '' : 'none';
  $('fRG').style.display  = t === 'tarea' ? '' : 'none';
  $('fHG').style.display  = t === 'tarea' ? '' : 'none';
}

function closeAdd() { $('addModal').classList.remove('open'); editId = editSec = null; }

function saveAdd() {
  const nombre = $('fN').value.trim();
  if (!nombre) { SND.alert(); toast('⚠️ El nombre es obligatorio'); return; }
  const sec  = t2s[addType];
  const item = {
    id: editId || uid(), tipo: addType, nombre, nota: $('fNota').value.trim(),
    cat: $('fCat').value, prio: $('fPrio').value, fecha: $('fF').value, hora: $('fH').value,
    done: editId ? (S[sec].find(x => x.id === editId)?.done || false) : false,
    progreso: parseInt($('fPR').value) || 0, rep: $('fRep').value
  };
  if (editId) {
    const i = S[sec].findIndex(x => x.id === editId);
    S[sec][i] = item; SND.pop(); toast('✏️ Actualizado');
  } else {
    S[sec].unshift(item); SND.pop(); toast('🎉 ¡Añadido!');
  }
  save(); closeAdd(); renderAll();
}

// ══════════════════════════════════════════════════════════════
//  DETAIL
// ══════════════════════════════════════════════════════════════
function openDet(sec, id) {
  const it = S[sec].find(x => x.id === id); if (!it) return;
  const late  = !it.done && it.fecha && it.fecha < today();
  const dLeft = dtl(it.fecha);
  const hp    = it.tipo !== 'tarea';
  const pc    = pClr(it.progreso || 0);
  $('detSheet').innerHTML = `
    <div class="shdl"></div>
    <div class="shtitle">${esc(it.nombre)}</div>
    ${it.nota ? `<div style="font-size:.8rem;color:var(--mut);margin-bottom:12px;line-height:1.5">${esc(it.nota)}</div>` : ''}
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px">
      <span class="b bt">${it.cat}</span>
      <span class="b ${it.prio==='alta'?'br':it.prio==='media'?'by':'bg'}">${it.prio}</span>
      ${it.fecha ? `<span class="b ${late?'br':'bp'}">📅 ${fmtD(it.fecha)}</span>` : ''}
      ${it.hora  ? `<span class="b bo">⏰ ${it.hora}</span>` : ''}
      ${it.rep && it.rep !== 'nunca' ? `<span class="b bt">↻ ${it.rep==='diario'?'Diario':'Semanal'}</span>` : ''}
    </div>
    ${hp ? `<div style="margin-bottom:14px"><div class="pl"><span>Progreso</span><span style="color:${pc}">${it.progreso||0}%</span></div><div class="pb" style="height:8px"><div class="pf" style="width:${it.progreso||0}%;background:${pc}"></div></div></div>` : ''}
    ${dLeft !== null ? `<div class="dr"><div class="dk">Tiempo restante</div><div class="dv">${dLeft < 0 ? `<span style="color:var(--red)">⚠️ ${Math.abs(dLeft)}d atrasado</span>` : dLeft===0 ? '<span style="color:var(--org)">¡Vence hoy!</span>' : `${dLeft} días`}</div></div>` : ''}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn-big" style="margin:0" onclick="qToggle('${sec}','${id}')">${it.done ? '↩️ Marcar pendiente' : '✅ Completar'}</button>
    </div>
    ${sec==='tareas'&&it.hora ? `<div class="btn-row"><button class="btn-ol" onclick="snoozeTask('${id}',10);closeDet()">⏰ Posponer 10 min</button></div>` : ''}
    <div class="btn-row">
      <button class="btn-ol" onclick="closeDet();openAdd('${it.tipo}','${id}','${sec}')">✏️ Editar</button>
      <button class="btn-danger" onclick="delItem('${sec}','${id}')">🗑️</button>
    </div>
    <button class="btn-txt" onclick="closeDet()">Cerrar</button>`;
  $('detModal').classList.add('open');
}

function closeDet() { $('detModal').classList.remove('open'); }

function qToggle(sec, id) {
  const it = S[sec].find(x => x.id === id); if (!it) return;
  it.done = !it.done; if (it.done) it.progreso = 100;
  if (it.done) SND.success(); else SND.pop();
  toast(it.done ? '✅ ¡Completado!' : '↩️ Pendiente');
  save(); closeDet(); renderAll();
}

function delItem(sec, id) {
  if (!confirm('¿Eliminar este ítem?')) return;
  S[sec] = S[sec].filter(x => x.id !== id);
  save(); closeDet(); SND.pop(); toast('🗑️ Eliminado'); renderAll();
}

// ══════════════════════════════════════════════════════════════
//  NOTIFICATIONS CENTER
// ══════════════════════════════════════════════════════════════
function openNotifCenter() {
  unread = 0; localStorage.setItem('nread', '0'); updateBell();
  $('detSheet').innerHTML = `
    <div class="shdl"></div>
    <div class="shtitle">🔔 Centro de notificaciones</div>
    <div class="nlog">
      ${nlog.length ? nlog.map(n => `
        <div class="nli">
          <div class="nli-ic">${n.icon}</div>
          <div><div class="nli-t">${esc(n.title)}</div><div class="nli-d">${esc(n.body)} · ${fmtTs(n.ts)}</div></div>
        </div>`).join('') : '<div class="empty">Sin notificaciones recientes</div>'}
    </div>
    ${nlog.length ? `<div class="btn-row" style="margin-top:12px"><button class="btn-ol" onclick="nlog=[];localStorage.setItem('nlog','[]');closeDet();toast('🗑️ Historial limpiado')">Limpiar historial</button></div>` : ''}
    <button class="btn-txt" onclick="closeDet()">Cerrar</button>`;
  $('detModal').classList.add('open');
}

// ══════════════════════════════════════════════════════════════
//  RENDER — DASHBOARD
// ══════════════════════════════════════════════════════════════
function renderDash() {
  const td = today(), all = [...S.tareas, ...S.trabajo, ...S.objetivos, ...S.metas];
  const done = all.filter(x => x.done).length, pend = all.filter(x => !x.done).length;
  const late = all.filter(x => !x.done && x.fecha && x.fecha < td).length;
  const pct  = all.length ? Math.round(done / all.length * 100) : 0;

  $('dashStats').innerHTML = `
    <div class="stat-box"><div class="sv cp">${all.length}</div><div class="sl">Total</div></div>
    <div class="stat-box"><div class="sv cg">${done}</div><div class="sl">Logrados</div></div>
    <div class="stat-box"><div class="sv cy">${pend}</div><div class="sl">Pendientes</div></div>
    <div class="stat-box" onclick="goTo('tareas')" style="cursor:pointer"><div class="sv ${late>0?'cr':'cg'}">${late}</div><div class="sl">Atrasados</div></div>`;
  $('gpctF').style.width = pct + '%'; $('gpctL').textContent = pct + '%';

  const todayT = S.tareas.filter(t => t.fecha === td && !t.done).sort((a,b) => (a.hora||'99').localeCompare(b.hora||'99'));
  $('todayList').innerHTML = todayT.length ? todayT.slice(0, 6).map(t => iCard(t, 'tareas')).join('') : '<div class="empty">¡Sin tareas pendientes hoy! 🎉</div>';

  const alerts = buildAlerts();
  $('alertsList').innerHTML = alerts.length ? alerts.slice(0, 7).map(a => `
    <div class="ai"><div class="adot ${a.c}"></div><div class="ai-txt">${esc(a.txt)}</div><div class="ai-time">${a.t}</div></div>`).join('')
    : '<div class="empty" style="padding:10px 0">Sin alertas activas 👍</div>';

  const secs = [
    { l: '✅ Tareas', d: S.tareas, c: 'var(--acc)' },
    { l: '💼 Trabajos', d: S.trabajo, c: 'var(--acc2)' },
    { l: '🏆 Objetivos', d: S.objetivos, c: 'var(--yel)' },
    { l: '🚀 Metas', d: S.metas, c: 'var(--grn)' },
  ];
  $('progressAll').innerHTML = secs.map(s => {
    const dt = s.d.length || 1, dn = s.d.filter(x => x.done).length, p = Math.round(dn/dt*100);
    return `<div style="margin-bottom:12px"><div class="pl" style="margin-bottom:3px"><span>${s.l}</span><span>${dn}/${s.d.length} · ${p}%</span></div><div class="pb" style="height:7px"><div class="pf" style="width:${p}%;background:${s.c}"></div></div></div>`;
  }).join('');

  const qs = [
    'La disciplina es el puente entre las metas y los logros.',
    'El único modo de hacer gran trabajo es amar lo que haces.',
    'No cuentes los días, haz que los días cuenten.',
    'El éxito es la suma de pequeños esfuerzos repetidos.',
    'Trabaja duro en silencio. Deja que el éxito haga el ruido.',
    'Actúa primero. Mejora después. Pero actúa.',
    'La constancia vence al talento cuando el talento no es constante.',
    'Hoy es el día perfecto para comenzar.'
  ];
  $('qcard').innerHTML = `<div class="qtxt">"${qs[new Date().getDate() % qs.length]}"</div>`;

  if (late > 0) {
    $('alertBanner').innerHTML = `⚠️ ${late} ítem${late>1?'s':''} atrasado${late>1?'s':''} · toca para ver`;
    $('alertBanner').classList.add('show');
  } else $('alertBanner').classList.remove('show');

  updateBell();
}

function buildAlerts() {
  const td = today(), now = new Date(), alerts = [];
  [...S.tareas, ...S.trabajo, ...S.objetivos, ...S.metas].forEach(it => {
    if (it.done || !it.fecha) return;
    const d = dtl(it.fecha);
    if (d < 0)       alerts.push({ txt: `${it.nombre} · ${Math.abs(d)}d atrasado`, c: 'r', t: fmtD(it.fecha) });
    else if (d === 0) alerts.push({ txt: `${it.nombre} · ¡vence hoy!`, c: 'o', t: it.hora || 'Hoy' });
    else if (d <= 3)  alerts.push({ txt: `${it.nombre} · en ${d} día(s)`, c: 'o', t: fmtD(it.fecha) });
  });
  S.tareas.filter(t => t.fecha === td && t.hora && !t.done).forEach(t => {
    const dt = localDateTime(t.fecha, t.hora); if (!dt) return;
    const min = (dt - now) / 60000;
    if (min > 0 && min <= 30) alerts.unshift({ txt: `⏰ ${t.nombre} en ${Math.round(min)} min`, c: 'o', t: t.hora });
  });
  return alerts;
}

// ══════════════════════════════════════════════════════════════
//  RENDER — TAREAS, TRABAJO, OBJETIVOS, METAS
// ══════════════════════════════════════════════════════════════
function renderTareas() {
  const td = today();
  let items = [...S.tareas];
  if (TF === 'hoy')    items = items.filter(t => t.fecha === td);
  else if (TF === 'mañana') items = items.filter(t => t.fecha === tomorrow());
  else if (TF === 'semana') items = items.filter(t => t.fecha >= td && t.fecha <= inDays(7));
  else if (TF === 'done')   items = items.filter(t => t.done);
  if (TF !== 'done') items = items.filter(t => !t.done);
  items.sort((a,b) => a.fecha !== b.fecha ? (a.fecha < b.fecha ? -1 : 1) : (a.hora||'99').localeCompare(b.hora||'99'));
  const late = items.filter(t => t.fecha < td).length;
  $('tareasSummary').textContent = items.length ? `${items.length} tarea${items.length !== 1 ? 's' : ''}${late ? ` · ${late} atrasada${late !== 1 ? 's' : ''}` : ''}` : '';
  $('tareasList').innerHTML = items.length ? items.map(t => iCard(t, 'tareas')).join('') : '<div class="empty">Sin tareas en este período ✨</div>';
}

function renderTrabajo() {
  $('trabajoList').innerHTML = S.trabajo.length
    ? S.trabajo.sort((a,b) => a.done ? 1 : -1).map(it => oCard(it, 'trabajo')).join('')
    : '<div class="empty">Sin trabajos/proyectos</div>';
}

function renderObjetivos() {
  let items = [...S.objetivos];
  if (OF === 'activos')  items = items.filter(x => !x.done);
  if (OF === 'riesgo')   items = items.filter(x => !x.done && (dtl(x.fecha) <= 14 || (x.progreso||0) < 20));
  if (OF === 'logrados') items = items.filter(x => x.done);
  $('objetivosList').innerHTML = items.length ? items.map(it => oCard(it, 'objetivos')).join('') : '<div class="empty">Sin objetivos en esta categoría</div>';
}

function renderMetas() {
  let items = [...S.metas];
  if (MF === 'activas')  items = items.filter(x => !x.done && (x.progreso||0) < 30);
  if (MF === 'progreso') items = items.filter(x => !x.done && (x.progreso||0) >= 30);
  if (MF === 'logradas') items = items.filter(x => x.done);
  $('metasList').innerHTML = items.length ? items.map(it => oCard(it, 'metas')).join('') : '<div class="empty">Sin metas en esta categoría 🌟</div>';
}

// ── CARD TEMPLATES ──────────────────────────────────────────
function iCard(t, sec) {
  const td = today(), now = new Date();
  const late = !t.done && t.fecha && t.fecha < td;
  let soon = false, isNow = false;
  if (t.hora && t.fecha === td && !t.done) {
    const dt = localDateTime(t.fecha, t.hora);
    if (dt) { const min = (dt - now) / 60000; isNow = min >= -2 && min < 2; soon = min > 0 && min <= 30; }
  }
  return `<div class="ic ${t.done?'done':'p-'+t.prio} ${isNow?'now':late?'late':soon?'soon':''}" onclick="openDet('${sec}','${t.id}')">
    <div class="chk ${t.done?'done':''}" onclick="event.stopPropagation();qToggle('${sec}','${t.id}')">${t.done?'✓':''}</div>
    <div class="ibody">
      <div class="iname">${esc(t.nombre)}</div>
      <div class="imeta">
        ${t.hora  ? `<span class="tb">⏰ ${t.hora}</span>` : ''}
        ${t.fecha && t.fecha !== td ? `<span class="b ${late?'br':'bp'}">📅 ${fmtD(t.fecha)}</span>` : ''}
        <span class="b bt">${t.cat}</span>
        ${t.rep && t.rep !== 'nunca' ? `<span class="b bt">${t.rep==='diario'?'↻ Diario':'↻ Semanal'}</span>` : ''}
        ${isNow ? '<span class="b br">🚨 ¡AHORA!</span>' : late ? '<span class="b br">⚠️ Atrasado</span>' : soon ? '<span class="b bo">🔔 Pronto</span>' : ''}
      </div>
    </div>
  </div>`;
}

function oCard(it, sec) {
  const td = today(), late = !it.done && it.fecha && it.fecha < td;
  const dLeft = dtl(it.fecha), pc = pClr(it.progreso || 0);
  const em = { trabajo: '💼', objetivos: '🏆', metas: '🚀' }[sec] || '📌';
  return `<div class="oc ${it.done?'done':''}" onclick="openDet('${sec}','${it.id}')">
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
      <div class="ibody">
        <div class="oc-name">${em} ${esc(it.nombre)}</div>
        <div class="oc-sub">
          <span class="b bt">${it.cat}</span>
          ${it.fecha ? `<span class="b ${late?'br':'bp'}">📅 ${fmtD(it.fecha)}</span>` : ''}
          ${dLeft !== null && !it.done ? `<span class="b ${dLeft<0?'br':dLeft<=7?'bo':dLeft<=30?'by':'bg'}">${dLeft<0?'Atrasado':dLeft===0?'¡Hoy!':dLeft+'d'}</span>` : ''}
        </div>
      </div>
      <div class="chk ${it.done?'done':''}" onclick="event.stopPropagation();qToggle('${sec}','${it.id}')">${it.done?'✓':''}</div>
    </div>
    <div class="pl"><span>${it.progreso||0}%</span><span style="color:${pc}">${(it.progreso||0)>=70?'🔥 En camino':(it.progreso||0)>=30?'📈 Avanzando':'🌱 Iniciando'}</span></div>
    <div class="pb"><div class="pf" style="width:${it.progreso||0}%;background:${pc}"></div></div>
    ${it.nota ? `<div style="font-size:.73rem;color:var(--mut);margin-top:6px">${esc(it.nota)}</div>` : ''}
  </div>`;
}

function renderAll() {
  renderDash(); renderTareas(); renderTrabajo();
  renderObjetivos(); renderMetas(); pomoRefresh();
}

// ══════════════════════════════════════════════════════════════
//  POMODORO
// ══════════════════════════════════════════════════════════════
const CIRC = 2 * Math.PI * 68;
let pomoRun = false, pomoWork = true, pomoSecs = 25*60, pomoCyc = 0, pomoI = null, pomoToday = 0;

function pomoRefresh() {
  const sel = $('pomoSel'), prev = sel.value;
  sel.innerHTML = '<option value="">— Sin tarea activa —</option>';
  S.tareas.filter(t => !t.done).forEach(t => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.nombre; sel.appendChild(o);
  });
  if (prev) sel.value = prev;
}

function pomoToggle() {
  if (pomoRun) { clearInterval(pomoI); pomoRun = false; $('pomoPB').textContent = '▶ Continuar'; }
  else { pomoRun = true; $('pomoPB').textContent = '⏸ Pausar'; pomoI = setInterval(pomoTick, 1000); }
}

function pomoTick() {
  pomoSecs--;
  if (pomoSecs <= 0) {
    clearInterval(pomoI); pomoRun = false; $('pomoPB').textContent = '▶ Iniciar';
    if (pomoWork) {
      pomoCyc++; pomoToday++;
      const sel = $('pomoSel').value;
      if (sel) { const it = S.tareas.find(x => x.id === sel); if (it) { it.progreso = Math.min(100, (it.progreso||0) + 25); save(); } }
      fireNotif('🍅 ¡Pomodoro completado!', 'Toma un descanso de 5 minutos.', '🍅', 'pomodoro', false);
      pomoWork = false; pomoSecs = 5*60;
    } else {
      fireNotif('💪 ¡Descanso terminado!', 'Hora de volver al trabajo.', '💪', 'reminder', false);
      pomoWork = true; pomoSecs = 25*60;
    }
  }
  pomoDisplay();
}

function pomoDisplay() {
  const m = Math.floor(pomoSecs / 60), s = pomoSecs % 60;
  $('pomoT').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  $('pomoL').textContent = pomoWork ? 'TRABAJO' : 'DESCANSO';
  $('pomoCyc').textContent = `Ciclo ${pomoCyc + 1}`;
  $('pomoStat').textContent = `🍅 × ${pomoToday} completados hoy`;
  const off = CIRC * (1 - pomoSecs / (pomoWork ? 25*60 : 5*60));
  $('pomoC').style.strokeDashoffset = off;
  $('pomoC').style.stroke = pomoWork ? 'var(--acc)' : 'var(--acc2)';
}

function pomoReset() { clearInterval(pomoI); pomoRun = false; pomoWork = true; pomoSecs = 25*60; $('pomoPB').textContent = '▶ Iniciar'; pomoDisplay(); }
function pomoSkip()  { clearInterval(pomoI); pomoRun = false; pomoWork = !pomoWork; pomoSecs = pomoWork ? 25*60 : 5*60; $('pomoPB').textContent = '▶ Iniciar'; pomoDisplay(); }

// ══════════════════════════════════════════════════════════════
//  CLOCK & TIME ALERTS
// ══════════════════════════════════════════════════════════════
function updateClock() {
  const n = new Date();
  $('gclock').textContent = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
  const g = n.getHours() < 12 ? 'Buenos días' : n.getHours() < 20 ? 'Buenas tardes' : 'Buenas noches';
  const name = AUTH.isGuest ? 'invitado' : AUTH.username;
  $('gname').textContent = `${g}, ${name} 👋`;
  $('gdate').textContent = n.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -n.getTimezoneOffset() / 60;
  $('gtz').textContent = `${tz} (UTC${off >= 0 ? '+' : ''}${off})`;
}

let lastMin = -1, firedNow = new Set();
function checkTimeAlerts() {
  const now = new Date(), td = today();
  const cm = now.getHours() * 60 + now.getMinutes();
  if (cm !== lastMin) {
    lastMin = cm;
    S.tareas.filter(t => !t.done && t.fecha === td && t.hora).forEach(t => {
      const [h,mi] = t.hora.split(':').map(Number), tm = h * 60 + mi;
      if (tm === cm && !firedNow.has(t.id)) {
        firedNow.add(t.id);
        setTimeout(() => firedNow.delete(t.id), 65000);
        showUrgent(t);
      } else if (tm === cm + 15) { SND.reminder(); toast(`🔔 En 15 min: ${t.nombre}`); }
      else if (tm === cm + 5)   { SND.reminder(); toast(`⚡ En 5 min: ${t.nombre}`); }
    });
    if (cur === 'dash') renderDash();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    scheduleSwNotifs(); pingSwAlive(); checkTimeAlerts();
    if (cur === 'dash') renderDash();
    // Re-sync from cloud if online
    if (AUTH.token && navigator.onLine) CLOUD.loadFromCloud().then(r => {
      if (r?.data) { S = r.data; localStorage.setItem(DATA_KEY, JSON.stringify(S)); renderAll(); }
    });
  }
});

// ══════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════
function openSettings() {
  const all = [...S.tareas, ...S.trabajo, ...S.objetivos, ...S.metas];
  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -new Date().getTimezoneOffset() / 60;
  const syncInfo = CLOUD.lastSync
    ? `✓ ${CLOUD.lastSync.toLocaleTimeString('es-ES')}` : (AUTH.isGuest ? 'Modo local' : 'Pendiente');

  $('detSheet').innerHTML = `
    <div class="shdl"></div>
    <div class="shtitle">⚙️ Ajustes</div>

    ${AUTH.user ? `
    <div class="dr"><div class="dk">👤 Usuario</div><div class="dv">${esc(AUTH.user.username)}</div></div>
    <div class="dr"><div class="dk">📧 Email</div><div class="dv" style="font-size:.78rem">${esc(AUTH.user.email)}</div></div>
    <div class="dr"><div class="dk">☁️ Última sincronización</div><div class="dv" style="font-size:.78rem">${syncInfo}</div></div>
    ` : `<div class="dr"><div class="dk">👤 Modo</div><div class="dv">Invitado (sin cuenta)</div></div>`}

    <div class="trow">
      <div><div class="tlbl">🔊 Sonido de alertas</div><div class="tslb">Beep en notificaciones</div></div>
      <label class="tgl"><input type="checkbox" id="sndT" ${SND.enabled?'checked':''} onchange="toggleSnd(this.checked)"/><span class="tslider"></span></label>
    </div>
    <div class="dr"><div class="dk">Zona horaria</div><div class="dv" style="font-size:.78rem">${tz} (UTC${off>=0?'+':''}${off})</div></div>
    <div class="dr"><div class="dk">Notificaciones</div><div class="dv">${typeof Notification!=='undefined'?Notification.permission:'No soportado'}</div></div>
    <div class="dr"><div class="dk">Total ítems</div><div class="dv">${all.length}</div></div>
    <div class="dr"><div class="dk">Plataforma</div><div class="dv">${isIOS?'iOS':isAnd?'Android':'Web'} ${isStan?'✓ Instalada':'(navegador)'}</div></div>
    <div class="dr"><div class="dk">Versión</div><div class="dv">v6.0 PWA</div></div>

    <div class="btn-row" style="margin-top:14px">
      <button class="btn-ol" onclick="SND.alert();toast('🔊 Alerta')">Test 🚨</button>
      <button class="btn-ol" onclick="SND.success();toast('✅ Éxito')">Test ✅</button>
      <button class="btn-ol" onclick="SND.pomodoro();toast('🍅 Pomo')">Test 🍅</button>
    </div>
    <div class="btn-row">
      <button class="btn-ol" onclick="reqNotif()">🔔 Activar notif.</button>
      <button class="btn-ol" onclick="scheduleSwNotifs();toast('📅 Reprogramadas')">📅 Reprogramar</button>
    </div>
    <div class="btn-row">
      <button class="btn-ol" onclick="exportD()">📤 Exportar JSON</button>
      <button class="btn-ol" onclick="importD()">📥 Importar JSON</button>
    </div>
    ${AUTH.token ? `
    <div class="btn-row">
      <button class="btn-ol" onclick="CLOUD.pushToCloud().then(()=>toast('☁️ Sincronizado'));closeDet()">☁️ Sincronizar ahora</button>
    </div>` : ''}
    <div class="btn-row">
      <button class="btn-danger" onclick="clearDone()">🧹 Limpiar completados</button>
    </div>
    ${AUTH.user ? `
    <div class="btn-row">
      <button class="btn-danger" onclick="confirmLogout()">🚪 Cerrar sesión</button>
    </div>` : `
    <div class="btn-row">
      <button class="btn-ol" onclick="closeDet();$('authOverlay').classList.remove('hidden')">🔐 Crear cuenta / Iniciar sesión</button>
    </div>`}
    <button class="btn-txt" onclick="closeDet()">Cerrar</button>`;
  $('detModal').classList.add('open');
}

function confirmLogout() {
  if (confirm('¿Cerrar sesión? Los datos se mantendrán en la nube.')) {
    closeDet();
    AUTH.logout();
  }
}

function toggleSnd(v) {
  SND.enabled = v;
  localStorage.setItem('snd', v ? 'on' : 'off');
  if (v) { SND.unlock(); SND.pop(); toast('🔊 Sonido activado'); } else toast('🔇 Sonido desactivado');
}

function clearDone() {
  if (!confirm('¿Eliminar todos los ítems completados?')) return;
  ['tareas','trabajo','objetivos','metas'].forEach(k => { S[k] = S[k].filter(x => !x.done); });
  save(); closeDet(); SND.pop(); toast('🧹 Limpieza completada'); renderAll();
}

function exportD() {
  const b = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `mi-sistema-${today()}.json`;
  a.click();
  toast('📤 Datos exportados');
}

function importD() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported.tareas) throw new Error('Formato inválido');
        S = imported;
        save(); renderAll(); closeDet();
        toast('📥 Datos importados y sincronizados');
      } catch { toast('❌ Archivo inválido'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ══════════════════════════════════════════════════════════════
//  ONLINE / OFFLINE
// ══════════════════════════════════════════════════════════════
window.addEventListener('offline', () => { $('offlineBanner').classList.add('show'); });
window.addEventListener('online',  () => {
  $('offlineBanner').classList.remove('show');
  toast('📡 Conexión restaurada');
  scheduleSwNotifs();
  if (AUTH.token) CLOUD.pushToCloud();
});

// ══════════════════════════════════════════════════════════════
//  MODAL EVENTS
// ══════════════════════════════════════════════════════════════
$('addModal').addEventListener('click', e => { if (e.target === $('addModal')) closeAdd(); });
$('detModal').addEventListener('click', e => { if (e.target === $('detModal')) closeDet(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeAdd(); closeDet(); $('urgentOverlay').classList.remove('show'); }
});

['addModal','detModal'].forEach(id => {
  let sy = 0;
  $(id).addEventListener('touchstart', e => { sy = e.touches[0].clientY; }, { passive: true });
  $(id).addEventListener('touchend',   e => {
    if (e.changedTouches[0].clientY - sy > 80) {
      if (id === 'addModal') closeAdd(); else closeDet();
    }
  }, { passive: true });
});

// ══════════════════════════════════════════════════════════════
//  SERVICE WORKER REGISTRATION
// ══════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller)
            toast('🔄 Nueva versión disponible — recarga', 5000);
        });
      });
    }).catch(e => console.warn('[SW]', e));
  });
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
AUTH.init();

async function initApp() {
  // If user has a token, try to load fresh data from cloud
  if (AUTH.token) {
    CLOUD.setSyncStatus('syncing', '↓ Cargando…');
    const r = await CLOUD.loadFromCloud();
    if (r?.data) {
      S = r.data;
      localStorage.setItem(DATA_KEY, JSON.stringify(S));
      CLOUD.setSyncStatus('', '✓ Datos cargados');
      setTimeout(() => CLOUD.setSyncStatus('', ''), 2000);
    } else {
      CLOUD.setSyncStatus('', '');
    }
  }

  updateClock();
  setInterval(updateClock, 1000);
  setInterval(checkTimeAlerts, 4000);
  setInterval(pingSwAlive, 25000);

  checkNotifPerm();
  renderAll();
  pomoDisplay();
  updateBell();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(() => {
      swReady = true;
      scheduleSwNotifs();
    });
  }

  const addParam = new URLSearchParams(window.location.search).get('add');
  if (addParam) setTimeout(() => openAdd(addParam), 600);
}

// Check auth state on load
if (AUTH.loggedIn) {
  showApp();
} else {
  // Show auth overlay
  $('authOverlay').classList.remove('hidden');
  $('app').classList.add('hidden');
}
