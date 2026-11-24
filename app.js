(function () {
  const S = Store, $ = s => document.querySelector(s), esc = S.esc;
  let route = 'home', filter = 'all', currentUser = null, currentRole = null;
  const db = window.alphaSupabase;

  async function loadPlansFromDatabase() {
    const { data, error } = await db.from('membership_plans')
      .select('id,name,description,duration_days,price,currency,max_visits,includes_group_classes,is_public,is_active,sort_order')
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    if (error) throw error;
    S.data.plans = (data || []).map(p => ({
      id: p.id, name: p.name, description: p.description || '', days: p.duration_days,
      price: Number(p.price), currency: p.currency, maxVisits: p.max_visits,
      includesGroupClasses: p.includes_group_classes, isPublic: p.is_public,
      isActive: p.is_active, sortOrder: p.sort_order
    }));
  }

  async function loadMembershipsFromDatabase() {
    const { data, error } = await db.from('member_memberships').select('id,gym_member_id,plan_id,status,start_date,end_date,price_at_purchase,discount_amount,currency,notes,created_at').not('gym_member_id', 'is', null).order('start_date', { ascending: false });
    if (error) throw error;
    S.data.memberships = data || [];
  }
  async function loadPaymentsFromDatabase() {
    const { data, error } = await db.from('payments')
      .select('id,gym_member_id,membership_id,amount,method,reference,received_at,notes,payment_voids(id,reason,voided_at)')
      .not('gym_member_id', 'is', null).order('received_at', { ascending: false });
    if (error) throw error;
    S.data.payments = (data || []).map(p => {
      const membership = (S.data.memberships || []).find(ms => ms.id === p.membership_id);
      const voidRecord = Array.isArray(p.payment_voids) ? p.payment_voids[0] : p.payment_voids;
      return {
        id:p.id, memberId:p.gym_member_id, membershipId:p.membership_id,
        planId:membership?.plan_id || null, amount:Number(p.amount),
        method:p.method, code:p.reference || '', paid:p.received_at.slice(0,10),
        receivedAt:p.received_at, start:membership?.start_date || null,
        end:membership?.end_date || null, notes:p.notes || '',
        isVoided:!!voidRecord, voidReason:voidRecord?.reason || '', voidedAt:voidRecord?.voided_at || null
      };
    });
  }

  async function loadMembersFromDatabase() {
    const { data, error } = await db.from('gym_members')
      .select('id,member_number,full_name,phone,email,joined_on,record_status,created_at')
      .eq('record_status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw error;
    S.data.members = (data || []).map(m => ({
      id: m.id, memberNumber: m.member_number, name: m.full_name,
      phone: m.phone, email: m.email || '', joined: m.joined_on,
      recordStatus: m.record_status
    }));
  }

  function databaseError(error) {
    console.error('Alpha Gym database error:', error);
    toast(error && error.message ? error.message : 'Database request failed');
  }
  const TABS = [['home', '01', 'Home'], ['checkin', '02', 'Check-in'], ['members', '03', 'Members'], ['plans', '04', 'Plans'], ['payments', '05', 'Payments'], ['reminders', '06', 'Reminders']];

  // ---------- helpers ----------
  const ini = n => n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const badge = s => `<span class="badge b-${s.key}">${s.label}</span>`;
  const sub = s => s.key === 'none' ? 'No membership' : s.left < 0 ? `Expired ${-s.left}d ago` : s.left === 0 ? 'Ends today' : `${s.left}d left`;
  function memberMemberships(id) { return (S.data.memberships || []).filter(x => x.gym_member_id === id).sort((a,b) => b.start_date.localeCompare(a.start_date)); }
  function membershipPaid(id) { return S.data.payments.filter(p => p.membershipId === id && !p.isVoided).reduce((n,p) => n + Number(p.amount || 0), 0); }
  function membershipBalance(ms) { return Math.max(0, Number(ms.price_at_purchase) - Number(ms.discount_amount || 0) - membershipPaid(ms.id)); }
  function memberStatus(m) {
    const list = memberMemberships(m.id);
    const current = list.find(x => x.status === 'active' && x.end_date >= S.today()) || list[0];
    if (!current) return {key:'none',label:'No plan',left:null,end:null};
    if (current.status === 'frozen') return {key:'frozen',label:'Frozen',left:null,end:current.end_date};
    if (current.status === 'pending') return {key:'pending',label:'Pending',left:null,end:current.end_date};
    if (current.status === 'cancelled') return {key:'expired',label:'Cancelled',left:-1,end:current.end_date};
    const left=S.diff(S.today(),current.end_date);
    return {key:left<0?'expired':left<=S.CONFIG.reminderDays?'expiring':'active',label:left<0?'Expired':left===0?'Expiring':'Active',left,end:current.end_date};
  }
  const k = v => v ? (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v) : '';
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
  function modal(h) { $('#modal').innerHTML = `<div class="sheet">${h}</div>`; $('#modal').classList.add('open'); }
  function closeModal() { $('#modal').classList.remove('open'); }
  function bars(arr, fmt) {
    const max = Math.max(1, ...arr.map(a => a.val));
    return `<div class="bars">${arr.map(a => `<div class="bar"><span class="bv">${fmt ? fmt(a.val) : a.val || ''}</span><i style="height:${Math.max(3, a.val / max * 100)}%"></i><em>${S.dow(a.date)}</em></div>`).join('')}</div>`;
  }
  function row(m, right = '') {
    const s = memberStatus(m);
    return `<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>${esc(sub(s))} · ${esc(m.phone)}</small></div>${right || badge(s)}</div>`;
  }
  function download(name, rows) { S.download(name, S.csv(rows)); }

  // ---------- views ----------
  const V = {}, after = {};
  V.home = () => {
    const t = S.today(), st = S.data.members.map(m => ({ m, s: memberStatus(m) }));
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
    const m = S.member(id), s = memberStatus(m);
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
    const all = S.data.members.map(m => ({ m, s: memberStatus(m) }));
    const cnt = key => all.filter(x => key === 'all' || x.s.key === key).length;
    $('#chips').innerHTML = [['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['none', 'No plan']].map(([key, l]) => `<button class="chip ${filter === key ? 'on' : ''}" onclick="setFilter('${key}')">${l} ${cnt(key)}</button>`).join('');
    const list = all.filter(x => (filter === 'all' || x.s.key === filter) && (!q || x.m.name.toLowerCase().includes(q) || x.m.phone.includes(q)))
      .sort((a, b) => (a.s.left == null ? 1e9 : a.s.left) - (b.s.left == null ? 1e9 : b.s.left));
    $('#res').innerHTML = list.length ? list.map(x => row(x.m)).join('') : '<div class="empty">No members found.</div>';
  }
  function setFilter(f) { filter = f; drawMembers(); }

  V.plans = () => `<h2>Membership plans <span class="pill">${S.data.plans.length}</span></h2>
    <p class="mut">Configure the packages Alpha Gym offers. Prices and durations are controlled by management.</p>
    <div id="plans-list"></div>
    ${['owner','manager'].includes(currentRole) ? '<button class="fab" onclick="openPlanForm()">+</button>' : ''}`;
  after.plans = () => drawPlans();
  function drawPlans() {
    const host = $('#plans-list'); if (!host) return;
    const plans = S.data.plans;
    host.innerHTML = plans.length ? plans.map(p => `<div class="card" style="margin:10px 0;padding:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div class="grow"><b>${esc(p.name)}</b><small>${p.days} days · ${p.maxVisits ? p.maxVisits + ' visits' : 'Unlimited visits'} · ${p.includesGroupClasses ? 'Group classes included' : 'Group classes not included'}</small></div>
        <b>${S.money(p.price)}</b>
      </div>
      ${p.description ? `<p class="mut" style="margin:10px 0">${esc(p.description)}</p>` : ''}
      <div class="acts"><span class="badge ${p.isActive ? 'b-active' : 'b-expired'}">${p.isActive ? 'Active' : 'Inactive'}</span><span class="mut">${p.isPublic ? 'Shown publicly' : 'Staff only'}</span>
      ${['owner','manager'].includes(currentRole) ? `<button class="btn sm" onclick="openPlanForm('${p.id}')">Edit</button><button class="btn sm ghost" onclick="togglePlan('${p.id}')">${p.isActive ? 'Deactivate' : 'Activate'}</button>` : ''}</div>
    </div>`).join('') : '<div class="empty">No membership plans yet. Add the gym\'s real packages when their details are confirmed.</div>';
  }

  function openPlanForm(id) {
    if (!['owner','manager'].includes(currentRole)) { toast('Only the owner or manager can manage plans'); return; }
    const p = id ? S.plan(id) : null;
    modal(`<h3>${p ? 'Edit' : 'Add'} membership plan</h3>
      <label>Plan name</label><input id="plan-name" maxlength="100" value="${esc(p?.name || '')}" placeholder="e.g. Monthly membership">
      <label>Description (optional)</label><textarea id="plan-desc" rows="2" placeholder="What's included?">${esc(p?.description || '')}</textarea>
      <label>Duration (days)</label><input id="plan-days" type="number" min="1" step="1" value="${p?.days || ''}" placeholder="e.g. 30">
      <label>Price (KES)</label><input id="plan-price" type="number" min="0" step="0.01" value="${p ? p.price : ''}" placeholder="Enter confirmed price">
      <label>Visit limit (optional)</label><input id="plan-visits" type="number" min="1" step="1" value="${p?.maxVisits || ''}" placeholder="Leave blank for unlimited">
      <label style="display:flex;gap:8px;align-items:center;margin:12px 0"><input id="plan-classes" type="checkbox" ${p?.includesGroupClasses !== false ? 'checked' : ''}> Group classes included</label>
      <label style="display:flex;gap:8px;align-items:center;margin:12px 0"><input id="plan-public" type="checkbox" ${p?.isPublic !== false ? 'checked' : ''}> Show on public website</label>
      <button class="btn block" onclick="savePlan('${p?.id || ''}')">Save plan</button>
      <button class="btn block ghost" onclick="closeModal()">Cancel</button>`);
  }
  async function savePlan(id) {
    const name=$('#plan-name').value.trim(), days=Number($('#plan-days').value), price=Number($('#plan-price').value);
    const visitsRaw=$('#plan-visits').value.trim(), visits=visitsRaw ? Number(visitsRaw) : null;
    if (!name || !Number.isInteger(days) || days < 1 || !Number.isFinite(price) || price < 0 || (visits !== null && (!Number.isInteger(visits) || visits < 1))) {
      toast('Enter a name, valid duration, price and visit limit'); return;
    }
    const payload={name,description:$('#plan-desc').value.trim() || null,duration_days:days,price,currency:'KES',max_visits:visits,includes_group_classes:$('#plan-classes').checked,is_public:$('#plan-public').checked,updated_by:currentUser.id};
    let result;
    if (id) result=await db.from('membership_plans').update(payload).eq('id',id);
    else result=await db.from('membership_plans').insert({...payload,created_by:currentUser.id});
    if (result.error) { databaseError(result.error); return; }
    try { await loadPlansFromDatabase(); } catch(error) { databaseError(error); return; }
    closeModal(); toast(id ? 'Plan updated' : 'Plan created'); render();
  }
  async function togglePlan(id) {
    if (!['owner','manager'].includes(currentRole)) return;
    const p=S.plan(id); if (!p) return;
    const {error}=await db.from('membership_plans').update({is_active:!p.isActive,updated_by:currentUser.id}).eq('id',id);
    if (error) { databaseError(error); return; }
    await loadPlansFromDatabase(); render(); toast(p.isActive ? 'Plan deactivated' : 'Plan activated');
  }

  V.payments = () => {
    const t=S.today(), p=[...S.data.payments].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
    const week=S.revenueSince(S.addDays(t,-6)), month=S.revenueSince(t.slice(0,7)+'-01');
    let last='';
    return `<h2>Payments</h2>
      <div class="sum"><div><b>${S.money(S.revenueOn(t))}</b><small>Today</small></div><div><b>${S.money(week)}</b><small>7 days</small></div><div><b>${S.money(month)}</b><small>This month</small></div></div>
      <button class="btn block ghost" style="margin:0 0 6px" onclick="exportPay()">Export payments (CSV)</button>
      ${p.length ? p.slice(0,100).map(x=>{
        const m=S.member(x.memberId); if(!m)return '';
        const plan=S.plan(x.planId), head=x.paid!==last ? `<h3 style="font-size:.85rem;color:var(--mut)">${S.fmtDate(x.paid)}${x.paid===t?' · Today':''}</h3>` : ''; last=x.paid;
        return head+`<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)} ${x.isVoided?'<span class="badge b-expired">Reversed</span>':''}</b><small>${esc(plan?.name || 'Membership payment')} · ${esc(x.method.toUpperCase())}${x.code?' · '+esc(x.code):''}</small></div><div class="right"><b>${S.money(x.amount)}</b></div></div>`;
      }).join('') : '<div class="empty">No payments recorded yet.</div>'}`;
  };
  function exportMembers() {
    const rows = [['Name', 'Phone', 'Email', 'Joined', 'Membership status', 'Membership expiry', 'Visits']];
    S.data.members.forEach(m => {
      const status = memberStatus(m);
      rows.push([m.name, m.phone, m.email, m.joined, status.label, status.end || '', S.memberVisits(m.id).length]);
    });
    download('members.csv', rows);
  }

  function exportPay() { download('payments.csv', [['Date','Member','Phone','Plan','Amount','Method','Reference','Notes'], ...S.data.payments.map(p=>{const m=S.member(p.memberId)||{};return [p.paid,m.name,m.phone,S.plan(p.planId)?.name||'',p.amount,p.method,p.code,p.notes];})]); }

  V.reminders = () => {
    const list = S.data.members.map(m => ({ m, s: memberStatus(m) })).filter(x => x.s.key === 'expiring' || (x.s.key === 'expired' && x.s.left >= -14)).sort((a, b) => a.s.left - b.s.left);
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
    const list = S.data.members.filter(m => { const s = memberStatus(m); return s.key === 'expiring' || (s.key === 'expired' && s.left >= -14); });
    list.forEach(m => S.logReminder(m.id, 'email'));
    toast(`${list.length} reminder emails queued`); render();
  }

  // ---------- modals ----------
  function openMember(id) {
    const m=S.member(id), s=memberStatus(m), inn=S.isInside(id);
    const pays=S.data.payments.filter(p=>p.memberId===id).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
    const vis=S.memberVisits(id), memberships=memberMemberships(id);
    const open=S.data.checkins.find(c=>c.memberId===id&&!c.out);
    const membershipHtml=memberships.length ? memberships.map(ms=>{
      const plan=S.plan(ms.plan_id), due=membershipBalance(ms);
      return `<div class="card" style="margin:8px 0;padding:12px">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(plan?.name||'Membership')}</b><span class="badge b-${ms.status}">${esc(ms.status)}</span></div>
        <small>${S.fmtDate(ms.start_date)} → ${S.fmtDate(ms.end_date)} · Total ${S.money(Number(ms.price_at_purchase)-Number(ms.discount_amount||0))}</small>
        <p style="margin:8px 0 0">Paid: <b>${S.money(Number(ms.price_at_purchase)-Number(ms.discount_amount||0)-due)}</b> · Balance: <b>${S.money(due)}</b></p>
        ${due>0 && ms.status!=='cancelled' ? `<button class="btn sm" style="margin-top:8px" onclick="openPay('${id}','${ms.id}')">Record payment</button>` : '<small class="mut">No outstanding balance</small>'}
      </div>`;
    }).join('') : '<div class="empty">No membership assigned yet.</div>';
    modal(`<div style="display:flex;gap:12px;align-items:center"><div class="av" style="width:54px;height:54px">${ini(m.name)}</div><div class="grow"><h3 style="margin:0">${esc(m.name)}</h3><small>${esc(m.phone)}${m.email?' · '+esc(m.email):''}</small></div>${badge(s)}</div>
      <div class="prev" style="margin-top:14px">${s.key==='none'?'No membership yet.':`Valid until <b>${S.fmtDate(s.end)}</b> · ${esc(sub(s))}`}<br><small>Member since ${S.fmtDate(m.joined)} · ${vis.length} visits logged</small></div>
      <div class="acts"><button class="btn" onclick="editMember('${id}')">Edit member</button><button class="btn" onclick="openAssign('${id}')">Assign plan</button>
      ${inn?`<button class="btn red" onclick="doOut('${open.id}');closeModal()">Check out</button>`:`<button class="btn ghost" onclick="closeModal();doIn('${id}')">Check in</button>`}
      <a class="btn wa" target="_blank" rel="noopener" href="${S.waLink(m.phone,S.reminderMsg(m))}">WhatsApp</a>
      ${m.email?`<a class="btn ghost" href="${S.mailLink(m)}">Email</a>`:`<button class="btn ghost" onclick="toast('No email on file')">Email</button>`}</div>
      <h3>Memberships & balances</h3>${membershipHtml}
      <h3>Payment history</h3>${pays.length?pays.slice(0,10).map(p=>'<div class="row"><div class="grow"><b>'+S.money(p.amount)+' · '+esc(S.plan(p.planId)?.name||'Membership')+(p.isVoided?' <span class="badge b-expired">Reversed</span>':'')+'</b><small>'+S.fmtDate(p.paid)+' · '+esc(p.method.toUpperCase())+(p.code?' · '+esc(p.code):'')+(p.notes?' · '+esc(p.notes):'')+(p.isVoided?' · Reason: '+esc(p.voidReason):'')+'</small></div>'+(!p.isVoided&&['owner','manager'].includes(currentRole)?'<button class="btn sm red" onclick="openVoidPayment(\''+p.id+'\',\''+id+'\')">Reverse</button>':'')+'</div>').join(''):'<div class="empty">No payments recorded.</div>'}
      <h3>Recent visits</h3>${vis.length?vis.slice(0,5).map(v=>`<div class="row"><div class="grow"><b>${S.fmtDate(S.ymd(v.in))}</b><small>${S.fmtTime(v.in)} → ${v.out?S.fmtTime(v.out):'inside'}</small></div></div>`).join(''):'<div class="empty">No visits yet.</div>'}
      <button class="btn block ghost" style="color:var(--red)" onclick="delMember('${id}')">Archive member</button>`);
  }
  async function delMember(id) {
    if (!confirm('Archive this member? Their history will be retained.')) return;
    const { error } = await db.from('gym_members')
      .update({ record_status: 'archived', updated_by: currentUser.id })
      .eq('id', id);
    if (error) { databaseError(error); return; }
    await loadMembersFromDatabase();
    closeModal(); toast('Member archived'); refresh();
  }

  function editMember(id) {
    const m = S.member(id);
    if (!m) return;
    modal(`<h3>Edit member</h3>
      <label>Full name</label><input id="edit-n" value="${esc(m.name)}" autocomplete="off">
      <label>Phone</label><input id="edit-p" type="tel" value="${esc(m.phone)}">
      <label>Email (optional)</label><input id="edit-e" type="email" value="${esc(m.email || '')}">
      <button class="btn block" onclick="saveEditMember('${id}')">Save changes</button>
      <button class="btn block ghost" onclick="openMember('${id}')">Cancel</button>`);
  }

  async function saveEditMember(id) {
    const name = $('#edit-n').value.trim(), phone = $('#edit-p').value.trim();
    const email = $('#edit-e').value.trim();
    if (!name || phone.replace(/\D/g, '').length < 9) { toast('Enter a name and valid phone'); return; }
    const { error } = await db.from('gym_members').update({
      full_name: name, phone: S.normPhone(phone), email: email || null,
      updated_by: currentUser.id
    }).eq('id', id);
    if (error) { databaseError(error); return; }
    await loadMembersFromDatabase();
    closeModal(); toast('Member updated'); refresh();
  }

  function openAdd() {
    modal(`<h3>New member</h3>
      <label>Full name</label><input id="n" placeholder="e.g. John Mwangi" autocomplete="off">
      <label>Phone</label><input id="p" type="tel" placeholder="07xx xxx xxx">
      <label>Email (optional)</label><input id="e" type="email" placeholder="name@email.com">
      <p class="mut" style="font-size:.8rem;margin:12px 0">A member can be registered without an email or portal account. Membership and payment details will be added in their own connected module.</p>
      <button class="btn block" onclick="saveMember()">Save member</button>`);
  }
  async function saveMember() {
    const n = $('#n').value.trim(), p = $('#p').value.trim();
    if (!n || p.replace(/\D/g, '').length < 9) { toast('Enter a name and valid phone'); return; }
    const email = $('#e').value.trim();
    const { data, error } = await db.from('gym_members').insert({
      full_name: n, phone: S.normPhone(p), email: email || null,
      created_by: currentUser.id, updated_by: currentUser.id
    }).select('id,member_number,full_name,phone,email,joined_on,record_status,created_at').single();
    if (error) { databaseError(error); return; }
    S.data.members.unshift({
      id: data.id, memberNumber: data.member_number, name: data.full_name,
      phone: data.phone, email: data.email || '', joined: data.joined_on,
      recordStatus: data.record_status
    });
    closeModal(); toast('Member saved to Alpha Gym database'); refresh();
  }

  function openAssign(id) {
    const m=S.member(id), plans=(S.data.plans||[]).filter(p=>p.isActive);
    if(!m)return; if(!plans.length){toast('Create an active membership plan first');return;}
    modal('<h3>Assign membership · '+esc(m.name)+'</h3><label>Membership plan</label><select id="assign-plan">'+plans.map(p=>'<option value="'+p.id+'">'+esc(p.name)+' · '+S.money(p.price)+' · '+p.days+' days</option>').join('')+'</select><label>Start date</label><input id="assign-start" type="date" value="'+S.today()+'"><label>Discount (KES)</label><input id="assign-discount" type="number" min="0" step="0.01" value="0"><label>Notes (optional)</label><textarea id="assign-notes" rows="2"></textarea><div class="prev" id="assign-preview"></div><button class="btn block" onclick="saveAssignment(\''+id+'\')">Assign membership</button><button class="btn block ghost" onclick="closeModal()">Cancel</button>');
    $('#assign-plan').onchange=updateAssignPreview; $('#assign-start').onchange=updateAssignPreview; $('#assign-discount').oninput=updateAssignPreview; updateAssignPreview();
  }
  function updateAssignPreview() {
    const p=S.plan($('#assign-plan').value), start=$('#assign-start').value, discount=Number($('#assign-discount').value||0);
    if(!p||!start)return; const end=S.addDays(start,p.days-1), net=Number(p.price)-discount;
    $('#assign-preview').innerHTML='Price <b>'+S.money(p.price)+'</b> · Discount <b>'+S.money(discount)+'</b><br>Membership <b>'+S.fmtDate(start)+'</b> → <b>'+S.fmtDate(end)+'</b><br>Net price <b>'+S.money(net)+'</b>';
  }
  async function saveAssignment(id) {
    const p=S.plan($('#assign-plan').value), start=$('#assign-start').value, discount=Number($('#assign-discount').value||0);
    if(!p||!start||!Number.isFinite(discount)||discount<0||discount>p.price){toast('Check the plan, start date and discount');return;}
    const {error}=await db.from('member_memberships').insert({gym_member_id:id,plan_id:p.id,status:'active',start_date:start,end_date:S.addDays(start,p.days-1),price_at_purchase:p.price,discount_amount:discount,currency:'KES',notes:$('#assign-notes').value.trim()||null,created_by:currentUser.id,updated_by:currentUser.id});
    if(error){databaseError(error);return;} try{await loadMembershipsFromDatabase();}catch(e){databaseError(e);return;}
    closeModal();toast('Membership assigned');openMember(id);refresh();
  }
  function openPay(id,membershipId) {
    const m=S.member(id), ms=memberMemberships(id).find(x=>x.id===membershipId);
    if(!m||!ms){toast('Membership record not found');return;}
    const due=membershipBalance(ms); if(due<=0){toast('This membership is fully paid');return;}
    const plan=S.plan(ms.plan_id);
    modal(`<h3>Record payment · ${esc(m.name)}</h3>
      <div class="prev"><b>${esc(plan?.name||'Membership')}</b><br>Total outstanding: <b>${S.money(due)}</b><br><small>${S.fmtDate(ms.start_date)} → ${S.fmtDate(ms.end_date)}</small></div>
      <label>Amount received (KES)</label><input id="payment-amount" type="number" min="0.01" max="${due.toFixed(2)}" step="0.01" value="${due.toFixed(2)}">
      <label>Payment method</label><select id="payment-method"><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="other">Other</option></select>
      <label>Transaction reference (optional)</label><input id="payment-reference" maxlength="120" placeholder="M-Pesa code / bank reference">
      <label>Notes (optional)</label><textarea id="payment-notes" rows="2"></textarea>
      <p class="mut" style="font-size:.82rem">Partial payments are supported. Any remaining balance stays outstanding.</p>
      <button class="btn block" onclick="savePay('${id}','${membershipId}')">Save payment</button><button class="btn block ghost" onclick="closeModal()">Cancel</button>`);
  }
  async function savePay(id,membershipId) {
    const ms=memberMemberships(id).find(x=>x.id===membershipId);
    const amount=Number($('#payment-amount').value), method=$('#payment-method').value;
    const reference=$('#payment-reference').value.trim(), notes=$('#payment-notes').value.trim();
    if(!ms||!Number.isFinite(amount)||amount<=0||amount>membershipBalance(ms)+0.00001){toast('Enter an amount greater than zero and no more than the outstanding balance');return;}
    const {error}=await db.from('payments').insert({gym_member_id:id,membership_id:membershipId,amount,currency:'KES',method,reference:reference||null,notes:notes||null});
    if(error){databaseError(error);return;}
    try{await loadPaymentsFromDatabase();}catch(e){databaseError(e);return;}
    const remaining=membershipBalance(ms); closeModal();
    toast(remaining<=0?'Membership fully paid':'Payment saved · balance '+S.money(remaining));
    openMember(id); refresh();
  }

  function openVoidPayment(paymentId,memberId) {
    if(!['owner','manager'].includes(currentRole)){toast('Only the owner or manager can reverse payments');return;}
    const payment=S.data.payments.find(p=>p.id===paymentId);
    if(!payment||payment.isVoided){toast('Payment is unavailable or already reversed');return;}
    modal('<h3>Reverse payment</h3><div class="prev"><b>'+S.money(payment.amount)+'</b><br>'+esc(payment.method.toUpperCase())+' · '+S.fmtDate(payment.paid)+'<br><small>The payment will no longer count toward balances or revenue. Its original record will be retained.</small></div><label>Reason for reversal (required)</label><textarea id="void-reason" rows="3" maxlength="500" placeholder="Explain why this payment is being reversed"></textarea><button class="btn block red" onclick="saveVoidPayment(\''+paymentId+'\',\''+memberId+'\')">Confirm reversal</button><button class="btn block ghost" onclick="openMember(\''+memberId+'\')">Cancel</button>');
  }
  async function saveVoidPayment(paymentId,memberId) {
    if(!['owner','manager'].includes(currentRole)){toast('Only the owner or manager can reverse payments');return;}
    const reason=$('#void-reason').value.trim();
    if(reason.length<5){toast('Enter a clear reason (at least 5 characters)');return;}
    const payment=S.data.payments.find(p=>p.id===paymentId);
    if(!payment||payment.isVoided){toast('Payment is unavailable or already reversed');return;}
    const {error}=await db.from('payment_voids').insert({payment_id:paymentId,reason,voided_by:currentUser.id});
    if(error){databaseError(error);return;}
    try{await loadPaymentsFromDatabase();}catch(e){databaseError(e);return;}
    closeModal();toast('Payment reversed; balance and revenue updated');
    openMember(memberId);refresh();
  }

  function openSettings() {
    modal(`<h3>Settings</h3>
      <button class="btn block ghost" onclick="exportMembers()">Export members (CSV)</button>
      <button class="btn block ghost" onclick="exportPay()">Export payments (CSV)</button>
      <button class="btn block ghost" onclick="lockApp()">Lock app / Sign out</button>
`);
  }
  async function lockApp() {
    await window.alphaSupabase.auth.signOut();
    sessionStorage.removeItem('adm');
    location.reload();
  }
  // ---------- shell ----------
  function refresh() { if (route === 'checkin') drawCI(); else if (route === 'members') drawMembers(); else render(); }
  function render() {
    $('#view').innerHTML = V[route](); if (after[route]) after[route]();
    $('#tabs').innerHTML = TABS.map(([r, i, l]) => `<button class="${r === route ? 'on' : ''}" onclick="go('${r}')"><i>${i}</i>${l}</button>`).join('');
  }
  function go(r) { route = r; location.hash = r; render(); scrollTo(0, 0); }
  async function boot() {
    $('#gate').innerHTML = '';
    $('#view').innerHTML = '<div class="empty">Loading Alpha Gym records…</div>';
    try { await Promise.all([loadMembersFromDatabase(), loadPlansFromDatabase(), loadMembershipsFromDatabase()]); }
    catch (error) {
      databaseError(error);
      $('#view').innerHTML = '<div class="empty">Could not load core Alpha Gym records. Check your connection and reload.</div>';
      return;
    }
    // Payments are secondary data: a payment-query issue must never prevent the management shell from opening.
    try { await loadPaymentsFromDatabase(); }
    catch (error) { console.error('Alpha Gym payments could not be loaded:', error); S.data.payments = []; }
    $('#brand').innerHTML = esc(S.CONFIG.gym).replace(/^(\S+)/, '<span>$1</span>');
    $('#date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const h = location.hash.slice(1); if (V[h]) route = h;
    render();
  }
  function showGate(message = '') {
    $('#gate').innerHTML = `<div class="gatebox"><h1>Alpha<span>.</span></h1>
      <p class="mut" style="margin-bottom:18px">Management sign in</p>
      <label>Email</label><input id="owner-email" type="email" autocomplete="username" placeholder="name@example.com">
      <label>Password</label><input id="owner-password" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')unlock()">
      <div class="err" id="perr">${esc(message)}</div>
      <button class="btn block" id="login-btn" onclick="unlock()">Sign in</button>
      <button class="btn block ghost" style="margin-top:8px" onclick="forgotPassword()">Forgot password?</button>
      <p class="mut" style="margin-top:14px;font-size:.8rem">Use an account authorised by Alpha Gym.</p></div>`;
  }
  async function unlock() {
    const email = ($('#owner-email') || {}).value?.trim() || '';
    const password = ($('#owner-password') || {}).value || '';
    const err = $('#perr'), btn = $('#login-btn');
    if (!email || !password) { err.textContent = 'Enter your email and password.'; return; }
    btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
    const { data, error } = await window.alphaSupabase.auth.signInWithPassword({ email, password });
    if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = 'Sign in'; return; }
    const { data: profile, error: profileError } = await window.alphaSupabase
      .from('profiles').select('role').eq('id', data.user.id).single();
    if (profileError || !profile || !['owner','manager','receptionist','trainer'].includes(profile.role)) {
      await window.alphaSupabase.auth.signOut();
      showGate('This account does not have management access. Contact the gym owner.');
      return;
    }
    currentUser = data.user; currentRole = profile.role;
    sessionStorage.setItem('adm', '1');
    await boot();
  }
  async function forgotPassword() {
    const email = ($('#owner-email') || {}).value?.trim() || '';
    const err = $('#perr'), btn = $('#login-btn');
    if (!email) { err.textContent = 'Enter your account email first.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…'; err.textContent = '';
    const redirectTo = new URL('reset-password.html', location.href).href;
    const { error } = await window.alphaSupabase.auth.resetPasswordForEmail(email, { redirectTo });
    btn.disabled = false; btn.textContent = 'Sign in';
    err.textContent = error ? error.message : 'If an account exists for that email, a password reset link has been sent. Check the inbox.';
  }
  async function gate() {
    const { data: { session } } = await window.alphaSupabase.auth.getSession();
    if (session) {
      const { data: profile, error } = await window.alphaSupabase.from('profiles').select('role').eq('id', session.user.id).single();
      if (!error && profile && ['owner','manager','receptionist','trainer'].includes(profile.role)) {
        currentUser = session.user; currentRole = profile.role;
        sessionStorage.setItem('adm','1'); await boot(); return;
      }
      await window.alphaSupabase.auth.signOut();
    }
    showGate();
  }

  Object.assign(window, { $, toast, closeModal, drawCI, drawMembers, drawPlans, openPlanForm, savePlan, togglePlan, openAssign, saveAssignment, doIn, doOut, forceIn, setFilter, openMember, delMember, editMember, saveEditMember, openAdd, saveMember, openPay, savePay, openVoidPayment, saveVoidPayment, openSettings, exportMembers, exportPay, logRem, queueAll, go, unlock, forgotPassword, lockApp, render });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
  gate().catch(error => {
    console.error('Alpha Gym authentication startup failed:', error);
    showGate('We could not verify your session. Check your connection and sign in again.');
  });
})();
