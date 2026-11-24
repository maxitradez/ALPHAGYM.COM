(function () {
  const S = Store, $ = s => document.querySelector(s), esc = S.esc;
  let route = 'home', filter = 'all';
  const TABS = [['home', '01', 'Home'], ['checkin', '02', 'Check-in'], ['members', '03', 'Members'], ['payments', '04', 'Payments'], ['reminders', '05', 'Reminders']];

  // ---------- helpers ----------
  const ini = n => n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const badge = s => `<span class="badge b-${s.key}">${s.label}</span>`;
  const sub = s => s.key === 'none' ? 'No membership' : s.left < 0 ? `Expired ${-s.left}d ago` : s.left === 0 ? 'Ends today' : `${s.left}d left`;
  const k = v => v ? (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v) : '';
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
  function modal(h) { $('#modal').innerHTML = `<div class="sheet">${h}</div>`; $('#modal').classList.add('open'); }
  function closeModal() { $('#modal').classList.remove('open'); }
  function bars(arr, fmt) {
    const max = Math.max(1, ...arr.map(a => a.val));
    return `<div class="bars">${arr.map(a => `<div class="bar"><span class="bv">${fmt ? fmt(a.val) : a.val || ''}</span><i style="height:${Math.max(3, a.val / max * 100)}%"></i><em>${S.dow(a.date)}</em></div>`).join('')}</div>`;
  }
  function row(m, right = '') {
    const s = S.status(m);
    return `<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>${esc(sub(s))} · ${esc(m.phone)}</small></div>${right || badge(s)}</div>`;
  }
  function download(name, rows) { S.download(name, S.csv(rows)); }

  // ---------- views ----------
  const V = {}, after = {};
  V.home = () => {
    const t = S.today(), st = S.data.members.map(m => ({ m, s: S.status(m) }));
    const active = st.filter(x => x.s.key === 'active' || x.s.key === 'expiring').length;
    const exp = st.filter(x => x.s.key === 'expiring').sort((a, b) => a.s.left - b.s.left);
    const expired = st.filter(x => x.s.key === 'expired').length;
    return `
    <div class="stats">
      <div class="stat hi"><small>Inside now</small><b>${S.inside().length}</b></div>
      <div class="stat"><small>Check-ins today</small><b>${S.checkinsOn(t).length}</b></div>
      <div class="stat"><small>Active members</small><b>${active}</b></div>
      <div class="stat"><small>Revenue this month</small><b style="font-size:1.25rem;margin-top:8px">${S.money(S.revenueSince(t.slice(0, 7) + '-01'))}</b></div>
      <div class="stat warn"><small>Expiring (≤${S.CONFIG.reminderDays} days)</small><b>${exp.length}</b></div>
      <div class="stat bad"><small>Expired</small><b>${expired}</b></div>
    </div>
    <h3>Revenue · last 7 days</h3><div class="card">${bars(S.lastDays(7, S.revenueOn), k)}</div>
    <h3>Attendance · last 7 days</h3><div class="card">${bars(S.lastDays(7, d => S.checkinsOn(d).length))}</div>
    <h3>Expiring soon <span class="pill">${exp.length}</span></h3>
    ${exp.length ? exp.slice(0, 5).map(x => row(x.m)).join('') : '<div class="empty">Nobody is about to expire</div>'}
    ${exp.length ? `<button class="btn block ghost" onclick="go('reminders')">Send reminders →</button>` : ''}`;
  };

  V.checkin = () => `<h2>Check-in / out</h2>
    <input id="q" placeholder="Search name or phone…" oninput="drawCI()" autocomplete="off">
    <div id="res"></div>
    <h3>Inside now <span class="pill" id="cnt"></span></h3><div id="inside"></div>`;
  after.checkin = () => drawCI();
  function drawCI() {
    const q = ($('#q') || {}).value ? $('#q').value.toLowerCase().trim() : '';
    const list = q ? S.data.members.filter(m => m.name.toLowerCase().includes(q) || m.phone.includes(q)).slice(0, 8) : [];
    $('#res').innerHTML = q ? (list.length ? list.map(m => {
      const inn = S.isInside(m.id);
      return row(m, inn ? `<button class="btn sm red" onclick="event.stopPropagation();doOut('${S.data.checkins.find(c => c.memberId === m.id && !c.out).id}')">Out</button>`
        : `<button class="btn sm" onclick="event.stopPropagation();doIn('${m.id}')">Check in</button>`);
    }).join('') : '<div class="empty">No match. <a style="color:var(--acc)" href="#" onclick="openAdd();return false">Add as new member</a></div>') : '<div class="empty">Type a name or phone number to check someone in.</div>';
    const ins = S.inside();
    $('#cnt').textContent = ins.length;
    $('#inside').innerHTML = ins.length ? ins.map(c => {
      const m = S.member(c.memberId); if (!m) return '';
      const mins = Math.round((Date.now() - new Date(c.in)) / 6e4);
      return `<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>In at ${S.fmtTime(c.in)} · ${mins} min</small></div><button class="btn sm red" onclick="event.stopPropagation();doOut('${c.id}')">Check out</button></div>`;
    }).join('') : '<div class="empty">Gym is empty right now.</div>';
  }
  function doIn(id) {
    const m = S.member(id), s = S.status(m);
    if (S.isInside(id)) { toast('Already inside'); return; }
    if (s.key === 'expired' || s.key === 'none') {
      modal(`<h3>${esc(m.name)}</h3><p class="mut" style="margin:6px 0 14px">${s.key === 'none' ? 'No membership yet.' : 'Membership expired on ' + S.fmtDate(s.end) + '.'}</p>
        <button class="btn block" onclick="openPay('${id}',true)">Renew &amp; check in</button>
        <button class="btn block ghost" onclick="forceIn('${id}')">Let in anyway</button>
        <button class="btn block ghost" onclick="closeModal()">Cancel</button>`); return;
    }
    S.checkIn(id); toast(`${m.name} checked in` + (s.key === 'expiring' ? ` · ${s.left === 0 ? 'ends today' : s.left + 'd left'}` : '')); refresh();
  }
  function forceIn(id) { S.checkIn(id); closeModal(); toast('Checked in (expired)'); refresh(); }
  function doOut(cid) { S.checkOut(cid); toast('Checked out'); refresh(); }

  V.members = () => `<h2>Members <span class="pill">${S.data.members.length}</span></h2>
    <input id="q" placeholder="Search members…" oninput="drawMembers()" autocomplete="off">
    <div class="chips" id="chips"></div><div id="res"></div>
    <button class="fab" onclick="openAdd()">+</button>`;
  after.members = () => drawMembers();
  function drawMembers() {
    const q = ($('#q') || {}).value ? $('#q').value.toLowerCase().trim() : '';
    const all = S.data.members.map(m => ({ m, s: S.status(m) }));
    const cnt = key => all.filter(x => key === 'all' || x.s.key === key).length;
    $('#chips').innerHTML = [['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['none', 'No plan']].map(([key, l]) => `<button class="chip ${filter === key ? 'on' : ''}" onclick="setFilter('${key}')">${l} ${cnt(key)}</button>`).join('');
    const list = all.filter(x => (filter === 'all' || x.s.key === filter) && (!q || x.m.name.toLowerCase().includes(q) || x.m.phone.includes(q)))
      .sort((a, b) => (a.s.left == null ? 1e9 : a.s.left) - (b.s.left == null ? 1e9 : b.s.left));
    $('#res').innerHTML = list.length ? list.map(x => row(x.m)).join('') : '<div class="empty">No members found.</div>';
  }
  function setFilter(f) { filter = f; drawMembers(); }

  V.payments = () => {
    const t = S.today(), p = [...S.data.payments].sort((a, b) => b.paid.localeCompare(a.paid) || b.end.localeCompare(a.end));
    const week = S.revenueSince(S.addDays(t, -6)), month = S.revenueSince(t.slice(0, 7) + '-01');
    let last = '';
    return `<h2>Payments</h2>
    <div class="sum"><div><b>${S.money(S.revenueOn(t))}</b><small>Today</small></div><div><b>${S.money(week)}</b><small>7 days</small></div><div><b>${S.money(month)}</b><small>This month</small></div></div>
    <button class="btn block ghost" style="margin:0 0 6px" onclick="exportPay()">Export payments (CSV)</button>
    ${p.slice(0, 60).map(x => {
      const m = S.member(x.memberId); if (!m) return '';
      const head = x.paid !== last ? `<h3 style="font-size:.85rem;color:var(--mut)">${S.fmtDate(x.paid)}${x.paid === t ? ' · Today' : ''}</h3>` : ''; last = x.paid;
      return head + `<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>${esc(S.plan(x.planId).name)} · ${x.method}${x.code ? ' · ' + esc(x.code) : ''}<br>Valid ${S.fmtDate(x.start)} → ${S.fmtDate(x.end)}</small></div><div class="right"><b>${S.money(x.amount)}</b></div></div>`;
    }).join('')}`;
  };
  function exportPay() { download('payments.csv', [['Date', 'Member', 'Phone', 'Plan', 'Amount', 'Method', 'Code', 'Valid from', 'Valid to'], ...S.data.payments.map(p => { const m = S.member(p.memberId) || {}; return [p.paid, m.name, m.phone, S.plan(p.planId).name, p.amount, p.method, p.code, p.start, p.end]; })]); }

  V.reminders = () => {
    const list = S.data.members.map(m => ({ m, s: S.status(m) })).filter(x => x.s.key === 'expiring' || (x.s.key === 'expired' && x.s.left >= -14)).sort((a, b) => a.s.left - b.s.left);
    return `<h2>Reminders</h2>
    <div class="autocard">Review memberships that are approaching expiry or have expired. Contact members using the available contact details.</div>
    ${list.length ? list.map(({ m, s }) => {
      const done = S.remindedToday(m.id);
      return `<div class="row"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>${esc(sub(s))} · ${badge(s)} ${done ? '· sent today' : ''}</small></div>
      <a class="btn wa sm" target="_blank" rel="noopener" href="${S.waLink(m.phone, S.reminderMsg(m))}" onclick="logRem('${m.id}','whatsapp')">WhatsApp</a></div>`;
    }).join('') : '<div class="empty">No reminders are currently required.</div>'}`;
  };
  function logRem(id, ch) { S.logReminder(id, ch); setTimeout(() => route === 'reminders' && render(), 400); }
  function queueAll() {
    const list = S.data.members.filter(m => { const s = S.status(m); return s.key === 'expiring' || (s.key === 'expired' && s.left >= -14); });
    list.forEach(m => S.logReminder(m.id, 'email'));
    toast(`${list.length} reminder emails queued`); render();
  }

  // ---------- modals ----------
  function openMember(id) {
    const m = S.member(id), s = S.status(m), inn = S.isInside(id), pays = S.memberPayments(id), vis = S.memberVisits(id);
    const open = S.data.checkins.find(c => c.memberId === id && !c.out);
    modal(`<div style="display:flex;gap:12px;align-items:center"><div class="av" style="width:54px;height:54px">${ini(m.name)}</div><div class="grow"><h3 style="margin:0">${esc(m.name)}</h3><small>${esc(m.phone)}${m.email ? ' · ' + esc(m.email) : ''}</small></div>${badge(s)}</div>
      <div class="prev" style="margin-top:14px">${s.key === 'none' ? 'No membership yet.' : `Valid until <b>${S.fmtDate(s.end)}</b> · ${esc(sub(s))}`}<br><small>Member since ${S.fmtDate(m.joined)} · ${vis.length} visits logged</small></div>
      <div class="acts">
        <button class="btn" onclick="openPay('${id}')">Add payment</button>
        ${inn ? `<button class="btn red" onclick="doOut('${open.id}');closeModal()">Check out</button>` : `<button class="btn ghost" onclick="closeModal();doIn('${id}')">Check in</button>`}
        <a class="btn wa" target="_blank" rel="noopener" href="${S.waLink(m.phone, S.reminderMsg(m))}">WhatsApp</a>
        ${m.email ? `<a class="btn ghost" href="${S.mailLink(m)}">Email</a>` : `<button class="btn ghost" onclick="toast('No email on file')">Email</button>`}
      </div>
      <h3>Payment history</h3>${pays.length ? pays.slice(0, 5).map(p => `<div class="row"><div class="grow"><b>${S.money(p.amount)} · ${esc(S.plan(p.planId).name)}</b><small>${S.fmtDate(p.paid)} · ${p.method}${p.code ? ' ' + esc(p.code) : ''} · until ${S.fmtDate(p.end)}</small></div></div>`).join('') : '<div class="empty">No payments yet.</div>'}
      <h3>Recent visits</h3>${vis.length ? vis.slice(0, 5).map(c => `<div class="row"><div class="grow"><b>${S.fmtDate(S.ymd(c.in))}</b><small>${S.fmtTime(c.in)} → ${c.out ? S.fmtTime(c.out) : 'inside'}</small></div></div>`).join('') : '<div class="empty">No visits yet.</div>'}
      <button class="btn block ghost" style="color:var(--red)" onclick="delMember('${id}')">Delete member</button>`);
  }
  function delMember(id) { if (confirm('Delete this member and all their records?')) { S.deleteMember(id); closeModal(); toast('Member deleted'); refresh(); } }

  function openAdd() {
    modal(`<h3>New member</h3>
      <label>Full name</label><input id="n" placeholder="e.g. John Mwangi" autocomplete="off">
      <label>Phone</label><input id="p" type="tel" placeholder="07xx xxx xxx">
      <label>Email (optional, for reminders)</label><input id="e" type="email" placeholder="name@email.com">
      <label>First plan</label><select id="pl"><option value="">— No plan yet —</option>${S.data.plans.map(p => `<option value="${p.id}" ${p.id === 'monthly' ? 'selected' : ''}>${esc(p.name)} · ${S.money(p.price)}</option>`).join('')}</select>
      <label>Paid by</label><select id="me" onchange="$('#cw').style.display=this.value==='M-Pesa'?'block':'none'"><option>M-Pesa</option><option>Cash</option></select>
      <div id="cw"><label>M-Pesa code</label><input id="c" placeholder="e.g. SHK3L9XQ2P" style="text-transform:uppercase"></div>
      <button class="btn block" onclick="saveMember()">Save member</button>`);
  }
  function saveMember() {
    const n = $('#n').value.trim(), p = $('#p').value.trim();
    if (!n || p.replace(/\D/g, '').length < 9) { toast('Enter a name and valid phone'); return; }
    const m = S.addMember({ name: n, phone: p, email: $('#e').value });
    const plan = $('#pl').value; if (plan) S.addPayment(m.id, plan, $('#me').value, $('#c').value);
    closeModal(); toast('Member added'); refresh();
  }

  function openPay(id, thenIn) {
    const m = S.member(id), last = S.memberPayments(id)[0];
    modal(`<h3>Payment · ${esc(m.name)}</h3>
      <label>Plan</label><select id="pl" onchange="updPrev('${id}')">${S.data.plans.map(p => `<option value="${p.id}" ${(last ? last.planId : 'monthly') === p.id ? 'selected' : ''}>${esc(p.name)} · ${S.money(p.price)}</option>`).join('')}</select>
      <div class="prev" id="prev"></div>
      <label>Paid by</label><select id="me" onchange="$('#cw').style.display=this.value==='M-Pesa'?'block':'none'"><option>M-Pesa</option><option>Cash</option></select>
      <div id="cw"><label>M-Pesa code</label><input id="c" placeholder="e.g. SHK3L9XQ2P" style="text-transform:uppercase"></div>
      <button class="btn block" onclick="savePay('${id}',${!!thenIn})">Record payment</button>`);
    updPrev(id);
  }
  function updPrev(id) {
    const x = S.previewPeriod(id, $('#pl').value);
    $('#prev').innerHTML = `Amount <b>${S.money(x.plan.price)}</b><br>Membership <b>${S.fmtDate(x.start)}</b> → <b>${S.fmtDate(x.end)}</b>`;
  }
  function savePay(id, thenIn) {
    const p = S.addPayment(id, $('#pl').value, $('#me').value, $('#c').value), m = S.member(id);
    if (thenIn) S.checkIn(id);
    const msg = `Hi ${m.name.split(' ')[0]}, we received ${S.money(p.amount)} at ${S.CONFIG.gym}. Your membership is valid until ${S.fmtDate(p.end)}. Thank you.`;
    modal(`<div style="text-align:center;padding:10px 0"><h3>Payment recorded</h3><p class="mut" style="margin:6px 0 16px">${S.money(p.amount)} · valid until <b style="color:var(--txt)">${S.fmtDate(p.end)}</b></p></div>
      <a class="btn wa block" target="_blank" rel="noopener" href="${S.waLink(m.phone, msg)}">Send receipt on WhatsApp</a>
      <button class="btn block ghost" onclick="closeModal()">Done</button>`);
    refresh();
  }

  function openSettings() {
    modal(`<h3>Settings</h3>
      <button class="btn block ghost" onclick="exportMembers()">Export members (CSV)</button>
      <button class="btn block ghost" onclick="exportPay()">Export payments (CSV)</button>
      <button class="btn block ghost" onclick="sessionStorage.removeItem('adm');location.reload()">Lock app</button>
`);
  }
  function exportMembers() { download('members.csv', [['Name', 'Phone', 'Email', 'Joined', 'Status', 'Valid until'], ...S.data.members.map(m => { const s = S.status(m); return [m.name, m.phone, m.email, m.joined, s.label, s.end || '']; })]); }

  // ---------- shell ----------
  function refresh() { if (route === 'checkin') drawCI(); else if (route === 'members') drawMembers(); else render(); }
  function render() {
    $('#view').innerHTML = V[route](); if (after[route]) after[route]();
    $('#tabs').innerHTML = TABS.map(([r, i, l]) => `<button class="${r === route ? 'on' : ''}" onclick="go('${r}')"><i>${i}</i>${l}</button>`).join('');
  }
  function go(r) { route = r; location.hash = r; render(); scrollTo(0, 0); }
  function boot() {
    $('#gate').innerHTML = '';
    $('#brand').innerHTML = esc(S.CONFIG.gym).replace(/^(\S+)/, '<span>$1</span>');
    $('#date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const h = location.hash.slice(1); if (V[h]) route = h;
    render();
  }
  function unlock() {
    if ($('#pin').value === S.CONFIG.pin) { sessionStorage.setItem('adm', '1'); boot(); } else { $('#perr').textContent = 'Wrong PIN'; }
  }
  function gate() {
    if (sessionStorage.getItem('adm') === '1') return boot();
    $('#gate').innerHTML = `<div class="gatebox"><h1>${esc(S.CONFIG.gym.split(' ')[0])}<span>.</span></h1><p class="mut" style="margin-bottom:18px">Owner access</p>
      <input id="pin" type="password" inputmode="numeric" placeholder="Enter PIN" style="text-align:center;font-size:1.3rem" onkeydown="if(event.key==='Enter')unlock()">
      <div class="err" id="perr"></div><button class="btn block" onclick="unlock()">Unlock</button>
      <p class="mut" style="margin-top:14px;font-size:.8rem"></p></div>`;
  }

  Object.assign(window, { $, toast, closeModal, drawCI, drawMembers, doIn, doOut, forceIn, setFilter, openMember, delMember, openAdd, saveMember, openPay, updPrev, savePay, openSettings, exportMembers, exportPay, logRem, queueAll, go, unlock, render });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
  gate();
})();
