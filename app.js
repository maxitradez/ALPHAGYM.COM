(function () {
  const S = Store, $ = s => document.querySelector(s), esc = S.esc;
  let route = 'home', filter = 'all', currentUser = null, currentProfile = null, currentRole = null;
  let reportFrom = S.today().slice(0, 7) + '-01', reportTo = S.today();
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

  async function loadAttendanceFromDatabase() {
    const { data, error } = await db.from('attendance_sessions')
      .select('id,gym_member_id,checked_in_at,checked_out_at,check_in_method,check_in_by,check_out_by,notes')
      .not('gym_member_id', 'is', null)
      .order('checked_in_at', { ascending: false });
    if (error) throw error;
    S.data.checkins = (data || []).map(c => ({
      id: c.id, memberId: c.gym_member_id,
      in: c.checked_in_at, out: c.checked_out_at || null,
      method: c.check_in_method, checkInBy: c.check_in_by, checkOutBy: c.check_out_by, notes: c.notes || ''
    }));
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
  const TABS = [['home', '01', 'Home'], ['checkin', '02', 'Check-in'], ['members', '03', 'Members'], ['plans', '04', 'Plans'], ['payments', '05', 'Payments'], ['reports', '06', 'Reports'], ['reminders', '07', 'Reminders'], ['staff', '08', 'Staff'], ['profile', '09', 'Profile']];

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
    return {key:left<0?'expired':left<=S.CONFIG.reminderDays?'expiring':'active',label:left<0?'Expired':left<=S.CONFIG.reminderDays?'Expiring':'Active',left,end:current.end_date};
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
    if (currentRole === 'trainer') return `<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>${esc(m.phone || 'No phone recorded')}</small></div><span class="badge b-none">Member</span></div>`;
    const s = memberStatus(m);
    return `<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>${esc(sub(s))} · ${esc(m.phone)}</small></div>${right || badge(s)}</div>`;
  }
  function download(name, rows) { S.download(name, S.csv(rows)); }

  // ---------- views ----------
  const V = {}, after = {};
  V.home = () => {
    if (currentRole === 'trainer') return `<div class="dash-head"><div><h2>Trainer dashboard</h2><p>Member directory and training workspace.</p></div><span class="dash-live"><i></i> Live records</span></div><div class="stats"><div class="stat hi"><small>Active member records</small><b>${S.data.members.length}</b><em>Available to view</em></div></div><h3>Member access</h3><p class="mut">You can view member contact details. Financial information, payments, membership pricing and staff controls are not available to trainer accounts.</p><button class="btn block" onclick="go('members')">Open member directory →</button>`;
    const t = S.today(), monthStart = t.slice(0, 7) + '-01';
    const st = S.data.members.map(m => ({ m, s: memberStatus(m) }));
    const active = st.filter(x => x.s.key === 'active').length;
    const exp = st.filter(x => x.s.key === 'expiring').sort((a, b) => a.s.left - b.s.left);
    const expired = st.filter(x => x.s.key === 'expired').length;
    const monthNew = S.data.members.filter(m => m.joined >= monthStart).length;
    const monthRevenue = S.revenueSince(monthStart);
    const todayRevenue = S.revenueOn(t);
    const outstanding = (S.data.memberships || [])
      .filter(ms => ms.status !== 'cancelled')
      .reduce((total, ms) => total + membershipBalance(ms), 0);
    const todayVisits = S.data.checkins.filter(c => S.ymd(c.in) === t);
    const recent = todayVisits.slice(0, 5);
    const finance = ['owner','manager'].includes(currentRole)
      ? `<h3 class="dash-label">Financial overview</h3>
        <div class="stats">
          <div class="stat"><small>Collected today</small><b class="stat-money">${S.money(todayRevenue)}</b></div>
          <div class="stat"><small>Collected this month</small><b class="stat-money">${S.money(monthRevenue)}</b></div>
          <div class="stat warn"><small>Outstanding balances</small><b class="stat-money">${S.money(outstanding)}</b></div>
        </div>
        <h3>Revenue · last 7 days</h3><div class="card">${bars(S.lastDays(7, S.revenueOn), k)}</div>`
      : `<h3 class="dash-label">Today's Revenue</h3>
        <div class="stats"><div class="stat"><small>Collected today</small><b class="stat-money">${S.money(todayRevenue)}</b><em>Payments recorded today</em></div></div>`;
    return `
    <div class="dash-head">
      <div><h2>Dashboard</h2><p>Alpha Gym at a glance</p></div>
      <span class="dash-live"><i></i> Live records</span>
    </div>
    <div class="dash-actions">
      <button class="btn" onclick="go('checkin')">＋ Check in member</button>
      <button class="btn ghost" onclick="go('members')">＋ Add / view members</button>
    </div>
    <h3 class="dash-label">Membership overview</h3>
    <div class="stats">
      <div class="stat hi"><small>Total members</small><b>${S.data.members.length}</b><em>+${monthNew} this month</em></div>
      <div class="stat"><small>Active memberships</small><b>${active}</b></div>
      <div class="stat warn"><small>Expiring soon</small><b>${exp.length}</b></div>
      <div class="stat bad"><small>Expired memberships</small><b>${expired}</b></div>
    </div>
    <h3 class="dash-label">Today's activity</h3>
    <div class="stats">
      <div class="stat"><small>Inside now</small><b>${S.inside().length}</b></div>
      <div class="stat"><small>Check-ins today</small><b>${todayVisits.length}</b></div>
    </div>
    ${finance}
    <h3>Attendance · last 7 days</h3><div class="card">${bars(S.lastDays(7, d => S.checkinsOn(d).length))}</div>
    <h3>Today's check-ins <span class="pill">${todayVisits.length}</span></h3>
    ${recent.length ? recent.map(c => {
      const m = S.member(c.memberId); if (!m) return '';
      return `<div class="row"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>${S.fmtTime(c.in)} · ${c.out ? 'Checked out' : 'Currently inside'}</small></div><span class="badge ${c.out ? 'b-none' : 'b-active'}">${c.out ? 'Out' : 'Inside'}</span></div>`;
    }).join('') : '<div class="empty">No check-ins recorded today.</div>'}
    <h3>Expiring soon <span class="pill">${exp.length}</span></h3>
    ${exp.length ? exp.slice(0, 5).map(x => row(x.m)).join('') : '<div class="empty">Nobody is about to expire.</div>'}
    ${exp.length ? `<button class="btn block ghost" onclick="go('reminders')">Review membership reminders →</button>` : ''}`;
  };
  V.profile = () => {
    const p = currentProfile || {};
    const name = p.full_name || 'Name not set';
    const email = p.email || currentUser?.email || 'Not available';
    const phone = p.phone || 'Not provided';
    const role = currentRole ? currentRole.charAt(0).toUpperCase() + currentRole.slice(1) : 'Staff';
    const active = !!p.is_active;
    const canManage = ['owner','manager'].includes(currentRole);
    return `<div class="dash-head"><div><h2>My Profile</h2><p>Your Alpha Gym account details</p></div><span class="badge ${active ? 'b-active' : 'b-expired'}">${active ? 'Active account' : 'Inactive account'}</span></div>
      <div class="card profile-card">
        <div class="profile-identity"><div class="av">${ini(name)}</div><div class="grow"><b>${esc(name)}</b><small>${esc(email)}</small></div></div>
        <div class="profile-details">
          <div><small>Full name</small><b>${esc(name)}</b></div>
          <div><small>Email address</small><b>${esc(email)}</b></div>
          <div><small>Phone number</small><b>${esc(phone)}</b></div>
          <div><small>Assigned role</small><b>${esc(role)}</b></div>
          <div><small>Account status</small><b>${active ? 'Active' : 'Inactive'}</b></div>
        </div>
        <button class="btn block" style="margin-top:16px" onclick="openProfileEdit()">Edit profile</button>
      </div>
      <p class="mut" style="font-size:.8rem;margin-top:12px">${canManage ? 'You can update your full name and phone number. Login email and assigned access are managed separately.' : 'You can update your full name only. Contact the owner or manager to change other account details.'}</p>`;
  };
  function openProfileEdit() {
    const p = currentProfile || {};
    const canManage = ['owner','manager'].includes(currentRole);
    modal(`<h3>Edit profile</h3>
      <label>Full name</label><input id="profile-name" maxlength="120" value="${esc(p.full_name || '')}" placeholder="Enter your full name">
      ${canManage ? `<label>Phone number</label><input id="profile-phone" maxlength="40" value="${esc(p.phone || '')}" placeholder="Enter phone number">` : ''}
      <p class="mut" style="font-size:.82rem;margin:10px 0">Email, role and account status cannot be changed here.</p>
      <button class="btn block" onclick="saveProfile()">Save changes</button>
      <button class="btn block ghost" onclick="closeModal()">Cancel</button>`);
  }
  async function saveProfile() {
    const fullName = ($('#profile-name') || {}).value?.trim() || '';
    if (fullName.length < 2) { toast('Enter your full name'); return; }
    const updates = { full_name: fullName };
    if (['owner','manager'].includes(currentRole)) updates.phone = ($('#profile-phone') || {}).value?.trim() || null;
    const { data, error } = await db.from('profiles').update(updates).eq('id', currentUser.id)
      .select('full_name,email,phone,role,is_active').single();
    if (error) { databaseError(error); return; }
    currentProfile = data;
    closeModal();
    toast('Profile updated');
    render();
  }

  V.checkin = () => currentRole === 'trainer' ? '<h2>Access restricted</h2><div class="empty">Check-in tools are not available to trainer accounts.</div>' : `<h2>Check-in / out</h2>
    <input id="q" placeholder="Search name or phone…" oninput="drawCI()" autocomplete="off">
    <div id="res"></div>
    <h3>Inside now <span class="pill" id="cnt"></span></h3><div id="inside"></div>`;
  after.checkin = () => drawCI();
  function drawCI() {
    const q = ($('#q') || {}).value ? $('#q').value.toLowerCase().trim() : '';
    const list = q ? S.data.members.filter(m => m.name.toLowerCase().includes(q) || m.phone.includes(q)).slice(0, 8) : [];
    $('#res').innerHTML = q ? (list.length ? list.map(m => {
      const inn = S.isInside(m.id), status = memberStatus(m);
      const visits = S.memberVisits(m.id), lastVisit = visits[0];
      const lastVisitText = lastVisit ? S.fmtDate(S.ymd(lastVisit.in)) + ' · ' + S.fmtTime(lastVisit.in) : 'No previous visits';
      let action = '';
      if (inn) {
        const openVisit = S.data.checkins.find(c => c.memberId === m.id && !c.out);
        action = `<button class="btn sm red" onclick="event.stopPropagation();doOut('${openVisit.id}')">Check out</button>`;
      } else if (['active','expiring'].includes(status.key)) {
        action = `<button class="btn sm" onclick="event.stopPropagation();doIn('${m.id}')">Check in</button>`;
      } else if (['expired','none'].includes(status.key) && currentRole === 'owner') {
        action = `<button class="btn sm" onclick="event.stopPropagation();doIn('${m.id}')">Review access</button>`;
      } else if (['expired','none'].includes(status.key) && ['manager','receptionist'].includes(currentRole)) {
        action = `<button class="btn sm" onclick="event.stopPropagation();openAssign('${m.id}')">Renew membership</button>`;
      } else {
        action = '<button class="btn sm" disabled>Not eligible</button>';
      }
      return `<div class="row" onclick="openMember('${m.id}')">
        <div class="av">${ini(m.name)}</div>
        <div class="grow"><b>${esc(m.name)}</b><small>${esc(m.phone || 'No phone recorded')}</small>
          <small>Membership: ${badge(status)} · ${esc(sub(status))}</small>
          <small>Last visit: ${esc(lastVisitText)}</small>
        </div>${action}
      </div>`;
    }).join('') : '<div class="empty">No match. <a style="color:var(--acc)" href="#" onclick="openAdd();return false">Add as new member</a></div>') : '<div class="empty">Type a name or phone number to check someone in.</div>';
    const ins = S.inside();
    $('#cnt').textContent = ins.length;
    $('#inside').innerHTML = ins.length ? ins.map(c => {
      const m = S.member(c.memberId); if (!m) return '';
      const mins = Math.round((Date.now() - new Date(c.in)) / 6e4);
      return `<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)}</b><small>In at ${S.fmtTime(c.in)} · ${mins} min</small></div><button class="btn sm red" onclick="event.stopPropagation();doOut('${c.id}')">Check out</button></div>`;
    }).join('') : '<div class="empty">Gym is empty right now.</div>';
  }
  async function createAttendanceSession(id, label, notes = null) {
    if (S.isInside(id)) { toast('Already inside'); return false; }
    const { data, error } = await db.from('attendance_sessions').insert({
      gym_member_id: id, check_in_method: 'manual', check_in_by: currentUser.id, notes
    }).select('id,gym_member_id,checked_in_at,checked_out_at,check_in_method,check_in_by,check_out_by,notes').single();
    if (error) {
      if (error.code === '23505') toast('This member already has an open check-in');
      else databaseError(error);
      return false;
    }
    S.data.checkins.unshift({
      id: data.id, memberId: data.gym_member_id, in: data.checked_in_at,
      out: data.checked_out_at || null, method: data.check_in_method,
      checkInBy: data.check_in_by, checkOutBy: data.check_out_by, notes: data.notes || ''
    });
    toast(label || 'Member checked in'); refresh(); return true;
  }
  async function doIn(id) {
    const m = S.member(id);
    if (!m) { toast('Member not found'); return; }
    const s = memberStatus(m);
    if (S.isInside(id)) { toast('Already inside'); return; }
    if (s.key === 'expired' || s.key === 'none') {
      const canOverride = currentRole === 'owner';
      modal(`<h3>${esc(m.name)}</h3>
        <p class="mut" style="margin:6px 0 14px">${s.key === 'none' ? 'This member has no membership.' : 'Membership expired on ' + S.fmtDate(s.end) + '.'}</p>
        <button class="btn block" onclick="closeModal();openAssign('${id}')">Assign / renew membership</button>
        ${canOverride ? '<label for="override-reason">Owner override reason (required)</label><textarea id="override-reason" rows="3" maxlength="500" placeholder="Explain why this member is being admitted without an active membership"></textarea><button class="btn block ghost" onclick="forceIn(\'' + id + '\')">Owner override &amp; check in</button>' : '<p class="mut">Check-in is blocked until a valid membership is assigned. Only the gym owner can authorize an override.</p>'}
        <button class="btn block ghost" onclick="closeModal()">Cancel</button>`); return;
    }
    if (!['active','expiring'].includes(s.key)) {
      toast('This membership is not eligible for check-in. Contact the gym owner.');
      return;
    }
    await createAttendanceSession(id, `${m.name} checked in` + (s.key === 'expiring' ? ` · ${s.left === 0 ? 'ends today' : s.left + 'd left'}` : ''));
  }
  async function forceIn(id) {
    if (currentRole !== 'owner') { toast('Only the gym owner can override membership restrictions'); return; }
    const reason = ($('#override-reason') || {}).value?.trim() || '';
    if (reason.length < 5) { toast('Enter an override reason (at least 5 characters)'); return; }
    const saved = await createAttendanceSession(id, 'Owner-approved membership override', 'OWNER_OVERRIDE: ' + reason);
    if (saved) closeModal();
  }
  async function doOut(cid) {
    const { data, error } = await db.from('attendance_sessions')
      .update({ checked_out_at: new Date().toISOString(), check_out_by: currentUser.id })
      .eq('id', cid).is('checked_out_at', null)
      .select('id,gym_member_id,checked_out_at,check_out_by').maybeSingle();
    if (error) { databaseError(error); return; }
    if (!data) { toast('This visit is already checked out'); return; }
    const visit = S.data.checkins.find(c => c.id === cid);
    if (visit) { visit.out = data.checked_out_at; visit.checkOutBy = data.check_out_by; }
    toast('Checked out'); refresh();
  }

  V.members = () => currentRole === 'trainer' ? `<h2>Member directory <span class="pill">${S.data.members.length}</span></h2><p class="mut">View member contact details. Editing, membership and payment records are restricted.</p><input id="q" placeholder="Search by name or phone…" oninput="drawMembers()" autocomplete="off"><div id="res"></div>` : `<h2>Members <span class="pill">${S.data.members.length}</span></h2>
    <input id="q" placeholder="Search members…" oninput="drawMembers()" autocomplete="off">
    <div class="chips" id="chips"></div><div id="res"></div>
    <button class="fab" onclick="openAdd()">+</button>`;
  after.members = () => drawMembers();
  function drawMembers() {
    const q = ($('#q') || {}).value ? $('#q').value.toLowerCase().trim() : '';
    if (currentRole === 'trainer') {
      const list = S.data.members.filter(m => !q || m.name.toLowerCase().includes(q) || (m.phone || '').toLowerCase().includes(q)).sort((a,b) => a.name.localeCompare(b.name));
      $('#res').innerHTML = list.length ? list.map(m => row(m)).join('') : '<div class="empty">No members found.</div>';
      return;
    }
    const all = S.data.members.map(m => ({ m, s: memberStatus(m) }));
    const cnt = key => all.filter(x => key === 'all' || x.s.key === key).length;
    $('#chips').innerHTML = [['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['none', 'No plan']].map(([key, l]) => `<button class="chip ${filter === key ? 'on' : ''}" onclick="setFilter('${key}')">${l} ${cnt(key)}</button>`).join('');
    const list = all.filter(x => (filter === 'all' || x.s.key === filter) && (!q || x.m.name.toLowerCase().includes(q) || x.m.phone.includes(q)))
      .sort((a, b) => (a.s.left == null ? 1e9 : a.s.left) - (b.s.left == null ? 1e9 : b.s.left));
    $('#res').innerHTML = list.length ? list.map(x => row(x.m)).join('') : '<div class="empty">No members found.</div>';
  }
  function setFilter(f) { filter = f; drawMembers(); }

  V.plans = () => currentRole === 'trainer' ? '<h2>Access restricted</h2><div class="empty">Membership plan management is not available to trainer accounts.</div>' : `<h2>Membership plans <span class="pill">${S.data.plans.length}</span></h2>
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

  let staffRecords = [];
  V.staff = () => `<h2>Staff management</h2>
    <p class="mut" style="margin:-6px 0 14px">Invite team members and control their access to Alpha Gym.</p>
    <div class="sum"><div><b>${staffRecords.length}</b><small>Accounts</small></div><div><b>${staffRecords.filter(x=>x.is_active).length}</b><small>Active</small></div><div><b>${staffRecords.filter(x=>x.role==='trainer').length}</b><small>Trainers</small></div></div>
    <button class="btn block" onclick="openStaffInvite()">Invite staff member</button>
    <div id="staff-list"><div class="empty">Loading staff accounts…</div></div>`;
  after.staff = () => loadStaff();
  async function staffAction(body) {
    const {data,error}=await db.functions.invoke('staff-admin',{body});
    if(error) throw error;
    if(data?.error) throw new Error(data.error);
    return data;
  }
  async function loadStaff() {
    const host=$('#staff-list'); if(!host)return;
    if(currentRole!=='owner'){host.innerHTML='<div class="empty">Only the gym owner can manage staff accounts.</div>';return;}
    host.innerHTML='<div class="empty">Loading staff accounts…</div>';
    try {
      const result=await staffAction({action:'list'});
      staffRecords=result.staff||[];
      host.innerHTML=staffRecords.length ? staffRecords.map(s=>`<div class="row">
        <div class="av">${ini(s.full_name||s.email||'S')}</div>
        <div class="grow"><b>${esc(s.full_name||'Staff member')}</b><small>${esc(s.email||'No email')} · ${esc(s.phone||'No phone')}</small><small>${esc(s.role)} · ${s.is_active?'Active':'Inactive'}</small></div>
        <div class="right"><button class="btn sm ghost" onclick="editStaffRole('${s.id}')">Role</button><button class="btn sm ${s.is_active?'red':'ghost'}" onclick="toggleStaff('${s.id}')">${s.is_active?'Disable':'Enable'}</button></div>
      </div>`).join('') : '<div class="empty">No staff accounts found.</div>';
    } catch(error) { console.error(error); host.innerHTML='<div class="empty">Could not load staff. '+esc(error.message||'Please retry.')+'</div>'; }
  }
  function openStaffInvite() {
    if(currentRole!=='owner'){toast('Only the owner can invite staff');return;}
    modal(`<h3>Invite staff member</h3>
      <label>Full name</label><input id="staff-name" maxlength="100" placeholder="Staff member's full name">
      <label>Email address</label><input id="staff-email" type="email" maxlength="254" placeholder="name@example.com">
      <label>Phone (optional)</label><input id="staff-phone" maxlength="30" placeholder="Phone number">
      <label>Role</label><select id="staff-role"><option value="manager">Manager</option><option value="receptionist">Receptionist</option><option value="trainer">Trainer</option></select>
      <p class="mut" style="font-size:.82rem">An invitation email will be sent so the staff member can set up their own password. Never share passwords.</p>
      <button class="btn block" onclick="inviteStaff()">Send invitation</button><button class="btn block ghost" onclick="closeModal()">Cancel</button>`);
  }
  async function inviteStaff() {
    if(currentRole!=='owner')return;
    const full_name=$('#staff-name').value.trim(), email=$('#staff-email').value.trim().toLowerCase(), phone=$('#staff-phone').value.trim(), role=$('#staff-role').value;
    if(!full_name||!/^\S+@\S+\.\S+$/.test(email)){toast('Enter a name and valid email address');return;}
    try {
      await staffAction({action:'invite',full_name,email,phone:phone||null,role});
      closeModal();toast('Invitation sent to '+email);await loadStaff();
    } catch(error){toast(error.message||'Could not send invitation');}
  }
  async function editStaffRole(id) {
    if(currentRole!=='owner')return;
    const person=staffRecords.find(s=>s.id===id); if(!person||person.role==='owner')return;
    modal(`<h3>Change staff role</h3><p class="mut">${esc(person.full_name||person.email)}</p>
      <label>Role</label><select id="staff-role-edit">
        <option value="manager" ${person.role==='manager'?'selected':''}>Manager</option>
        <option value="receptionist" ${person.role==='receptionist'?'selected':''}>Receptionist</option>
        <option value="trainer" ${person.role==='trainer'?'selected':''}>Trainer</option>
      </select><button class="btn block" onclick="saveStaffRole('${id}')">Save role</button><button class="btn block ghost" onclick="closeModal()">Cancel</button>`);
  }
  async function saveStaffRole(id) {
    try { await staffAction({action:'update',id,role:$('#staff-role-edit').value});closeModal();toast('Staff role updated');await loadStaff(); }
    catch(error){toast(error.message||'Could not update role');}
  }
  async function toggleStaff(id) {
    if(currentRole!=='owner')return;
    const person=staffRecords.find(s=>s.id===id);if(!person||person.role==='owner'||id===currentUser.id)return;
    if(!confirm((person.is_active?'Disable':'Enable')+' access for '+(person.full_name||person.email)+'?'))return;
    try { await staffAction({action:person.is_active?'disable':'enable',id});toast(person.is_active?'Staff access disabled':'Staff access enabled');await loadStaff(); }
    catch(error){toast(error.message||'Could not update staff access');}
  }

  V.payments = () => {
    if (currentRole === 'trainer') return '<h2>Access restricted</h2><div class="empty">Financial records are not available to trainer accounts.</div>';
    const t=S.today(), p=[...S.data.payments].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
    const management=['owner','manager'].includes(currentRole);
    const week=S.revenueSince(S.addDays(t,-6)), month=S.revenueSince(t.slice(0,7)+'-01');
    const summary = management
      ? `<div class="sum"><div><b>${S.money(S.revenueOn(t))}</b><small>Today</small></div><div><b>${S.money(week)}</b><small>7 days</small></div><div><b>${S.money(month)}</b><small>This month</small></div></div>`
      : `<div class="sum"><div><b>${S.money(S.revenueOn(t))}</b><small>Collected today</small></div></div>`;
    const exportButton = management ? '<button class="btn block ghost" style="margin:0 0 6px" onclick="exportPay()">Export payments (CSV)</button>' : '';
    let last='';
    return `<h2>Payments</h2>
      ${summary}
      ${exportButton}
      ${p.length ? p.slice(0,100).map(x=>{
        const m=S.member(x.memberId); if(!m)return '';
        const plan=S.plan(x.planId), head=x.paid!==last ? `<h3 style="font-size:.85rem;color:var(--mut)">${S.fmtDate(x.paid)}${x.paid===t?' · Today':''}</h3>` : ''; last=x.paid;
        return head+`<div class="row" onclick="openMember('${m.id}')"><div class="av">${ini(m.name)}</div><div class="grow"><b>${esc(m.name)} ${x.isVoided?'<span class="badge b-expired">Reversed</span>':''}</b><small>${esc(plan?.name || 'Membership payment')} · ${esc(x.method.toUpperCase())}${x.code?' · '+esc(x.code):''}</small></div><div class="right"><b>${S.money(x.amount)}</b></div></div>`;
      }).join('') : '<div class="empty">No payments recorded yet.</div>'}`;
  };

  // ---------- reports ----------
  V.reports = () => {
    if (!['owner', 'manager'].includes(currentRole)) return '<h2>Reports</h2><div class="empty">Reports are available to the owner and manager only.</div>';
    return `<div class="report-head"><div><h2>Reports</h2><p class="mut">Review Alpha Gym activity and export records.</p></div></div>
      <div class="report-filters">
        <div><label for="report-from">From</label><input id="report-from" type="date" value="${reportFrom}" onchange="drawReports()"></div>
        <div><label for="report-to">To</label><input id="report-to" type="date" value="${reportTo}" onchange="drawReports()"></div>
      </div>
      <p class="report-note">The date range filters registrations, payments and attendance. Outstanding balances show the current unpaid amount across memberships.</p>
      <div id="reports-content"></div>`;
  };
  after.reports = () => drawReports();

  function reportDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function reportData() {
    const from = reportFrom, to = reportTo;
    const members = S.data.members.filter(m => m.joined >= from && m.joined <= to);
    const payments = S.data.payments.filter(p => p.paid >= from && p.paid <= to).sort((a,b) => b.receivedAt.localeCompare(a.receivedAt));
    const attendance = S.data.checkins.filter(c => {
      const d = reportDate(c.in);
      return d >= from && d <= to;
    }).sort((a,b) => b.in.localeCompare(a.in));
    const balances = (S.data.memberships || []).filter(ms => ms.status !== 'cancelled' && S.member(ms.gym_member_id))
      .map(ms => ({ ms, member: S.member(ms.gym_member_id), plan: S.plan(ms.plan_id), due: membershipBalance(ms) }))
      .filter(x => x.due > 0).sort((a,b) => b.due - a.due);
    return { members, payments, attendance, balances };
  }
  function drawReports() {
    const host = $('#reports-content');
    if (!host) return;
    const fromEl = $('#report-from'), toEl = $('#report-to');
    if (fromEl && fromEl.value) reportFrom = fromEl.value;
    if (toEl && toEl.value) reportTo = toEl.value;
    if (reportFrom > reportTo) {
      host.innerHTML = '<div class="empty">The start date must be on or before the end date.</div>';
      return;
    }
    const d = reportData();
    const validPayments = d.payments.filter(p => !p.isVoided);
    const netRevenue = validPayments.reduce((sum,p) => sum + Number(p.amount || 0), 0);
    const reversed = d.payments.filter(p => p.isVoided).reduce((sum,p) => sum + Number(p.amount || 0), 0);
    const dueTotal = d.balances.reduce((sum,x) => sum + x.due, 0);
    const activeNow = S.data.members.filter(m => memberStatus(m).key === 'active').length;
    const insideNow = S.inside().length;
    const preview = (items, renderRow, empty) => items.length ? items.slice(0,30).map(renderRow).join('') + (items.length > 30 ? '<p class="report-note">Showing the latest 30 of ' + items.length + ' records. Export CSV for the full list.</p>' : '') : '<div class="empty">' + empty + '</div>';
    host.innerHTML = `
      <section class="report-card">
        <div class="report-title"><div><h3>Membership report</h3><p class="mut">New registrations in the selected period</p></div><button class="btn sm ghost" onclick="exportReport('members')">Export CSV</button></div>
        <div class="report-kpis"><div><b>${d.members.length}</b><small>New registrations</small></div><div><b>${activeNow}</b><small>Active now</small></div></div>
        ${preview(d.members, m => '<div class="report-row"><div><b>'+esc(m.name)+'</b><small>'+esc(m.phone)+' · Joined '+S.fmtDate(m.joined)+'</small></div><span class="badge b-'+memberStatus(m).key+'">'+esc(memberStatus(m).label)+'</span></div>', 'No registrations in this date range.')}
      </section>
      <section class="report-card">
        <div class="report-title"><div><h3>Payments report</h3><p class="mut">Recorded payments, excluding reversals from net revenue</p></div><button class="btn sm ghost" onclick="exportReport('payments')">Export CSV</button></div>
        <div class="report-kpis"><div><b>${S.money(netRevenue)}</b><small>Net collected</small></div><div><b>${S.money(reversed)}</b><small>Reversed</small></div><div><b>${validPayments.length}</b><small>Valid payments</small></div></div>
        ${preview(d.payments, p => { const m=S.member(p.memberId)||{}; return '<div class="report-row"><div><b>'+esc(m.name||'Member record unavailable')+'</b><small>'+S.fmtDate(p.paid)+' · '+esc(String(p.method||'').toUpperCase())+(p.isVoided?' · Reversed':'')+'</small></div><b>'+S.money(p.amount)+'</b></div>'; }, 'No payments in this date range.')}
      </section>
      <section class="report-card">
        <div class="report-title"><div><h3>Outstanding balances</h3><p class="mut">Current unpaid membership balances</p></div><button class="btn sm ghost" onclick="exportReport('balances')">Export CSV</button></div>
        <div class="report-kpis"><div><b>${S.money(dueTotal)}</b><small>Total outstanding</small></div><div><b>${d.balances.length}</b><small>Membership balances</small></div></div>
        ${preview(d.balances, x => '<div class="report-row"><div><b>'+esc(x.member.name)+'</b><small>'+esc(x.plan?.name||'Membership')+' · '+S.fmtDate(x.ms.start_date)+' – '+S.fmtDate(x.ms.end_date)+'</small></div><b>'+S.money(x.due)+'</b></div>', 'No outstanding membership balances.')}
      </section>
      <section class="report-card">
        <div class="report-title"><div><h3>Attendance report</h3><p class="mut">Check-in sessions during the selected period</p></div><button class="btn sm ghost" onclick="exportReport('attendance')">Export CSV</button></div>
        <div class="report-kpis"><div><b>${d.attendance.length}</b><small>Visits in period</small></div><div><b>${insideNow}</b><small>Inside now</small></div></div>
        ${preview(d.attendance, c => { const m=S.member(c.memberId)||{}; return '<div class="report-row"><div><b>'+esc(m.name||'Member record unavailable')+'</b><small>'+S.fmtDate(reportDate(c.in))+' · '+S.fmtTime(c.in)+' → '+(c.out?S.fmtTime(c.out):'Still inside')+'</small></div><span class="badge '+(c.out?'b-none':'b-active')+'">'+(c.out?'Completed':'Inside')+'</span></div>'; }, 'No attendance sessions in this date range.')}
      </section>`;
  }
  function exportReport(type) {
    if (!['owner','manager'].includes(currentRole)) { toast('Reports are available to the owner and manager only'); return; }
    const d = reportData();
    if (type === 'members') download('alpha-gym-memberships.csv', [['Member','Phone','Email','Joined','Membership status','Expiry'], ...d.members.map(m => { const s=memberStatus(m); return [m.name,m.phone,m.email,m.joined,s.label,s.end||'']; })]);
    else if (type === 'payments') download('alpha-gym-payments.csv', [['Date','Member','Phone','Plan','Amount KES','Method','Reference','Status','Reversal reason','Notes'], ...d.payments.map(p => { const m=S.member(p.memberId)||{}; return [p.paid,m.name||'',m.phone||'',S.plan(p.planId)?.name||'',p.amount,p.method,p.code,p.isVoided?'Reversed':'Recorded',p.voidReason,p.notes]; })]);
    else if (type === 'balances') download('alpha-gym-outstanding-balances.csv', [['Member','Phone','Plan','Membership start','Membership end','Amount due KES'], ...d.balances.map(x => [x.member.name,x.member.phone,x.plan?.name||'',x.ms.start_date,x.ms.end_date,x.due])]);
    else if (type === 'attendance') download('alpha-gym-attendance.csv', [['Member','Phone','Date','Check-in','Check-out','Status'], ...d.attendance.map(c => { const m=S.member(c.memberId)||{}; return [m.name||'',m.phone||'',reportDate(c.in),S.fmtTime(c.in),c.out?S.fmtTime(c.out):'',c.out?'Completed':'Still inside']; })]);
  }

  function exportMembers() {
    const rows = [['Name', 'Phone', 'Email', 'Joined', 'Membership status', 'Membership expiry', 'Visits']];
    S.data.members.forEach(m => {
      const status = memberStatus(m);
      rows.push([m.name, m.phone, m.email, m.joined, status.label, status.end || '', S.memberVisits(m.id).length]);
    });
    download('members.csv', rows);
  }

  function exportPay() { if (!['owner','manager'].includes(currentRole)) { toast('Payment exports are available to the owner and manager only'); return; } download('payments.csv', [['Date','Member','Phone','Plan','Amount','Method','Reference','Notes'], ...S.data.payments.map(p=>{const m=S.member(p.memberId)||{};return [p.paid,m.name,m.phone,S.plan(p.planId)?.name||'',p.amount,p.method,p.code,p.notes];})]); }

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
    const m=S.member(id); if (!m) return;
    if (currentRole === 'trainer') { modal(`<div style="display:flex;gap:12px;align-items:center"><div class="av" style="width:54px;height:54px">${ini(m.name)}</div><div class="grow"><h3 style="margin:0">${esc(m.name)}</h3><small>Gym member</small></div></div><div class="prev" style="margin-top:14px"><b>Phone</b><br>${esc(m.phone || 'Not provided')}<br><br><b>Email</b><br>${esc(m.email || 'Not provided')}<br><br><b>Member since</b><br>${S.fmtDate(m.joined)}${m.memberNumber ? `<br><br><b>Member number</b><br>${esc(m.memberNumber)}` : ''}</div><button class="btn block ghost" onclick="closeModal()">Close</button>`); return; }
    const s=memberStatus(m), inn=S.isInside(id);
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
      <h3>Recent visits</h3>${vis.length?vis.slice(0,5).map(v=>`<div class="row"><div class="grow"><b>${S.fmtDate(S.ymd(v.in))}</b><small>${S.fmtTime(v.in)} → ${v.out?S.fmtTime(v.out):'inside'}${v.notes ? ' · '+esc(v.notes) : ''}</small></div></div>`).join(''):'<div class="empty">No visits yet.</div>'}
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
    if (currentRole === 'trainer') { modal(`<h3>Settings</h3><button class="btn block ghost" onclick="lockApp()">Lock app / Sign out</button>`); return; }
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
    if (currentRole === 'trainer' && !['home','members','profile'].includes(route)) route = 'home';
    $('#view').innerHTML = V[route](); if (after[route]) after[route]();
    const visibleTabs = currentRole === 'trainer' ? TABS.filter(([r]) => ['home','members','profile'].includes(r)) : TABS.filter(([r]) => r!=='staff' || currentRole==='owner');
    $('#tabs').innerHTML = visibleTabs.map(([r, i, l]) => `<button class="${r === route ? 'on' : ''}" onclick="go('${r}')"><i>${i}</i>${l}</button>`).join('');
  }
  function go(r) { if (currentRole === 'trainer' && !['home','members','profile'].includes(r)) r = 'home'; route = r; location.hash = r; render(); scrollTo(0, 0); }
  async function boot() {
    $('#gate').innerHTML = '';
    $('#view').innerHTML = '<div class="empty">Loading Alpha Gym records…</div>';
    try {
      if (currentRole === 'trainer') {
        await loadMembersFromDatabase();
        // Clear any legacy browser-cached financial or management data before a trainer session.
        S.data.plans = []; S.data.memberships = []; S.data.payments = []; S.data.checkins = [];
        S.data.accounts = []; S.save();
      } else await Promise.all([loadMembersFromDatabase(), loadPlansFromDatabase(), loadMembershipsFromDatabase()]);
    }
    catch (error) {
      databaseError(error);
      $('#view').innerHTML = '<div class="empty">Could not load core Alpha Gym records. Check your connection and reload.</div>';
      return;
    }
    // Attendance is loaded from the database; an attendance read failure must not blank the whole management portal.
    if (currentRole !== 'trainer') {
      try { await loadAttendanceFromDatabase(); }
      catch (error) { databaseError(error); S.data.checkins = []; }
      // Payments are secondary data: a payment-query issue must never prevent the management shell from opening.
      try { await loadPaymentsFromDatabase(); }
      catch (error) { console.error('Alpha Gym payments could not be loaded:', error); S.data.payments = []; }
    }
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
      .from('profiles').select('full_name,email,phone,role,is_active').eq('id', data.user.id).single();
    if (profileError || !profile || !profile.is_active || !['owner','manager','receptionist','trainer'].includes(profile.role)) {
      await window.alphaSupabase.auth.signOut();
      showGate('This account does not have management access. Contact the gym owner.');
      return;
    }
    currentUser = data.user; currentProfile = profile; currentRole = profile.role;
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
      const { data: profile, error } = await window.alphaSupabase.from('profiles').select('full_name,email,phone,role,is_active').eq('id', session.user.id).single();
      if (!error && profile && profile.is_active && ['owner','manager','receptionist','trainer'].includes(profile.role)) {
        currentUser = session.user; currentProfile = profile; currentRole = profile.role;
        sessionStorage.setItem('adm','1'); await boot(); return;
      }
      await window.alphaSupabase.auth.signOut();
    }
    showGate();
  }

  Object.assign(window, { $, toast, closeModal, drawReports, exportReport, drawCI, drawMembers, drawPlans, openPlanForm, savePlan, togglePlan, openAssign, saveAssignment, doIn, doOut, forceIn, setFilter, openMember, delMember, editMember, saveEditMember, openAdd, saveMember, openPay, savePay, openVoidPayment, saveVoidPayment, openSettings, exportMembers, exportPay, logRem, queueAll, go, unlock, forgotPassword, lockApp, render, openStaffInvite, inviteStaff, editStaffRole, saveStaffRole, toggleStaff, openProfileEdit, saveProfile });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
  gate().catch(error => {
    console.error('Alpha Gym authentication startup failed:', error);
    showGate('We could not verify your session. Check your connection and sign in again.');
  });
})();
