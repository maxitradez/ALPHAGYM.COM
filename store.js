/* Alpha Gym application data layer.
   Swap this file for a Supabase-backed version when the client signs. */
(function () {
  const KEY = 'alpha_gym_local_v1', SESSION = 'alpha_gym_session', DAY = 864e5;

  // ---- EDIT THESE PER CLIENT ----
  const CONFIG = {
    gym: 'Alpha Gym',
    tag: 'Train hard. Recover harder.',
    phone: '254700000000',      // WhatsApp format, no +
    display: '0700 000 000',
    till: '123456',             // M-Pesa till / paybill shown to members
    area: 'Nairobi, Kenya',
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
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  function seed() {
    const r = rng(11), t = today();
    const plans = [
      { id: 'daily', name: 'Day Pass', price: 300, days: 1 },
      { id: 'weekly', name: 'Weekly', price: 1000, days: 7 },
      { id: 'monthly', name: 'Monthly', price: 3000, days: 30 },
      { id: 'quarterly', name: '3 Months', price: 8000, days: 90 }
    ];
    const names = ['Brian Otieno', 'Faith Wanjiku', 'Kevin Mutua', 'Mercy Achieng', 'Dennis Kiprop', 'Grace Njeri', 'Samuel Omondi', 'Lucy Wambui',
      'Peter Kamau', 'Joy Chebet', 'Allan Mwangi', 'Esther Atieno', 'Victor Kiptoo', 'Ann Muthoni', 'Collins Odhiambo', 'Sharon Naliaka',
      'James Karanja', 'Diana Akinyi', 'Moses Barasa', 'Cynthia Wairimu', 'Eric Ndungu', 'Nancy Jeptoo', 'Hassan Abdi', 'Rose Mbithe'];
    const left = [25, 18, 12, 9, 5, 3, 2, 1, 0, -2, -5, -9, -20, 22, 15, 28, 7, 4, -1, 30, 11, 2, 60, -14];
    const members = [], payments = [], checkins = [];
    const code = () => 'S' + Array.from({ length: 9 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(r() * 34)]).join('');
    const pay = (memberId, plan, start, end, method) => payments.push({ id: uid(), memberId, planId: plan.id, amount: plan.price, method, code: method === 'M-Pesa' ? code() : '', paid: start, start, end });
    names.forEach((n, i) => {
      const id = 'm' + (i + 1);
      members.push({
        id, name: n, phone: '2547' + String(10000000 + Math.floor(r() * 89999999)),
        email: i === 0 ? 'demo@member.com' : n.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com',
        joined: addDays(t, -Math.floor(60 + r() * 300)), prefs: { email: true, whatsapp: true }
      });
      const plan = left[i] > 30 ? plans[3] : (left[i] <= 7 && i % 3 === 0 ? plans[1] : plans[2]);
      const end = addDays(t, left[i]), start = addDays(end, -plan.days + 1);
      const method = r() < .7 ? 'M-Pesa' : 'Cash';
      pay(id, plan, start, end, method);
      if (r() < .85) { const pe = addDays(start, -1); pay(id, plan, addDays(pe, -plan.days + 1), pe, r() < .7 ? 'M-Pesa' : 'Cash'); }
    });
    // walk-in day/week passes so the revenue chart looks alive (never change a member's expiry)
    for (let d = 13; d >= 0; d--) {
      const date = addDays(t, -d);
      for (let n = 0, c = 1 + Math.floor(r() * 4); n < c; n++) {
        const m = members[Math.floor(r() * members.length)], end = payments.filter(p => p.memberId === m.id).map(p => p.end).sort().pop();
        if (end && end >= date) pay(m.id, r() < .75 ? plans[0] : plans[1], date, date, r() < .6 ? 'M-Pesa' : 'Cash');
      }
    }
    for (let d = 13; d >= 1; d--) {
      const date = addDays(t, -d);
      members.forEach(m => {
        if (r() < .32) {
          const h = String(6 + Math.floor(r() * 14)).padStart(2, '0'), mi = String(Math.floor(r() * 60)).padStart(2, '0');
          const inn = new Date(`${date}T${h}:${mi}:00`);
          checkins.push({ id: uid(), memberId: m.id, in: inn.toISOString(), out: new Date(+inn + (45 + Math.floor(r() * 60)) * 6e4).toISOString() });
        }
      });
    }
    const now = Date.now();
    [1, 3, 5, 7, 9].forEach((k, j) => checkins.push({ id: uid(), memberId: 'm' + k, in: new Date(now - (10 + j * 17) * 6e4).toISOString(), out: null }));
    [2, 4, 6].forEach((k, j) => checkins.push({ id: uid(), memberId: 'm' + k, in: new Date(now - (170 + j * 20) * 6e4).toISOString(), out: new Date(now - (90 + j * 10) * 6e4).toISOString() }));
    return { v: 1, plans, members, payments, checkins, accounts: [{ email: 'demo@member.com', pass: 'demo123', memberId: 'm1' }], reminders: [] };
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
