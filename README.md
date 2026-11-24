# IronForge Gym Demo (zero-cost, static)

Files: `index.html` (public site) · `portal.html` (member sign-up/login) · `app.html` (owner app, PWA) · `store.js` (data + logic) · `app.js` · `style.css`

## Deploy on GitHub Pages (free)
1. Create a GitHub repo, upload everything in this folder to the root.
2. Settings → Pages → Source: `main` branch, `/ (root)`. Link appears in ~1 min.
3. Owner app: `<link>/app.html` (PIN 1234). On his phone: open it in Chrome → menu → "Add to Home screen".
4. Rebrand per client: edit `CONFIG` at the top of `store.js` (name, WhatsApp number, till, PIN).

## Demo limits (be upfront with the client)
Data lives in the browser (localStorage), so member sign-ups on one phone do NOT appear on the owner's phone, and email reminders are simulated. The paid version moves to a real database (Supabase) + automatic email (Resend/Brevo).

## 5-minute pitch script
1. Public site on his phone → "this is your website".
2. Owner app → Home: inside now, revenue, who's expiring.
3. Check-in: search "Brian" → check in; try an expired member (red warning → Renew & check in).
4. Add a member + payment → WhatsApp receipt.
5. Reminders → "Email all" and one-tap WhatsApp.
6. Portal → login demo@member.com / demo123 → days-left ring, history, reminder toggles.
