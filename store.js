/* Alpha Gym application data layer. */
(function () {
  const KEY = 'alpha_gym_local_v1', SESSION = 'alpha_gym_session', DAY = 864e5;

  // ---- EDIT THESE PER CLIENT ----
  const CONFIG = {
    gym: 'Alpha Gym',
    tag: 'Train hard. Recover harder.',
    phone: '',                  // Set the gym's verified WhatsApp number
    display: '',
    till: '',                   // Set the gym's verified M-Pesa till or paybill
    area: '',                    // Set the gym's verified location
    pin: '1234',                // Temporary local access PIN; replace with Supabase Auth
    reminderDays: 3             // "expiring" window
  };

  const ymd = d => { d = d instanceof Date ? d : new Date(d); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const diff = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DAY);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const money = n => 'KES ' + Number(n).toLocaleString('en-KE');
  const fmtDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dow = s => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(s + 'T12:00:00').getDay()];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normPhone = p => { p = String(p).replace(/[^\d]/g, ''); if (p.startsWith('0')) p = '254' + p.slice(1); if (p.startsWith('7') || p.startsWith('1')) p = '254' + p; return p; };
  
  function seed() {
    return { v: 1, plans: [], members: [], payments: [], checkins: [], accounts: [], reminders: [] };
  }

  function load() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.v === 1) return d; } catch (e) { }
    const d = seed(); save(d); return d;
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d || data)); } catch (e) { } }
  let data = load();

  const S = {
    CONFIG, get data() { return data; }, save,
    today, addDays, diff, ymd, money, fmtDate, fmtTime, dow, esc, normPhone,
    member: id => data.members.find(m => m.id === id),
    plan: id => data.plans.find(p => p.id === id),
    memberPayments: id => data.payments.filter(p => p.memberId === id).sort((a, b) => b.paid.localeCompare(a.paid) || b.end.localeCompare(a.end)),
    memberVisits: id => data.checkins.filter(c => c.memberId === id).sort((a, b) => b.in.localeCompare(a.in)),
    endDate(id) { const p = data.payments.filter(x => x.memberId === id); return p.length ? p.map(x => x.end).sort().pop() : null; },
    status(m) {
      const end = S.endDate(m.id);
      if (!end) return { key: 'none', label: 'No plan', left: null, end: null };
      const left = S.diff(today(), end);
      const key = left < 0 ? 'expired' : left <= CONFIG.reminderDays ? 'expiring' : 'active';
      return { key, label: { expired: 'Expired', expiring: 'Expiring', active: 'Active' }[key], left, end };
    },
    addMember({ name, phone, email }) {
      const m = { id: 'm' + uid(), name: name.trim(), phone: normPhone(phone), email: (email || '').trim(), joined: today(), prefs: { email: true, whatsapp: true } };
      data.members.push(m); save(); return m;
    },
    deleteMember(id) {
      data.members = data.members.filter(m => m.id !== id);
      data.payments = data.payments.filter(p => p.memberId !== id);
      data.checkins = data.checkins.filter(c => c.memberId !== id);
      data.accounts = data.accounts.filter(a => a.memberId !== id); save();
    },
    previewPeriod(id, planId) {
      const plan = S.plan(planId), e = S.endDate(id);
      const start = e && e >= today() ? addDays(e, 1) : today();
      return { plan, start, end: addDays(start, plan.days - 1) };
    },
    addPayment(id, planId, method, code) {
      const { plan, start, end } = S.previewPeriod(id, planId);
      const p = { id: uid(), memberId: id, planId, amount: plan.price, method, code: (code || '').trim().toUpperCase(), paid: today(), start, end };
      data.payments.push(p); save(); return p;
    },
    isInside: id => data.checkins.some(c => c.memberId === id && !c.out),
    inside: () => data.checkins.filter(c => !c.out).sort((a, b) => b.in.localeCompare(a.in)),
    checkIn(id) { if (S.isInside(id)) return; data.checkins.push({ id: uid(), memberId: id, in: new Date().toISOString(), out: null }); save(); },
    checkOut(cid) { const c = data.checkins.find(x => x.id === cid); if (c) { c.out = new Date().toISOString(); save(); } },
    checkinsOn: d => data.checkins.filter(c => ymd(c.in) === d),
    revenueOn: d => data.payments.filter(p => p.paid === d).reduce((a, p) => a + p.amount, 0),
    revenueSince: d => data.payments.filter(p => p.paid >= d).reduce((a, p) => a + p.amount, 0),
    lastDays(n, fn) { const t = today(); return Array.from({ length: n }, (_, i) => { const date = addDays(t, i - n + 1); return { date, val: fn(date) }; }); },
    reminderMsg(m) {
      const s = S.status(m), first = m.name.split(' ')[0];
      if (s.key === 'none') return `Hi ${first}, welcome to ${CONFIG.gym}! Pick a plan at the front desk or pay via M-Pesa Till ${CONFIG.till}.`;
      const when = s.left < 0 ? `expired on ${S.fmtDate(s.end)}` : s.left === 0 ? 'ends today' : `ends on ${S.fmtDate(s.end)} (${s.left} day${s.left > 1 ? 's' : ''} left)`;
      return `Hi ${first}, this is ${CONFIG.gym}. Your membership ${when}. Renew via M-Pesa Till ${CONFIG.till} or at the front desk. See you soon!`;
    },
    waLink: (phone, msg) => `https://wa.me/${normPhone(phone)}?text=${encodeURIComponent(msg)}`,
    mailLink: (m) => `mailto:${m.email}?subject=${encodeURIComponent(CONFIG.gym + ' membership reminder')}&body=${encodeURIComponent(S.reminderMsg(m))}`,
    logReminder(id, channel) { data.reminders.push({ memberId: id, date: today(), channel }); save(); },
    remindedToday: id => data.reminders.some(r => r.memberId === id && r.date === today()),
    // member accounts
    signup({ name, phone, email, pass }) {
      email = email.trim().toLowerCase();
      if (data.accounts.some(a => a.email === email)) return { err: 'An account with this email already exists. Please log in.' };
      if (pass.length < 6) return { err: 'Password must be at least 6 characters.' };
      let m = data.members.find(x => (x.email || '').toLowerCase() === email || x.phone === normPhone(phone));
      if (m) m.email = email; else m = S.addMember({ name, phone, email });
      data.accounts.push({ email, pass, memberId: m.id }); save();
      localStorage.setItem(SESSION, m.id); return { ok: true };
    },
    login(email, pass) {
      const a = data.accounts.find(x => x.email === email.trim().toLowerCase() && x.pass === pass);
      if (!a) return { err: 'Wrong email or password.' };
      localStorage.setItem(SESSION, a.memberId); return { ok: true };
    },
    session: () => localStorage.getItem(SESSION),
    logout: () => localStorage.removeItem(SESSION),
    reset() { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); data = load(); },
    csv(rows) { return rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n'); },
    download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); }
  };
  window.Store = S;
})();
