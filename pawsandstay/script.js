/* ============ A. SETTINGS & DATA ============ */
const STATUSES = ['Pending Confirmation', 'Confirmed', 'Completed', 'Cancelled'];
const ADMIN_PORTAL = document.body.dataset.adminPortal === 'true';
const DEFAULT_SERVICES = [
  { id: 1, name: 'Home Safety Audit', price: 800, desc: 'Room-by-room walkthrough to flag pet hazards, with a written report.', art: 'audit' },
  { id: 2, name: 'Pet-Proof Installation', price: 1500, desc: 'Safety gates, cat balconies, or non-slip flooring, installed.', art: 'proof' },
  { id: 3, name: 'Camera Setup', price: 1500, desc: 'Pet-facing camera installed and linked to your phone.', art: 'camera' },
  { id: 4, name: 'In-Home Pet Sitting', price: 600, desc: 'Feeding, walks, and playtime at your pet\'s own home.', art: 'sitting' },
  { id: 5, name: 'Pet Wellness Check', price: 350, desc: 'Daily health check with a same-day update.', art: 'wellness' }
];
let SERVICES = [...DEFAULT_SERVICES];            /* loaded from database via /api/services, with fallback */

/* Service photos live in the images folder next to index.html */
const IMAGES = {
  audit: 'images/audit.jpg',
  proof: 'images/proof.jpg',
  camera: 'images/camera.jpg',
  sitting: 'images/sitting.jpg',
  wellness: 'images/wellness.jpg'
};
const POS = { audit: '70%', proof: '60%', camera: '55%', sitting: '60%', wellness: '45%' };
const picture = key => `<div class="pic"><img src="${IMAGES[key] || 'Logo.jpg'}" alt="${esc(((SERVICES || []).find(s => s.art == key) || {}).name)}" loading="lazy" style="object-position:50% ${POS[key] || '50%'}"></div>`;

/* ============ B. SERVER CALLS (all data lives in the database) ============ */
let S = { session: null, bookings: [], admin: null };
let flash = null, filters = { text: '', status: '' }, renderId = 0, focusBookingId = null;
let bookingView = { search: '', status: '', date: '', limit: 10 };

function getApiEndpoint(url) {
  const apiPath = url.replace(/^\/api(?=\/)/, '');
  const queryIndex = apiPath.indexOf('?');
  const route = queryIndex < 0 ? apiPath : apiPath.slice(0, queryIndex);
  const params = queryIndex < 0 ? '' : apiPath.slice(queryIndex + 1);
  if (location.protocol === 'file:') {
    const endpoint = new URL('http://localhost/pawsandstay/api.php');
    endpoint.searchParams.set('r', route);
    new URLSearchParams(params).forEach((value, key) => endpoint.searchParams.append(key, value));
    return endpoint.href;
  }
  const endpoint = new URL('api.php', document.baseURI);
  endpoint.searchParams.set('r', route);
  new URLSearchParams(params).forEach((value, key) => endpoint.searchParams.append(key, value));
  return endpoint.href;
}

async function api(method, url, body) {
  const target = getApiEndpoint(url);
  const isFormData = body instanceof FormData;
  const headers = isFormData ? {} : (body ? { 'Content-Type': 'application/json' } : {});
  if (ADMIN_PORTAL && S.session?.csrf && method !== 'GET') headers['X-CSRF-Token'] = S.session.csrf;
  let res;
  try {
    res = await fetch(target, {
      method,
      credentials: 'include',
      headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined)
    });
  } catch (err) {
    if (location.protocol === 'file:') {
      throw new Error("You are opening this file directly (file://). Please open http://localhost/pawsandstay/ in your browser.");
    }
    if (location.port === '5500') {
      throw new Error("This page is running on VS Code Live Server, which cannot run PHP. Open http://localhost/pawsandstay/ through XAMPP Apache.");
    }
    throw new Error(`Cannot reach the PHP backend at ${target}. Check the Apache URL and make sure Apache is running in XAMPP.`);
  }

  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (jsonErr) {
    if (text.trim().startsWith('<?php')) {
      throw new Error("PHP is not running on this port. If you are using VS Code Live Server, please open http://localhost/pawsandstay/ instead.");
    }
    throw new Error(res.ok ? "Server returned invalid response." : `Server error (${res.status}). Check server logs.`);
  }

  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: res.status });
  return data;
}

/* ============ C. HELPERS & VALIDATION ============ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '₱' + Number(n || 0).toLocaleString();
const service = id => (SERVICES || []).find(s => s.id == id) || { name: 'Custom Care', price: 0 };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const currentTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(11, 16);
const setFlash = (msg, kind = 'ok') => { flash = { msg, kind }; };
const showFlash = () => { const f = flash; flash = null; return f ? `<div class="${f.kind}">${esc(f.msg)}</div>` : ''; };
const errBox = '<div class="err" id="err" hidden></div>';
const fail = m => { const b = $('#err'); if (b) { b.textContent = m; b.hidden = false; } else alert(m); };

/* Requirement 1: Contact Number Validation (numbers only, exactly 11 digits) */
function validatePhone(phone) {
  const p = String(phone || '').trim();
  if (!/^\d{11}$/.test(p)) {
    return 'Contact number must contain exactly 11 digits.';
  }
  return null;
}

/* Requirement 2: Password Validation (at least 8 chars, 1 number, 1 special character) */
function validatePassword(pw) {
  const p = String(pw || '');
  if (p.length < 8 || !/\d/.test(p) || !/[^a-zA-Z0-9]/.test(p)) {
    return 'Password must be at least 8 characters and contain a number and special character.';
  }
  return null;
}

function validateGcashReference(value) {
  return /^[0-9]{15}$/.test(String(value || ''))
    ? null
    : 'GCash reference number must be exactly 15 digits.';
}

const serviceCards = action => `<div class="grid">${(SERVICES || []).map(s => `<article class="scard">${picture(s.art)}<div class="sbody"><h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p><div class="price">From ${money(s.price)}</div>${action(s)}</div></article>`).join('')}</div>`;
const when = iso => iso ? new Date(iso).toLocaleString() : '—';
const fullName = u => ((u.first || '(deleted)') + ' ' + (u.last || '')).trim();
const armed = (btn, label) => {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { btn.textContent = old; delete btn.dataset.armed; } }, 4000);
  return false;
};
const refundCanBeRequested = booking =>
  booking.paymentMethod === 'GCash'
  && booking.paymentStatus === 'Paid'
  && booking.status === 'Confirmed'
  && /^[0-9]{15}$/.test(String(booking.gcashReference || ''))
  && !['Pending', 'Accepted', 'Processing', 'Refunded'].includes(booking.refundStatus);

/* Format date e.g. "October 15, 2026" */
function formatHumanDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d) ? dateStr : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* Format time e.g. "10:00 AM" */
function formatHumanTime(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  let h = parseInt(parts[0], 10), m = parts[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/* ============ D. PAGES (VIEWS) ============ */
function navView() {
  const s = S.session;
  if (ADMIN_PORTAL) {
    $('#nav').innerHTML = `<a href="#overview">Overview</a><a href="#clients">Client Accounts</a><a href="#bookings">Bookings</a><a href="#services">Services</a><a href="#payments">Payments</a><a href="#refunds">Refund Requests</a><a href="#notifications">Booking Notifications</a>
      <form method="post" action="admin/logout.php" class="admin-logout-form">
        <input type="hidden" name="csrf" value="${esc(s?.csrf || '')}">
        <button type="submit">Admin Logout</button>
      </form>`;
    return;
  }
  $('#nav').innerHTML = !s
    ? '<a href="#/">Home</a><a href="#/login">Log in</a><a href="#/register">Register</a>'
    : '<a href="#/">Home</a><a href="#/dash">My dashboard</a><a class="nav-cta" data-act="open-booking">🐾 Book Service</a><a data-act="logout">Log out</a>';
}

function homeView() {
  return `<div class="wrap">
    <div class="hero-wrapper">
      <section class="hero">
        <div>
          <h1>A watchful, loving stay for your pet — and a safer home.</h1>
          <p>We look after your dog or cat the way you would, and pet-proof the house so every homecoming is worry-free.</p>
          <div class="hero-actions">
            <button class="btn" data-act="open-booking">🐾 Book a visit</button>
            <a class="btn ghost" href="#/register">Create account</a>
          </div>
        </div>
        <div class="art"><img src="Logo.jpg" alt="Paws &amp; Stay logo"></div>
      </section>
    </div>
    <h2>Our services</h2>
    ${serviceCards(s => `<button class="btn sm" data-act="pick" data-id="${s.id}">Book this</button>`)}
  </div>`;
}

function loginView() {
  return `<section class="auth-page">
    <div class="auth-card">
      <a href="#/" class="auth-close-btn" aria-label="Cancel and return to home" title="Back to home">✕</a>
      <div class="auth-brand">
        <img src="Logo.jpg" alt="Paws &amp; Stay logo">
        <span>Paws &amp; Stay</span>
      </div>
      <h1>Welcome back</h1>
      <p class="sub">Log in to your Paws &amp; Stay account.</p>
      ${showFlash()}${errBox}
      <form data-form="login">
        <label>Email Address
          <input type="email" name="email" id="loginEmail" placeholder="you@example.com" required autocomplete="email">
        </label>
        <label>Password
          <div class="pw-wrapper">
            <input type="password" name="pw" id="loginPw" placeholder="Enter your password" required autocomplete="current-password">
            <button type="button" class="pw-toggle-btn" data-toggle="loginPw" aria-label="Show password">👁️</button>
          </div>
        </label>
        <div class="remember-row">
          <label class="checkbox-label">
            <input type="checkbox" name="remember" id="rememberMe">
            <span>Remember Me</span>
          </label>
        </div>
        <button class="btn full-width" type="submit">Log in</button>
      </form>
      <p class="switch">New to Paws &amp; Stay? <a href="#/register">Create an account</a></p>
      <div class="auth-extra-links"><a href="#/">Back to Home</a></div>
    </div>
  </section>`;
}

function registerView() {
  return `<section class="auth-page">
    <div class="auth-card">
      <a href="#/" class="auth-close-btn" aria-label="Cancel and return to home" title="Back to home">✕</a>
      <div class="auth-brand">
        <img src="Logo.jpg" alt="Paws &amp; Stay logo">
        <span>Paws &amp; Stay</span>
      </div>
      <h1>Create your account</h1>
      <p class="sub">Sign up to book boutique pet care services.</p>
      ${errBox}
      <form data-form="register">
        <div class="row2">
          <label>First Name<input type="text" name="first" placeholder="First name" required></label>
          <label>Last Name<input type="text" name="last" placeholder="Last name" required></label>
        </div>
        <label>Email Address<input type="email" name="email" placeholder="you@example.com" required autocomplete="email"></label>
        <label>Contact Number (11 digits only)
          <input type="tel" name="phone" id="regPhone" placeholder="09123456789" maxlength="11" pattern="\\d{11}" inputmode="numeric" required autocomplete="tel">
          <span class="field-hint">Numbers only. Example: 09123456789</span>
        </label>
        <label>Address<input type="text" name="address" placeholder="e.g. Talibon, Bohol" required></label>
        <div class="row2">
          <label>Password
            <div class="pw-wrapper">
              <input type="password" name="pw" id="regPw" placeholder="At least 8 chars" required autocomplete="new-password">
              <button type="button" class="pw-toggle-btn" data-toggle="regPw" aria-label="Show password">👁️</button>
            </div>
            <span class="field-hint">Min 8 chars, 1 number, 1 special character</span>
          </label>
          <label>Confirm Password
            <div class="pw-wrapper">
              <input type="password" name="pw2" id="regPw2" placeholder="Re-enter password" required autocomplete="new-password">
              <button type="button" class="pw-toggle-btn" data-toggle="regPw2" aria-label="Show password">👁️</button>
            </div>
          </label>
        </div>
        <button class="btn full-width" type="submit">Create account</button>
      </form>
      <p class="switch">Already have an account? <a href="#/login">Log in</a></p>
      <div class="auth-extra-links"><a href="#/">Back to Home</a></div>
    </div>
  </section>`;
}

function clientBookingList() {
  const mine = S.bookings || [];
  const query = bookingView.search.trim().toLowerCase();
  const targetBookingId = focusBookingId;
  const filtered = mine.filter(b => {
    if (targetBookingId !== null) return Number(b.id) === targetBookingId;
    const services = (b.services || []).map(s => s.name).join(' ');
    const searchable = [`${b.id}`, services, b.status, b.paymentMethod, b.paymentStatus, b.refundStatus || ''].join(' ').toLowerCase();
    return (!query || searchable.includes(query))
      && (!bookingView.status || b.status === bookingView.status)
      && (!bookingView.date || b.date === bookingView.date);
  });
  const visible = filtered.slice(0, bookingView.limit);

  if (!visible.length) {
    return `<p class="sub">${mine.length ? 'No bookings match these filters.' : 'No bookings yet. Click “Book Now / Book Service” above to schedule your first visit!'}</p>`;
  }

  return `<p class="sub booking-count">Showing ${visible.length} of ${filtered.length} matching bookings (${mine.length} total).</p>
    ${visible.map(b => {
      const svcs = (b.services && b.services.length) ? b.services : [service(b.sid)];
      const svcNames = svcs.map(s => esc(s.name) + (s.price ? ` (${money(s.price)})` : '')).join(' · ');
      const statusCls = String(b.status).toLowerCase().replace(/\s+/g, '-');
      const payCls = String(b.paymentMethod || 'cash').toLowerCase();
      return `<article class="panel booking-card" id="booking-item-${b.id}" tabindex="-1">
        <div class="between booking-card-summary">
          <div>
            <strong>Booking #${b.id}</strong><br>
            <strong>${svcNames}</strong><br>
            <small>📅 ${formatHumanDate(b.date)} at ${formatHumanTime(b.time)} · Total: <strong>${money(b.totalPrice || b.price)}</strong></small>
            <div class="booking-badges">
              <span class="badge ${payCls}">${esc(b.paymentMethod || 'Cash')}</span>
              <span class="badge">Payment: ${esc(b.paymentStatus || 'Pending')}</span>
              ${b.paymentDate ? `<span class="badge">Paid: ${when(b.paymentDate)}</span>` : ''}
              ${b.gcashReference ? `<span class="badge gcash">GCash Ref: ${esc(b.gcashReference)}</span>` : ''}
              ${b.refundStatus ? `<span class="badge refund-${String(b.refundStatus).toLowerCase()}">Refund Requested: ${esc(b.refundStatus)}</span>` : '<span class="badge">Refund: Not requested</span>'}
              ${b.paymentReceipt ? `<button class="receipt-btn" type="button" data-act="view-receipt" data-url="${esc(b.paymentReceipt)}">🖼️ View Receipt</button>` : ''}
            </div>
          </div>
          <span class="badge ${statusCls}">${esc(b.status)}</span>
        </div>
        ${b.notes ? `<p class="sub" style="margin-top:10px"><em>Notes:</em> ${esc(b.notes)}</p>` : ''}
        <div class="booking-actions">
          <button class="btn sm ghost" type="button" data-act="booking-details" data-id="${b.id}">View Details</button>
          ${refundCanBeRequested(b) ? `<button class="btn sm honey" type="button" data-act="request-refund" data-id="${b.id}">Request Refund</button>` : ''}
          ${['Pending Confirmation', 'Pending', 'Confirmed'].includes(b.status)
            ? `<button class="btn sm danger" type="button" data-act="cancel" data-id="${b.id}">Cancel booking</button>`
            : ''}
        </div>
      </article>`;
    }).join('')}
    ${visible.length < filtered.length ? `<div class="booking-more"><button class="btn ghost" type="button" data-act="show-more-bookings">Show More Bookings</button></div>` : ''}`;
}

function refundNotifications() {
  const messages = {
    Pending: 'Your refund request has been submitted and is waiting for admin review.',
    Accepted: 'Your refund request has been accepted.',
    Rejected: 'Your refund request was rejected by the admin.',
    Cancelled: 'Your refund request was cancelled.',
    Processing: 'Your refund is currently being processed.',
    Refunded: 'Your GCash refund has been marked as refunded.'
  };
  const unseen = (S.bookings || []).filter(b => b.refundStatus && b.refundStatus !== b.refundSeenStatus);
  return `<div id="refundNotifications">${unseen.map(b => `<div class="panel refund-notification" role="status">
    <strong>${esc(messages[b.refundStatus] || `Refund status: ${b.refundStatus}`)}</strong>
    ${b.refundAdminNote ? `<p>Admin reason/note: ${esc(b.refundAdminNote)}</p>` : ''}
    <div class="booking-actions">
      <button class="btn sm ghost" type="button" data-act="booking-details" data-id="${b.id}">View Refund Details</button>
      <button class="btn sm" type="button" data-act="ack-refund" data-id="${b.id}">Dismiss</button>
    </div>
  </div>`).join('')}</div>`;
}

function dashView() {
  const me = S.session.user;
  return `<div class="wrap">
    <h1>Hello, ${esc(me.first)} 🐾</h1>
    <p class="sub">Choose your boutique pet care services and book your visit anytime.</p>
    ${showFlash()}
    ${refundNotifications()}

    <!-- Book Now CTA Box (Replaces old static book service box) -->
    <div class="panel book-action-panel">
      <div class="between">
        <div>
          <h2 style="margin:0 0 4px">Book a Service</h2>
          <p class="sub" style="margin:0">Select multiple services, choose your date and time, and confirm your booking in a few clicks.</p>
        </div>
        <div class="booking-primary-actions">
          <button class="btn ghost" type="button" data-act="scroll-bookings">My Bookings</button>
          <button class="btn honey" type="button" data-act="open-booking">🐾 Book Now / Book Service</button>
        </div>
      </div>
    </div>

    <h2>Our services</h2>
    ${serviceCards(s => `<button class="btn sm" data-act="pick" data-id="${s.id}">Select</button>`)}

    <div class="between booking-list-heading" id="my-bookings">
      <h2>My bookings</h2>
      <button class="btn sm honey" type="button" data-act="open-booking">🐾 Book Another Service</button>
    </div>
    <div class="row2 booking-filters">
      <label>Search bookings<input id="clientBookingSearch" type="search" value="${esc(bookingView.search)}" placeholder="Booking ID, service, status"></label>
      <label>Filter by status<select id="clientBookingStatus">
        <option value="">All statuses</option>
        ${STATUSES.map(status => `<option value="${status}" ${bookingView.status === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select></label>
      <label>Filter by date<input id="clientBookingDate" type="date" value="${esc(bookingView.date)}"></label>
    </div>
    <div id="clientBookingList">${clientBookingList()}</div>

    <details class="panel profile-panel">
      <summary><strong>Edit Profile</strong></summary>
      <form data-form="profile" class="profile-form">
        ${errBox}
        <div class="row2">
          <label>First Name<input name="first" maxlength="100" required value="${esc(me.first)}"></label>
          <label>Last Name<input name="last" maxlength="100" required value="${esc(me.last)}"></label>
        </div>
        <label>Email Address<input type="email" value="${esc(me.email)}" readonly></label>
        <label>Contact Number (11 digits)<input name="phone" type="tel" maxlength="11" pattern="[0-9]{11}" inputmode="numeric" required value="${esc(me.phone)}"></label>
        <label>Address<input name="address" maxlength="255" required value="${esc(me.address)}"></label>
        <button class="btn sm" type="submit">Save Changes</button>
      </form>
    </details>
  </div>`;
}

function adminView() {
  const A = S.admin || {};
  const bookings = A.bookings || [];
  const users = A.users || [];
  const admins = A.admins || [];
  const count = st => bookings.filter(b => b.status === st || (st === 'Pending Confirmation' && b.status === 'Pending')).length;

  return `<div class="wrap">
    <section id="overview" class="admin-section">
    <h1>Administrator Dashboard</h1>
    ${showFlash()}
    <div class="stats">
      <div><b>${users.length}</b>Clients</div>
      <div><b>${bookings.length}</b>Bookings</div>
      <div><b>${(A.refunds || []).filter(r => ['Pending', 'Accepted', 'Processing'].includes(r.status)).length}</b>Open refunds</div>
      <div><b>${count('Pending Confirmation')}</b>Pending</div>
      <div><b>${count('Confirmed')}</b>Confirmed</div>
      <div><b>${count('Completed')}</b>Completed</div>
      <div><b>${count('Cancelled')}</b>Cancelled</div>
      <div><b>${A.acceptedToday ?? 0}</b>Accepted today</div>
    </div>

    ${activityTables()}
    </section>

    <section id="bookings" class="admin-section">
    <h2>Bookings</h2>
    <div class="row2" style="margin-bottom:12px">
      <input id="fText" placeholder="Search client, email, service, phone..." value="${esc(filters.text)}">
      <select id="fStatus">
        <option value="">All statuses</option>
        ${STATUSES.map(s => `<option ${filters.status == s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="tbl" id="bookingTable"></div>
    </section>

    <section id="clients" class="admin-section">
    <h2>Client Accounts</h2>
    <div class="tbl">${clientTable()}</div>
    </section>

    <section id="services" class="admin-section">
    <h2>Services</h2>
    <p class="sub">Update a service name, description, or base price. Existing bookings keep their saved prices.</p>
    <div class="tbl">${adminServiceTable()}</div>
    </section>

    <section id="payments" class="admin-section">
    <h2>Payments</h2>
    <p class="sub">Update payment status for the selected booking. Refund completion is managed in Refund Requests.</p>
    <div class="tbl">${paymentTable(bookings)}</div>
    </section>

    <section id="refunds" class="admin-section">
    <h2>Refund Requests</h2>
    <p class="sub">Refund statuses are tracked here only. Processing or marking a refund as refunded does not send GCash automatically.</p>
    <div class="tbl" id="refundTable">${refundTable()}</div>
    </section>

    <section id="notifications" class="admin-section">
    <h2>Booking Notifications</h2>
    <p class="sub">Confirmed bookings awaiting the client's dashboard acknowledgement.</p>
    <div class="tbl">${bookingNotificationTable(bookings)}</div>
    </section>

    <section class="admin-section">
    <h2>Create another admin account</h2>
    <form class="panel" data-form="admin-add">${errBox}
      <div class="row2">
        <label>Admin Email<input type="email" name="email" placeholder="newadmin@pawsandstay.com" required></label>
        <label>Password (8+ chars, 1 num, 1 spec)
          <input type="password" name="pw" placeholder="Admin password" required>
        </label>
      </div>
      <div><button class="btn sm">Create admin</button></div>
    </form>
    <p class="sub">Admins: ${admins.map(esc).join(', ')}</p>
    </section>
  </div>`;
}

function adminServiceTable() {
  return `<table><tr><th>Service</th><th>Description</th><th>Base Price</th><th>Save</th></tr>
    ${(SERVICES || []).map(serviceItem => `<tr>
      <td><input form="service-${serviceItem.id}" name="name" maxlength="100" required value="${esc(serviceItem.name)}"></td>
      <td><input form="service-${serviceItem.id}" name="desc" maxlength="255" required value="${esc(serviceItem.desc)}"></td>
      <td><input form="service-${serviceItem.id}" name="price" type="number" min="1" max="1000000" required value="${Number(serviceItem.price)}"></td>
      <td><form id="service-${serviceItem.id}" data-form="admin-service" data-service-id="${serviceItem.id}"><button class="btn sm" type="submit">Save Service</button></form></td>
    </tr>`).join('')}</table>`;
}

function paymentTable(bookings) {
  return `<table><tr><th>Booking / Client</th><th>Method / Amount</th><th>Payment Status</th><th>GCash Reference</th><th>Receipt</th></tr>
    ${bookings.map(booking => `<tr>
      <td>#${booking.id} · ${esc(fullName(booking.client || {}))}<br><small>${esc(booking.client?.email || '')}</small></td>
      <td>${esc(booking.paymentMethod || 'Cash')} · ${money(booking.totalPrice || booking.price)}${booking.paymentDate ? `<br><small>Paid ${when(booking.paymentDate)}</small>` : ''}</td>
      <td><select data-pay-status="${booking.id}">
        ${['Pending', 'Paid', 'Confirmed', 'Cancelled'].map(status => `<option value="${status}" ${booking.paymentStatus === status ? 'selected' : ''}>${status}</option>`).join('')}
        ${booking.paymentStatus === 'Refunded' ? '<option value="Refunded" selected disabled>Refunded</option>' : ''}
      </select></td>
      <td>${esc(booking.gcashReference || '—')}</td>
      <td>${booking.paymentReceipt ? `<button type="button" class="receipt-btn" data-act="view-receipt" data-url="${esc(booking.paymentReceipt)}">View Receipt</button>` : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5">No payments found.</td></tr>'}</table>`;
}

function bookingNotificationTable(bookings) {
  const pending = bookings.filter(booking => booking.status === 'Confirmed' && !Number(booking.clientNotified));
  return `<table><tr><th>Client</th><th>Booking</th><th>Appointment</th><th>Notification</th></tr>
    ${pending.map(booking => `<tr>
      <td>${esc(fullName(booking.client || {}))}<br><small>${esc(booking.client?.email || '')}</small></td>
      <td>#${booking.id} · ${(booking.services || []).map(item => esc(item.name)).join(', ')}</td>
      <td>${formatHumanDate(booking.date)} · ${formatHumanTime(booking.time)}</td>
      <td>Confirmation is waiting in the client's dashboard</td>
    </tr>`).join('') || '<tr><td colspan="4">No unread booking confirmations.</td></tr>'}</table>`;
}

function activityTables() {
  const A = S.admin || {};
  const logins = A.logins || [];
  const users = A.users || [];
  const bookings = A.bookings || [];
  const loginRows = logins.map(l => `<tr><td>${esc(fullName(l))}</td><td>${esc(l.email || '')}</td><td>${when(l.at)}</td></tr>`).join('');
  const bookerRows = users.filter(u => bookings.some(b => b.uid == u.id)).map(u => {
    const bs = bookings.filter(b => b.uid == u.id);
    const last = bs.map(b => b.created || '').sort().pop();
    return `<tr><td>${esc(u.first + ' ' + u.last)}</td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td><td>${bs.length}</td><td>${bs.filter(b => b.status == 'Cancelled').length}</td><td>${when(last)}</td></tr>`;
  }).join('');

  return `<h2>Customers who logged in</h2>
    <div class="tbl"><table><tr><th>Customer</th><th>Email</th><th>Logged in</th></tr>${loginRows || '<tr><td colspan="3">No customer logins yet.</td></tr>'}</table></div>
    <h2>Customers who booked</h2>
    <div class="tbl"><table><tr><th>Customer</th><th>Email</th><th>Phone</th><th>Bookings</th><th>Cancelled</th><th>Last booked</th></tr>${bookerRows || '<tr><td colspan="6">No bookings yet.</td></tr>'}</table></div>`;
}

function clientTable() {
  const A = S.admin || {};
  const users = A.users || [];
  const bookings = A.bookings || [];
  const rows = users.map(u => `<tr><td>${esc(u.first + ' ' + u.last)}</td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td><td>${esc(u.address)}</td><td>${bookings.filter(b => b.uid == u.id).length}</td></tr>`).join('');
  return `<table><tr><th>Name</th><th>Email</th><th>Contact Number</th><th>Address</th><th>Bookings</th></tr>${rows || '<tr><td colspan="5">No clients yet.</td></tr>'}</table>`;
}

function bookingTable() {
  const q = filters.text.toLowerCase();
  const bookings = S.admin?.bookings || [];
  const list = bookings.filter(b => {
    const svcs = (b.services || []).map(s => s.name).join(' ');
    const str = [b.client?.first + ' ' + b.client?.last, b.client?.email, b.client?.phone, b.client?.address, svcs, b.gcashReference].join(' ').toLowerCase();
    const matchStatus = !filters.status || b.status === filters.status || (filters.status === 'Pending Confirmation' && b.status === 'Pending');
    return matchStatus && str.includes(q);
  });

  $('#bookingTable').innerHTML = `<table>
    <tr>
      <th>Client Details</th>
      <th>Selected Services</th>
      <th>Appointment</th>
      <th>Payment Info</th>
      <th>Status</th>
      <th>Actions</th>
    </tr>
    ${list.map(b => {
      const svcs = (b.services && b.services.length) ? b.services : [service(b.sid)];
      const svcHtml = svcs.map(s => `• ${esc(s.name)} (${money(s.price)})`).join('<br>') + `<br><strong>Total: ${money(b.totalPrice || b.price)}</strong>`;
      const isPending = b.status === 'Pending Confirmation' || b.status === 'Pending';
      const statusCls = b.status.toLowerCase().replace(/\s+/g, '-');
      const payCls = String(b.paymentMethod || 'cash').toLowerCase();

      return `<tr>
        <td>
          <strong>Booking #${b.id}</strong><br>
          <strong>${esc(b.client ? b.client.first + ' ' + b.client.last : 'Customer')}</strong><br>
          <small>📧 ${esc(b.client?.email || '')}<br>📞 ${esc(b.client?.phone || '')}<br>📍 ${esc(b.client?.address || '')}</small>
        </td>
        <td>
          <div style="font-size:13.5px">${svcHtml}</div>
          ${b.notes ? `<small style="color:var(--soft);display:block;margin-top:4px"><em>Notes:</em> ${esc(b.notes)}</small>` : ''}
        </td>
        <td>
          <strong>${formatHumanDate(b.date)}</strong><br>
          <small>${formatHumanTime(b.time)}</small><br>
          <small style="color:var(--soft)">Booked: ${when(b.created)}</small>
        </td>
        <td>
          <span class="badge ${payCls}">${esc(b.paymentMethod || 'Cash')}</span><br>
          <strong>${money(b.totalPrice || b.price)}</strong><br>
          ${b.paymentDate ? `<small>Payment date: ${when(b.paymentDate)}</small><br>` : ''}
          <select style="font-size:12px;padding:4px 6px;margin:4px 0" data-pay-status="${b.id}">
            ${['Pending', 'Paid', 'Confirmed', 'Cancelled'].map(ps => `<option value="${ps}" ${b.paymentStatus === ps ? 'selected' : ''}>Payment: ${ps}</option>`).join('')}
            ${b.paymentStatus === 'Refunded' ? '<option value="Refunded" selected disabled>Payment: Refunded</option>' : ''}
          </select>
          ${b.gcashReference ? `<br><small><strong>GCash Ref:</strong> ${esc(b.gcashReference)}</small>` : ''}
          ${b.paymentReceipt ? `<br><button class="receipt-btn" data-act="view-receipt" data-url="${esc(b.paymentReceipt)}">🖼️ View Receipt</button>` : ''}
        </td>
        <td>
          <select class="badge ${statusCls}" data-status="${b.id}">
            ${STATUSES.map(s => `<option value="${s}" ${(b.status === s || (s === 'Pending Confirmation' && b.status === 'Pending')) ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          ${b.confirmedAt ? `<br><small>Confirmed: ${when(b.confirmedAt)}</small>` : ''}
          ${b.cancelledAt ? `<br><small>Cancelled: ${when(b.cancelledAt)} (${esc(b.cancelledBy || '')})</small>` : ''}
        </td>
        <td>
          <button class="btn sm ghost" type="button" data-act="booking-details" data-id="${b.id}">View Details</button><br>
          ${isPending ? `<button class="btn sm honey" data-act="confirm-booking" data-id="${b.id}" style="margin-bottom:6px">✅ Confirm Booking</button><br>` : ''}
          ${isPending ? `<button class="btn sm danger" type="button" data-act="reject-booking" data-id="${b.id}" style="margin-bottom:6px">Reject Booking</button><br>` : ''}
          <button class="btn sm danger" data-act="delete" data-id="${b.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="6">No bookings found.</td></tr>'}
  </table>`;
}

function refundTable() {
  const refunds = S.admin?.refunds || [];
  return `<table>
    <tr><th>Refund ID</th><th>Client</th><th>Booking ID / Service(s)</th><th>Amount</th><th>GCash Reference</th><th>Status</th><th>Admin Note</th><th>Action</th></tr>
    ${refunds.map(r => `<tr>
      <td>#${r.id}<br><small>Requested ${when(r.requestedAt)}</small></td>
      <td>${esc(r.firstName)} ${esc(r.lastName)}<br>${esc(r.email)}<br>
        <button type="button" class="btn sm ghost" data-act="refund-details" data-id="${r.id}">View</button>
      </td>
      <td>#${r.booking_id}<br>${(r.services || []).map(s => esc(s.name)).join(', ')}</td>
      <td>${money(r.amount)}</td>
      <td>${esc(r.gcashReference || '—')}</td>
      <td>
        <span class="badge refund-${String(r.status).toLowerCase()}">${esc(r.status)}</span><br>
        ${r.updatedAt ? `<small>Updated: ${when(r.updatedAt)}</small>` : ''}
      </td>
      <td><textarea rows="2" maxlength="1000" data-refund-note="${r.id}" placeholder="Admin note">${esc(r.adminNote)}</textarea>
        <small>Payment: ${esc(r.paymentMethod)} · ${esc(r.paymentStatus)}</small>
      </td>
      <td>
        <button type="button" class="btn sm ghost" data-act="save-refund-note" data-id="${r.id}">Save Admin Note</button>
        ${r.status === 'Pending' ? `<button type="button" class="btn sm honey" data-act="accept-refund" data-id="${r.id}">Approve Refund</button>
          <button type="button" class="btn sm danger" data-act="reject-refund" data-id="${r.id}">Reject Refund</button>
          <button type="button" class="btn sm danger" data-act="cancel-refund" data-id="${r.id}">Cancel Request</button>` : ''}
        ${r.status === 'Accepted' ? `<button type="button" class="btn sm honey" data-act="process-refund" data-id="${r.id}">Mark as Processing</button>` : ''}
        ${r.status === 'Processing' ? `<button type="button" class="btn sm honey" data-act="complete-refund" data-id="${r.id}">Mark as Refunded</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="8">No refund requests.</td></tr>'}
  </table>`;
}

function openRefundDetails(refundId) {
  const refund = (S.admin?.refunds || []).find(item => Number(item.id) === refundId);
  if (!refund) return fail('Refund details are unavailable. Refresh the admin dashboard and try again.');
  const services = (refund.services || []).map(s => `${esc(s.name)} (${money(s.price)})`).join(', ') || 'Service details unavailable';
  $('#modalContainer').innerHTML = `
    <div class="modal-backdrop" data-act="close-booking-details">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="refundDetailTitle">
        <div class="modal-header">
          <div><h3 id="refundDetailTitle">Refund #${refund.id} · Booking #${refund.booking_id}</h3>
          <small class="badge refund-${String(refund.status).toLowerCase()}">${esc(refund.status)}</small></div>
          <button type="button" class="modal-close" data-act="close-booking-details" aria-label="Close">✕</button>
        </div>
        <div class="modal-body"><div class="summary-card">
          <h4>Client</h4>
          <div class="summary-row"><span>Name</span><strong>${esc(refund.firstName)} ${esc(refund.lastName)}</strong></div>
          <div class="summary-row"><span>Email / phone</span><strong>${esc(refund.email)} · ${esc(refund.phone)}</strong></div>
          <div class="summary-row"><span>Address</span><strong>${esc(refund.address || '')}</strong></div>
          <h4>Booking</h4>
          <div class="summary-row"><span>Services</span><strong>${services}</strong></div>
          <div class="summary-row"><span>Date / time</span><strong>${formatHumanDate(refund.bookingDate)} at ${formatHumanTime(refund.bookingTime)}</strong></div>
          <div class="summary-row"><span>Booking status</span><strong>${esc(refund.bookingStatus)}</strong></div>
          <h4>Payment</h4>
          <div class="summary-row"><span>Method / amount</span><strong>${esc(refund.paymentMethod)} · ${money(refund.amount)}</strong></div>
          <div class="summary-row"><span>Payment status</span><strong>${esc(refund.paymentStatus)}</strong></div>
          <div class="summary-row"><span>GCash reference</span><strong>${esc(refund.gcashReference || '—')}</strong></div>
          <div class="summary-row"><span>Payment date</span><strong>${when(refund.paymentDate)}</strong></div>
          <h4>Refund</h4>
          <div class="summary-row"><span>Reason</span><strong>${esc(refund.reason)}</strong></div>
          <div class="summary-row"><span>Client message</span><span>${esc(refund.clientMessage || '—')}</span></div>
          <div class="summary-row"><span>Requested</span><strong>${when(refund.requestedAt)}</strong></div>
          <div class="summary-row"><span>Last updated</span><strong>${when(refund.updatedAt)}</strong></div>
          ${refund.approvedAt ? `<div class="summary-row"><span>Accepted</span><strong>${when(refund.approvedAt)}</strong></div>` : ''}
          ${refund.processedAt ? `<div class="summary-row"><span>Processing started</span><strong>${when(refund.processedAt)}</strong></div>` : ''}
          ${refund.refundedAt ? `<div class="summary-row"><span>Marked refunded</span><strong>${when(refund.refundedAt)}</strong></div>` : ''}
          <div class="summary-row"><span>Admin note / rejection reason</span><span>${esc(refund.adminNote || '—')}</span></div>
        </div></div>
        <div class="modal-footer"><button type="button" class="btn ghost" data-act="close-booking-details">Close</button></div>
      </section>
    </div>`;
}

function openBookingDetails(bookingId) {
  const booking = (S.bookings || []).find(item => Number(item.id) === bookingId)
    || (S.admin?.bookings || []).find(item => Number(item.id) === bookingId);
  if (!booking) return fail('Booking details are unavailable. Refresh the dashboard and try again.');
  const services = booking.services?.length ? booking.services : [service(booking.sid)];
  const isClient = S.session?.role === 'user';
  const content = `
    <div class="modal-backdrop" id="bookingDetailBackdrop" data-act="close-booking-details">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="bookingDetailTitle">
        <div class="modal-header">
          <div><h3 id="bookingDetailTitle">Booking #${booking.id}</h3><small>${esc(booking.status)}</small></div>
          <button type="button" class="modal-close" data-act="close-booking-details" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="summary-card">
            <div class="summary-row"><span>Service(s)</span><strong>${services.map(s => esc(s.name)).join(', ')}</strong></div>
            <div class="summary-row"><span>Date and time</span><strong>${formatHumanDate(booking.date)} at ${formatHumanTime(booking.time)}</strong></div>
            <div class="summary-row"><span>Total</span><strong>${money(booking.totalPrice || booking.price)}</strong></div>
            <div class="summary-row"><span>Booking status</span><span class="badge">${esc(booking.status)}</span></div>
            <div class="summary-row"><span>Payment</span><strong>${esc(booking.paymentMethod || 'Cash')} · ${esc(booking.paymentStatus || 'Pending')}</strong></div>
            ${booking.paymentDate ? `<div class="summary-row"><span>Payment date</span><strong>${when(booking.paymentDate)}</strong></div>` : ''}
            ${booking.gcashReference ? `<div class="summary-row"><span>GCash reference</span><strong>${esc(booking.gcashReference)}</strong></div>` : ''}
            ${booking.notes ? `<div class="summary-row"><span>Notes</span><span>${esc(booking.notes)}</span></div>` : ''}
            <div class="summary-row"><span>Refund</span><strong>${esc(booking.refundStatus || 'Not requested')}</strong></div>
            ${booking.refundAmount != null ? `<div class="summary-row"><span>Refund amount</span><strong>${money(booking.refundAmount)}</strong></div>` : ''}
            ${booking.refundReason ? `<div class="summary-row"><span>Refund reason</span><span>${esc(booking.refundReason)}</span></div>` : ''}
            ${booking.refundMessage ? `<div class="summary-row"><span>Client message</span><span>${esc(booking.refundMessage)}</span></div>` : ''}
            ${booking.refundAdminNote ? `<div class="summary-row"><span>Admin note / rejection reason</span><span>${esc(booking.refundAdminNote)}</span></div>` : ''}
            ${booking.refundRequestedAt ? `<div class="summary-row"><span>Refund requested</span><strong>${when(booking.refundRequestedAt)}</strong></div>` : ''}
            ${booking.refundApprovedAt ? `<div class="summary-row"><span>Refund accepted</span><strong>${when(booking.refundApprovedAt)}</strong></div>` : ''}
            ${booking.refundProcessedAt ? `<div class="summary-row"><span>Refund processing</span><strong>${when(booking.refundProcessedAt)}</strong></div>` : ''}
            ${booking.refundRefundedAt ? `<div class="summary-row"><span>Refund completed</span><strong>${when(booking.refundRefundedAt)}</strong></div>` : ''}
            ${booking.refundUpdatedAt ? `<div class="summary-row"><span>Refund last updated</span><strong>${when(booking.refundUpdatedAt)}</strong></div>` : ''}
            ${booking.paymentReceipt ? `<div class="summary-row"><span>Receipt</span><button type="button" class="receipt-btn" data-act="view-receipt" data-url="${esc(booking.paymentReceipt)}">View Receipt</button></div>` : ''}
          </div>
        </div>
        <div class="modal-footer">
          ${isClient && refundCanBeRequested(booking) ? `<button type="button" class="btn honey" data-act="request-refund" data-id="${booking.id}">Request Refund</button>` : ''}
          ${isClient ? `<button type="button" class="btn" data-act="book-another-from-details">Book Another Service</button>` : ''}
          <button type="button" class="btn ghost" data-act="close-booking-details">Close</button>
        </div>
      </section>
    </div>`;
  $('#modalContainer').innerHTML = content;
}

function openRefundRequest(bookingId) {
  const booking = S.bookings.find(item => Number(item.id) === bookingId);
  if (!booking || !refundCanBeRequested(booking)) {
    return fail('This booking is not currently eligible for a refund request.');
  }
  const services = booking.services?.length ? booking.services.map(s => s.name).join(', ') : service(booking.sid).name;
  $('#modalContainer').innerHTML = `
    <div class="modal-backdrop" data-act="close-refund-request">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="refundRequestTitle">
        <div class="modal-header">
          <h3 id="refundRequestTitle">Request Refund · Booking #${booking.id}</h3>
          <button type="button" class="modal-close" data-act="close-refund-request" aria-label="Close">✕</button>
        </div>
        <form data-form="refund-request" data-booking-id="${booking.id}">
          <div class="modal-body">
            <div class="summary-card">
              <div class="summary-row"><span>Service(s)</span><strong>${esc(services)}</strong></div>
              <div class="summary-row"><span>Booking date/time</span><strong>${formatHumanDate(booking.date)} at ${formatHumanTime(booking.time)}</strong></div>
              <div class="summary-row"><span>Amount paid</span><strong>${money(booking.totalPrice || booking.price)}</strong></div>
              <div class="summary-row"><span>Payment method</span><strong>${esc(booking.paymentMethod)}</strong></div>
              <div class="summary-row"><span>Original GCash reference</span><strong>${esc(booking.gcashReference)}</strong></div>
            </div>
            <p class="sub">Refunds are reviewed by staff. No automatic GCash refund is sent by this website.</p>
            <label>Reason for refund<textarea name="reason" maxlength="1000" rows="4" required></textarea></label>
            <label>Additional message (optional)<textarea name="message" maxlength="1000" rows="3"></textarea></label>
            <div class="err" data-form-error hidden></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn ghost" data-act="close-refund-request">Cancel</button>
            <button type="submit" class="btn honey">Submit Refund Request</button>
          </div>
        </form>
      </section>
    </div>`;
}

/* ============ E. BOOKING POP-UP MODAL ENGINE ============ */
const BookingModal = {
  isOpen: false,
  step: 1, // 1: Services & Time, 2: Payment, 3: Summary, 4: Success
  selectedServices: new Set(),
  date: '',
  time: '',
  notes: '',
  phone: '',
  payMethod: 'Cash',
  paymentAmount: '',
  gcashRef: '',
  receiptFile: null,
  receiptPreviewUrl: '',
  bookedTimes: [],
  availabilityError: '',
  serverToday: '',
  serverCurrentTime: '',

  init() {
    this.selectedServices.clear();
    this.step = 1;
    this.date = today();
    this.time = '09:00';
    this.notes = '';
    this.phone = S.session?.user?.phone || '';
    this.payMethod = 'Cash';
    this.paymentAmount = '';
    this.gcashRef = '';
    this.receiptFile = null;
    this.receiptPreviewUrl = '';
    this.bookedTimes = [];
    this.availabilityError = '';
    this.serverToday = '';
    this.serverCurrentTime = '';
    this.createdBookingId = null;
  },

  open(preselectedId) {
    if (!S.session || S.session.role !== 'user') {
      location.hash = '#/login';
      return;
    }
    this.init();
    if (preselectedId) {
      this.selectedServices.add(Number(preselectedId));
    } else if (SERVICES.length) {
      this.selectedServices.add(SERVICES[0].id);
    }
    this.isOpen = true;
    this.fetchBookedTimes(this.date).then(() => this.render());
  },

  close() {
    this.isOpen = false;
    $('#modalContainer').innerHTML = '';
  },

  async fetchBookedTimes(dateStr) {
    if (!dateStr) return;
    try {
      const res = await api('GET', `/api/availability?date=${encodeURIComponent(dateStr)}`);
      this.bookedTimes = Array.isArray(res?.bookedTimes) ? res.bookedTimes : [];
      this.serverToday = res.today || today();
      this.serverCurrentTime = res.currentTime || currentTime();
      this.availabilityError = '';
    } catch (err) {
      this.availabilityError = err.message || 'Unable to check appointment availability.';
    }
  },

  getTotalPrice() {
    let total = 0;
    this.selectedServices.forEach(id => {
      const s = (SERVICES || []).find(x => x.id == id);
      if (s) total += s.price;
    });
    return total;
  },

  render() {
    if (!this.isOpen) return;
    const total = this.getTotalPrice();
    const user = S.session?.user || {};

    let stepContent = '';

    if (this.step === 1) {
      const timeSlots = [
        '08:00', '09:00', '10:00', '11:00', '12:00',
        '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'
      ];

      stepContent = `
        ${this.availabilityError ? `<div class="err" role="alert">${esc(this.availabilityError)} <button type="button" class="btn sm ghost" data-act="retry-availability">Retry</button></div>` : ''}
        <div class="steps-nav">
          <div class="step-indicator active"><span class="step-dot">1</span> Services &amp; Time</div>
          <div class="step-indicator"><span class="step-dot">2</span> Payment</div>
          <div class="step-indicator"><span class="step-dot">3</span> Summary</div>
        </div>

        <div style="background:var(--sage);padding:10px 14px;border-radius:12px;margin-bottom:14px;font-size:13.5px">
          👤 Booking for: <strong>${esc(fullName(user))}</strong> · Email: <strong>${esc(user.email)}</strong>
        </div>

        <label style="margin-bottom:4px">Select One or Multiple Services *</label>
        <div class="service-list">
          ${(SERVICES || []).map(s => {
            const isChecked = this.selectedServices.has(s.id);
            return `<label class="service-select-item ${isChecked ? 'selected' : ''}">
              <input type="checkbox" name="modal_svc" value="${s.id}" ${isChecked ? 'checked' : ''} onchange="BookingModal.toggleService(${s.id})">
              <div class="service-item-info">
                <strong>${esc(s.name)}</strong>
                <small>${esc(s.desc)}</small>
              </div>
              <div class="service-item-price">${money(s.price)}</div>
            </label>`;
          }).join('')}
        </div>

        <div class="total-bar">
          <span>Selected Services: <strong>${this.selectedServices.size}</strong></span>
          <span>Total Amount: <strong id="modalTotalBar">${money(total)}</strong></span>
        </div>

        <div class="row2" style="margin-top:14px">
          <label>Appointment Date *
            <input type="date" id="mDate" min="${today()}" value="${this.date}" required onchange="BookingModal.onDateChange(this.value)">
          </label>
          <label>Appointment Time *
            <select id="mTime" required onchange="BookingModal.onTimeChange(this.value)">
              <option value="">Select a time slot</option>
              ${timeSlots.map(t => {
                const isBooked = this.bookedTimes.includes(t);
                const isPastToday = this.date === this.serverToday && t <= this.serverCurrentTime;
                const isSelected = this.time === t;
                return `<option value="${t}" ${isBooked || isPastToday ? 'disabled' : ''} ${isSelected ? 'selected' : ''}>
                  ${formatHumanTime(t)} ${isBooked ? '(Booked - Unavailable)' : isPastToday ? '(Past - Unavailable)' : '— Available'}
                </option>`;
              }).join('')}
            </select>
          </label>
        </div>

        <label style="margin-top:10px">Contact Number (11 digits) *
          <input type="tel" id="mPhone" value="${esc(this.phone || user.phone || '')}" maxlength="11" pattern="\\d{11}" inputmode="numeric" placeholder="09123456789" required oninput="BookingModal.onPhoneInput(this)">
          <span class="field-hint">Numbers only. Example: 09123456789</span>
        </label>

        <label style="margin-top:10px">Notes / Special Requests (Optional)
          <textarea id="mNotes" maxlength="500" rows="2" placeholder="e.g. My dog is sensitive around the ears, gate passcode, etc." oninput="BookingModal.notes = this.value">${esc(this.notes)}</textarea>
        </label>
      `;
    } else if (this.step === 2) {
      if (this.payMethod === 'GCash' && !this.paymentAmount) {
        this.paymentAmount = String(total);
      }
      stepContent = `
        <div class="steps-nav">
          <div class="step-indicator done"><span class="step-dot">✓</span> Services &amp; Time</div>
          <div class="step-indicator active"><span class="step-dot">2</span> Payment</div>
          <div class="step-indicator"><span class="step-dot">3</span> Summary</div>
        </div>

        <label>Select Mode of Payment *</label>
        <div class="payment-methods-grid">
          <div class="pay-card ${this.payMethod === 'Cash' ? 'active' : ''}" onclick="BookingModal.setPayMethod('Cash')">
            <span style="font-size:24px">💵</span>
            <strong>Cash on Visit</strong>
            <small class="sub">Pay at scheduled appointment</small>
          </div>
          <div class="pay-card ${this.payMethod === 'GCash' ? 'active' : ''}" onclick="BookingModal.setPayMethod('GCash')">
            <span style="font-size:24px">📱</span>
            <strong>GCash</strong>
            <small class="sub">Submit the reference and receipt for staff verification</small>
          </div>
        </div>

        ${this.payMethod === 'Cash' ? `
          <div class="cash-box">
            <strong>💵 Cash Payment Selected</strong>
            <p style="margin-top:6px">Payment will be made in cash at the scheduled appointment. Receipt upload is not required.</p>
          </div>
        ` : `
          <div class="gcash-box">
            <h4>📱 GCash Payment Instructions</h4>
            <div class="gcash-detail-row"><span>Account Name:</span><strong>Paws &amp; Stay Boutique</strong></div>
            <div class="gcash-detail-row"><span>GCash Number:</span><strong>0912 345 6789</strong></div>
            <div class="gcash-detail-row"><span>Amount to Pay:</span><strong style="color:var(--honey-d);font-size:16px">${money(total)}</strong></div>
            <p style="font-size:12.5px;color:var(--soft);margin-top:8px">After paying with your GCash app, enter the 15-digit transaction reference and upload the receipt. Staff will verify payment; this website does not process GCash transactions automatically.</p>
          </div>

          <label>Payment amount (PHP) *
            <input type="number" id="mPaymentAmount" name="payment_amount" min="1" step="1" value="${esc(this.paymentAmount || total)}" required oninput="BookingModal.onPaymentAmountInput(this)">
            <span class="field-hint">Enter the amount shown above for your selected services.</span>
          </label>

          <label>GCash Reference Number *
            <input type="text" id="mGcashRef" name="gcash_reference" placeholder="15 digits" value="${esc(this.gcashRef)}" maxlength="15" pattern="[0-9]{15}" inputmode="numeric" autocomplete="off" aria-describedby="mGcashRefHint" required oninput="BookingModal.onGcashInput(this)">
            <span class="field-hint" id="mGcashRefHint" aria-live="polite">Enter exactly 15 digits (numbers only).</span>
          </label>

          <label style="margin-top:12px">Upload Payment Receipt (JPG, PNG) *
            <input type="file" id="mReceiptFile" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onchange="BookingModal.onFileSelect(event)">
            <span class="field-hint">Max file size: 5MB. Formats: JPG, JPEG, PNG</span>
          </label>

          ${this.receiptPreviewUrl ? `
            <div class="receipt-preview-container">
              <img src="${this.receiptPreviewUrl}" alt="Receipt Preview">
              <div>
                <strong class="receipt-file-name">${esc(this.receiptFile?.name || 'receipt.jpg')}</strong><br>
                <small class="sub">Receipt attached successfully</small>
              </div>
            </div>
          ` : ''}
        `}
      `;
    } else if (this.step === 3) {
      const selectedList = (SERVICES || []).filter(s => this.selectedServices.has(s.id));

      stepContent = `
        <div class="steps-nav">
          <div class="step-indicator done"><span class="step-dot">✓</span> Services &amp; Time</div>
          <div class="step-indicator done"><span class="step-dot">✓</span> Payment</div>
          <div class="step-indicator active"><span class="step-dot">3</span> Summary</div>
        </div>

        <h4 style="margin-bottom:12px">Review Booking Summary</h4>
        <div class="summary-card">
          <div class="summary-row">
            <span>Customer:</span>
            <strong>${esc(fullName(user))} (${esc(this.phone)})</strong>
          </div>
          <div class="summary-row">
            <span>Selected Services:</span>
            <div style="text-align:right">
              ${selectedList.map(s => `<div>${esc(s.name)} — ${money(s.price)}</div>`).join('')}
            </div>
          </div>
          <div class="summary-row">
            <span>Total Price:</span>
            <strong style="color:var(--honey-d);font-size:17px">${money(total)}</strong>
          </div>
          <div class="summary-row">
            <span>Appointment:</span>
            <strong>${formatHumanDate(this.date)} at ${formatHumanTime(this.time)}</strong>
          </div>
          <div class="summary-row">
            <span>Mode of Payment:</span>
            <strong class="badge ${this.payMethod.toLowerCase()}">${this.payMethod}</strong>
          </div>
          ${this.payMethod === 'GCash' ? `
            <div class="summary-row">
              <span>GCash Reference:</span>
              <strong>${esc(this.gcashRef)}</strong>
            </div>
            ${this.receiptPreviewUrl ? `
              <div class="summary-row">
                <span>Payment Receipt:</span>
                <img src="${this.receiptPreviewUrl}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;border:1px solid var(--line)" alt="Receipt">
              </div>
            ` : ''}
          ` : ''}
          ${this.notes ? `
            <div class="summary-row">
              <span>Notes:</span>
              <span style="max-width:60%;text-align:right">${esc(this.notes)}</span>
            </div>
          ` : ''}
          <div class="summary-row">
            <span>Initial Status:</span>
            <span class="badge pending-confirmation">Pending Confirmation</span>
          </div>
        </div>
      `;
    } else if (this.step === 4) {
      stepContent = `
        <div class="success-box">
          <div class="celebrate-icon">🐾</div>
          <h2>Booking Request Submitted!</h2>
          <p class="sub" style="margin:12px 0 16px;font-size:15.5px">
            Your booking request has been submitted successfully. Please wait for the admin to confirm your booking.
          </p>
          <div class="confirm-details">
            <p><strong>Booking ID:</strong> #${this.createdBookingId || '—'}</p>
            <p><strong>Appointment:</strong> ${formatHumanDate(this.date)} at ${formatHumanTime(this.time)}</p>
            <p><strong>Total Amount:</strong> ${money(total)}</p>
            <p><strong>Status:</strong> <span class="badge pending-confirmation">Pending Confirmation</span></p>
          </div>
          <button class="btn full-width" onclick="BookingModal.close(); draw();">View My Bookings</button>
        </div>
      `;
    }

    let footerButtons = '';
    if (this.step === 1) {
      footerButtons = `
        <button type="button" class="btn ghost" onclick="BookingModal.close()">Cancel</button>
        <button type="button" class="btn" onclick="BookingModal.submitStep1()">Submit Booking</button>
      `;
    } else if (this.step === 2) {
      footerButtons = `
        <button type="button" class="btn ghost" onclick="BookingModal.step = 1; BookingModal.render();">Back</button>
        <button type="button" class="btn" onclick="BookingModal.submitStep2()">Continue to Summary</button>
      `;
    } else if (this.step === 3) {
      footerButtons = `
        <button type="button" class="btn ghost" onclick="BookingModal.step = 2; BookingModal.render();">Back</button>
        <button type="button" class="btn honey" id="confirmBookingBtn" onclick="BookingModal.submitFinalBooking()">Confirm Booking Request</button>
      `;
    }

    $('#modalContainer').innerHTML = `
      <div class="modal-backdrop" onclick="if(event.target === this) BookingModal.close()">
        <div class="modal-card">
          <div class="modal-header">
            <div>
              <h3>🐾 Book Pet Care Service</h3>
              <small class="sub">Paws &amp; Stay Boutique Care</small>
            </div>
            <button type="button" class="modal-close" onclick="BookingModal.close()" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="err" id="mErr" hidden></div>
            ${stepContent}
          </div>
          ${footerButtons ? `<div class="modal-footer">${footerButtons}</div>` : ''}
        </div>
      </div>
    `;
  },

  modalFail(msg) {
    const el = $('#mErr');
    if (el) {
      el.textContent = msg;
      el.hidden = false;
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      alert(msg);
    }
  },

  toggleService(id) {
    if (this.selectedServices.has(id)) {
      if (this.selectedServices.size > 1) this.selectedServices.delete(id);
      else alert('Please keep at least one service selected.');
    } else {
      this.selectedServices.add(id);
    }
    this.render();
  },

  async onDateChange(val) {
    this.date = val;
    await this.fetchBookedTimes(val);
    this.render();
  },

  onTimeChange(val) {
    this.time = val;
  },

  onPhoneInput(input) {
    input.value = input.value.replace(/\D/g, '').slice(0, 11);
    this.phone = input.value;
  },

  setPayMethod(method) {
    this.payMethod = method;
    this.render();
  },

  onPaymentAmountInput(input) {
    this.paymentAmount = input.value;
  },

  onGcashInput(input) {
    input.value = input.value.replace(/[^0-9]/g, '').slice(0, 15);
    this.gcashRef = input.value;
    const error = validateGcashReference(this.gcashRef);
    input.setCustomValidity(error || '');
    const hint = $('#mGcashRefHint');
    if (hint) {
      hint.textContent = error || 'Reference number accepted.';
      hint.classList.toggle('err', Boolean(error));
    }
  },

  onFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!/\.(jpg|jpeg|png)$/i.test(file.name)) {
      alert('Please upload a valid image file (JPG, JPEG, or PNG).');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Receipt image size exceeds the 5MB limit.');
      e.target.value = '';
      return;
    }

    this.receiptFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      this.receiptPreviewUrl = ev.target.result;
      this.render();
    };
    reader.readAsDataURL(file);
  },

  submitStep1() {
    if (this.selectedServices.size === 0) {
      return this.modalFail('Please select at least one service.');
    }
    if (!this.date || this.date < today()) {
      return this.modalFail('Please choose a valid future date.');
    }
    if (!this.time) {
      return this.modalFail('Please select an appointment time.');
    }
    if (this.date === this.serverToday && this.time <= this.serverCurrentTime) {
      return this.modalFail('Please select an appointment time later than the current time.');
    }
    if (this.bookedTimes.includes(this.time)) {
      return this.modalFail('This time slot is already booked. Please select another time.');
    }
    const phoneErr = validatePhone(this.phone);
    if (phoneErr) {
      return this.modalFail(phoneErr);
    }

    this.step = 2;
    this.render();
  },

  submitStep2() {
    if (this.payMethod === 'GCash') {
      const referenceError = validateGcashReference(this.gcashRef);
      if (referenceError) return this.modalFail(referenceError);
      if (!Number.isSafeInteger(Number(this.paymentAmount)) || Number(this.paymentAmount) !== this.getTotalPrice()) {
        return this.modalFail('Payment amount must match the total for the selected services.');
      }
      if (!this.receiptFile) {
        return this.modalFail('Please upload your GCash payment receipt image.');
      }
    }
    this.step = 3;
    this.render();
  },

  async submitFinalBooking() {
    const btn = $('#confirmBookingBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting...';
    }

    try {
      if (this.payMethod === 'GCash') {
        const referenceError = validateGcashReference(this.gcashRef);
        if (referenceError) throw new Error(referenceError);
        if (!Number.isSafeInteger(Number(this.paymentAmount)) || Number(this.paymentAmount) !== this.getTotalPrice()) {
          throw new Error('Payment amount must match the total for the selected services.');
        }
      }
      let receiptPath = null;
      if (this.payMethod === 'GCash' && this.receiptFile) {
        const fd = new FormData();
        fd.append('receipt', this.receiptFile);
        const upRes = await api('POST', '/api/upload-receipt', fd);
        receiptPath = upRes.path;
      }

      const payload = {
        services: Array.from(this.selectedServices),
        date: this.date,
        time: this.time,
        notes: this.notes,
        phone: this.phone,
        payment_method: this.payMethod,
        payment_amount: this.payMethod === 'GCash' ? Number(this.paymentAmount) : null,
        gcash_reference: this.payMethod === 'GCash' ? this.gcashRef : null,
        payment_receipt: receiptPath
      };

      const result = await api('POST', '/api/bookings', payload);
      this.createdBookingId = result.id;
      this.step = 4;
      this.render();
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirm Booking Request';
      }
      this.modalFail(err.message || 'Failed to submit booking. Please try again.');
    }
  }
};

/* ============ F. CLIENT CONFIRMATION NOTIFICATION POP-UP ENGINE ============ */
function checkBookingConfirmationNotifications() {
  if (!S.session || S.session.role !== 'user' || $('#confirmNotifBackdrop')) return;
  const bookings = S.bookings || [];

  for (const b of bookings) {
    if (b.status === 'Confirmed' && !Number(b.clientNotified)) {
      showConfirmationPopup(b);
      break;
    }
  }
}

function showConfirmationPopup(b) {
  const svcs = (b.services && b.services.length) ? b.services : [service(b.sid)];
  const svcNames = svcs.map(s => esc(s.name)).join(', ');

  const modalHtml = `
    <div class="modal-backdrop" id="confirmNotifBackdrop">
      <div class="modal-card" style="max-width:480px">
        <div class="modal-body">
          <div class="confirm-popup-card">
            <div class="celebrate-icon">🎉</div>
            <h2 style="font-size:24px;margin-bottom:6px">Booking Confirmed!</h2>
            <p class="sub" style="margin-bottom:16px">Your booking has been confirmed by Paws &amp; Stay.</p>
            <div class="confirm-details">
              <p>🔖 <strong>Booking:</strong> #${b.id}</p>
              <p>📅 <strong>Date:</strong> ${formatHumanDate(b.date)}</p>
              <p>⏰ <strong>Time:</strong> ${formatHumanTime(b.time)}</p>
              <p>🐾 <strong>Services:</strong> ${svcNames}</p>
              <p>💵 <strong>Total:</strong> ${money(b.totalPrice || b.price)}</p>
              <p>📌 <strong>Status:</strong> ${esc(b.status)}</p>
            </div>
            <p style="margin-bottom:20px;font-size:14.5px">We look forward to seeing you and your pet!</p>
            <button class="btn honey full-width" type="button" data-act="view-booking" data-id="${b.id}">View Booking</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const container = $('#modalContainer');
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = modalHtml;
  container.appendChild(tempDiv.firstElementChild);
}

async function viewConfirmedBooking(id, button) {
  button.disabled = true;
  try {
    const result = await api('GET', '/api/bookings');
    const bookings = Array.isArray(result?.bookings) ? result.bookings : [];
    const booking = bookings.find(item => Number(item.id) === id);
    if (!booking || booking.status !== 'Confirmed') {
      throw new Error('This confirmed booking could not be found. Please refresh your dashboard.');
    }

    await api('POST', `/api/bookings/${id}/ack-confirm`);
    booking.clientNotified = 1;
    S.bookings = bookings;
    bookingView = { search: '', status: '', date: '', limit: 10 };
    focusBookingId = id;
    $('#confirmNotifBackdrop')?.remove();
    if (location.hash === '#/dash') {
      await render(true);
      openBookingDetails(id);
    } else {
      location.hash = '#/dash';
      await new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true }));
      openBookingDetails(id);
    }
  } catch (err) {
    button.disabled = false;
    console.error('Could not open confirmed booking:', err);
    fail(err.message || 'Could not open this booking. Please try again.');
  }
}

/* Admin Receipt Lightbox Viewer */
function openReceiptLightbox(url) {
  const modalHtml = `
    <div class="modal-backdrop" id="receiptLightboxBackdrop" onclick="if(event.target===this) this.remove()">
      <div class="lightbox-content">
        <div class="between" style="width:100%;margin-bottom:12px">
          <strong>Payment Receipt</strong>
          <button type="button" class="modal-close" onclick="$('#receiptLightboxBackdrop').remove()">✕</button>
        </div>
        <img src="${esc(url)}" alt="Payment Receipt" class="lightbox-img">
        <div style="margin-top:14px">
          <a class="btn sm" href="${esc(url)}" target="_blank" download>Download Image</a>
        </div>
      </div>
    </div>
  `;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = modalHtml;
  document.body.appendChild(tempDiv.firstElementChild);
}

/* ============ G. ROUTER & RENDER ============ */
async function draw(keepScroll) {
  const id = ++renderId;
  const h = ADMIN_PORTAL ? '#/admin' : (location.hash || '#/');

  try {
    const sData = await api('GET', '/api/services');
    if (Array.isArray(sData?.services) && sData.services.length) {
      SERVICES = sData.services;
    }
  } catch (err) {
    if (!Array.isArray(SERVICES) || !SERVICES.length) {
      SERVICES = [...DEFAULT_SERVICES];
    }
    if (h === '#/dash' || h === '#/admin') throw err;
  }

  let me = { role: null };
  try {
    me = await api('GET', '/api/me');
  } catch (e) {
    if (h === '#/dash' || h === '#/admin') throw e;
  }
  S.session = me && me.role ? me : null;
  const s = S.session;

  if (ADMIN_PORTAL && !(s && s.role === 'admin')) {
    location.replace('admin/login.php');
    return;
  }
  if (!ADMIN_PORTAL && s?.role === 'admin') {
    location.replace('admin/index.php#overview');
    return;
  }
  if (h === '#/dash' && !(s && s.role === 'user')) return void (location.hash = '#/login');
  if (h === '#/admin' && !ADMIN_PORTAL) return void (location.replace('admin/login.php'));

  if (h === '#/dash') {
    const bData = await api('GET', '/api/bookings');
    S.bookings = Array.isArray(bData?.bookings) ? bData.bookings : [];
  }
  if (h === '#/admin') {
    S.admin = await api('GET', '/api/admin/data');
  }

  if (id !== renderId) return;

  const routes = {
    '#/login': loginView,
    '#/register': registerView,
    '#/dash': dashView,
    '#/admin': adminView
  };

  $('#app').innerHTML = (routes[h] || homeView)();
  navView();

  if (!keepScroll) window.scrollTo(0, 0);
  if (h === '#/dash' && focusBookingId !== null) {
    const bookingElement = document.getElementById(`booking-item-${focusBookingId}`);
    focusBookingId = null;
    if (bookingElement) {
      bookingElement.classList.add('booking-focus');
      bookingElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      bookingElement.focus({ preventScroll: true });
    }
  }

  if (h === '#/admin') bookingTable();
  if (h === '#/dash') checkBookingConfirmationNotifications();
}

async function render(keepScroll) {
  try {
    await draw(keepScroll);
  } catch (err) {
    console.error('Render error:', err);
    if (ADMIN_PORTAL && err.status === 401) {
      location.replace('admin/login.php');
      return;
    }
    const isLiveServer = location.port === '5500';
    const hint = isLiveServer
      ? `<p style="margin:12px 0 6px">You are running via Live Server (port 5500). Please open the Apache URL directly:</p>
         <p><a class="btn sm" href="http://localhost/pawsandstay/">Open http://localhost/pawsandstay/</a></p>`
      : `<p style="margin:12px 0 6px">Check that Apache and MySQL are running in your XAMPP Control Panel, then try again.</p>`;
    $('#app').innerHTML = `<div class="wrap"><h1>Can't reach the server</h1>
      <div class="err">${esc(err.message || 'Something went wrong.')}</div>
      ${hint}
      <button class="btn" data-act="retry">Try again</button> <a class="btn ghost" href="#/">Go home</a></div>`;
  }
}
window.addEventListener('hashchange', () => { if (!ADMIN_PORTAL) render(); });

/* ============ H. FORM ACTIONS ============ */
const FORMS = {
  async login(d) {
    await api('POST', '/api/login', { email: d.email, pw: d.pw });
    location.hash = '#/dash';
    render();
  },

  async register(d) {
    // 1. Contact number validation in JavaScript
    const phoneErr = validatePhone(d.phone);
    if (phoneErr) {
      fail(phoneErr);
      return;
    }

    // 2. Password validation in JavaScript
    const pwErr = validatePassword(d.pw);
    if (pwErr) {
      fail(pwErr);
      return;
    }

    if (d.pw !== d.pw2) {
      fail('Passwords do not match.');
      return;
    }

    await api('POST', '/api/register', d);
    setFlash('Account created successfully! Please log in.');
    location.hash = '#/login';
    render();
  },

  async 'admin-add'(d) {
    await api('POST', '/api/admin/admins', d);
    setFlash('Admin account created.');
    render(true);
  },

  async 'admin-service'(d, form) {
    const id = Number(form.dataset.serviceId);
    await api('PATCH', `/api/admin/services/${id}`, {
      name: d.name,
      price: d.price,
      desc: d.desc
    });
    setFlash(`Service #${id} updated.`);
    await render(true);
  },

  async profile(d) {
    const phoneErr = validatePhone(d.phone);
    if (phoneErr) throw new Error(phoneErr);
    const result = await api('PUT', '/api/profile', d);
    S.session.user = result.user;
    setFlash('Profile updated.');
    await render(true);
  },

  async 'refund-request'(d, form) {
    const bookingId = Number(form.dataset.bookingId);
    await api('POST', `/api/bookings/${bookingId}/refunds`, { reason: d.reason, message: d.message || '' });
    $('#modalContainer').innerHTML = '';
    setFlash('Refund Requested — status: Pending. Please wait for the admin to review your request.');
    await render(true);
  }
};

document.addEventListener('submit', e => {
  const form = e.target;
  const name = form.dataset.form;
  if (!name || !FORMS[name]) return;
  e.preventDefault();
  FORMS[name](Object.fromEntries(new FormData(form)), form)
    .catch(err => {
      console.error(err);
      const message = err.message || 'Something went wrong. Please try again.';
      const errorBox = form.querySelector('[data-form-error], .err');
      if (errorBox) {
        errorBox.textContent = message;
        errorBox.hidden = false;
      } else {
        fail(message);
      }
    });
});

/* Input restrictor for 11-digit phone numbers */
document.addEventListener('input', e => {
  if (e.target.name === 'phone' || e.target.id === 'regPhone') {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
  }
});

/* ============ I. GLOBAL BUTTON CLICKS & ADMIN CONTROLS ============ */
const run = p => p.catch(err => { console.error(err); setFlash(err.message || 'Something went wrong.', 'err'); render(true); });
const adminSetStatus = (id, status) => run(api('PATCH', '/api/admin/bookings/' + id, { status }).then(() => {
  setFlash(`Booking #${id} status updated to ${status}.`);
  return render(true);
}));
const adminSetRefundStatus = (id, status) => {
  const note = $(`[data-refund-note="${id}"]`)?.value.trim() || '';
  if (['Rejected', 'Cancelled'].includes(status) && !note) return fail('Enter an admin note before rejecting or cancelling this refund request.');
  if (status === 'Accepted' && !window.confirm('Accept this refund request? This records acceptance only; it does not send money to GCash.')) return;
  if (status === 'Rejected' && !window.confirm('Reject this refund request?')) return;
  if (status === 'Cancelled' && !window.confirm('Cancel this refund request?')) return;
  if (status === 'Processing' && !window.confirm('Confirm that manual GCash refund processing has started?')) return;
  if (status === 'Refunded' && !window.confirm('Confirm that the GCash refund has already been sent to the client?')) return;
  return run(api('PATCH', `/api/admin/refunds/${id}`, { status, admin_note: note }).then(() => {
    setFlash(`Refund #${id} updated to ${status}.`);
    return render(true);
  }));
};
const saveRefundNote = id => {
  const admin_note = $(`[data-refund-note="${id}"]`)?.value.trim() || '';
  return run(api('PATCH', `/api/admin/refunds/${id}`, { admin_note }).then(() => {
    setFlash(`Admin note for refund #${id} saved.`);
    return render(true);
  }));
};

document.addEventListener('click', e => {
  // Password Show/Hide Toggle Button
  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn) {
    const targetId = toggleBtn.dataset.toggle;
    const inp = document.getElementById(targetId);
    if (inp) {
      if (inp.type === 'password') {
        inp.type = 'text';
        toggleBtn.textContent = '🙈';
        toggleBtn.setAttribute('aria-label', 'Hide password');
      } else {
        inp.type = 'password';
        toggleBtn.textContent = '👁️';
        toggleBtn.setAttribute('aria-label', 'Show password');
      }
    }
    return;
  }

  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act, id = +t.dataset.id;

  if (act === 'close-booking-details' || act === 'close-refund-request') {
    if (t.tagName === 'BUTTON' || e.target === t) $('#modalContainer').innerHTML = '';
  } else if (act === 'logout') {
    run(api('POST', '/api/logout').then(() => { location.hash = '#/'; render(); }));
  } else if (act === 'retry') {
    render();
  } else if (act === 'scroll-bookings') {
    $('#my-bookings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (act === 'show-more-bookings') {
    bookingView.limit += 10;
    $('#clientBookingList').innerHTML = clientBookingList();
  } else if (act === 'retry-availability') {
    run(BookingModal.fetchBookedTimes(BookingModal.date).then(() => BookingModal.render()));
  } else if (act === 'open-booking') {
    BookingModal.open();
  } else if (act === 'pick') {
    BookingModal.open(id);
  } else if (act === 'booking-details') {
    openBookingDetails(id);
  } else if (act === 'refund-details') {
    openRefundDetails(id);
  } else if (act === 'request-refund') {
    $('#modalContainer').innerHTML = '';
    openRefundRequest(id);
  } else if (act === 'ack-refund') {
    run(api('POST', `/api/bookings/${id}/refunds/ack`).then(async () => {
      const result = await api('GET', '/api/bookings');
      S.bookings = result.bookings || [];
      await render(true);
    }));
  } else if (act === 'book-another-from-details') {
    $('#modalContainer').innerHTML = '';
    BookingModal.open();
  } else if (act === 'cancel' && armed(t, 'Tap again to cancel')) {
    run(api('POST', `/api/bookings/${id}/cancel`).then(() => { setFlash('Booking cancelled.'); return render(true); }));
  } else if (act === 'delete' && armed(t, 'Tap again to delete')) {
    run(api('DELETE', '/api/admin/bookings/' + id).then(() => { setFlash('Booking deleted.'); return render(true); }));
  } else if (act === 'confirm-booking') {
    adminSetStatus(id, 'Confirmed');
  } else if (act === 'reject-booking') {
    adminSetStatus(id, 'Cancelled');
  } else if (act === 'accept-refund') {
    adminSetRefundStatus(id, 'Accepted');
  } else if (act === 'reject-refund') {
    adminSetRefundStatus(id, 'Rejected');
  } else if (act === 'cancel-refund') {
    adminSetRefundStatus(id, 'Cancelled');
  } else if (act === 'save-refund-note') {
    saveRefundNote(id);
  } else if (act === 'process-refund') {
    adminSetRefundStatus(id, 'Processing');
  } else if (act === 'complete-refund') {
    adminSetRefundStatus(id, 'Refunded');
  } else if (act === 'view-booking') {
    viewConfirmedBooking(id, t);
  } else if (act === 'view-receipt') {
    const url = t.dataset.url;
    if (url) openReceiptLightbox(url);
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'clientBookingSearch') {
    bookingView.search = e.target.value;
    bookingView.limit = 10;
    $('#clientBookingList').innerHTML = clientBookingList();
  } else if (e.target.id === 'fText') filters.text = e.target.value;
  else if (e.target.id === 'fStatus') filters.status = e.target.value;
  else return;
  if (e.target.id === 'fText' || e.target.id === 'fStatus') bookingTable();
});

document.addEventListener('change', e => {
  if (e.target.id === 'clientBookingStatus') {
    bookingView.status = e.target.value;
    bookingView.limit = 10;
    $('#clientBookingList').innerHTML = clientBookingList();
    return;
  }
  if (e.target.id === 'clientBookingDate') {
    bookingView.date = e.target.value;
    bookingView.limit = 10;
    $('#clientBookingList').innerHTML = clientBookingList();
    return;
  }

  const statusId = e.target.dataset.status;
  if (statusId) adminSetStatus(+statusId, e.target.value);

  const payStatusId = e.target.dataset.payStatus;
  if (payStatusId) {
    run(api('PATCH', '/api/admin/bookings/' + payStatusId, { payment_status: e.target.value }).then(() => {
      setFlash(`Payment status for booking #${payStatusId} updated to ${e.target.value}.`);
      return render(true);
    }));
  }
});

/* Refresh admin dashboard or check notifications in background */
setInterval(() => {
  const modalOpen = Boolean($('#modalContainer')?.childElementCount);
  const activeControl = document.activeElement?.matches('input,select,textarea');
  const activeBookingList = Boolean(document.activeElement?.closest('#clientBookingList'));
  if ((ADMIN_PORTAL || location.hash === '#/admin') && !document.hidden && !activeControl && !modalOpen) {
    render(true);
  } else if (location.hash === '#/dash' && !document.hidden && !modalOpen) {
    api('GET', '/api/bookings').then(res => {
      if (Array.isArray(res?.bookings)) {
        S.bookings = res.bookings;
        const bookingTarget = $('#clientBookingList');
        if (bookingTarget && !activeBookingList) bookingTarget.innerHTML = clientBookingList();
        const notificationTarget = $('#refundNotifications');
        if (notificationTarget) notificationTarget.outerHTML = refundNotifications();
        checkBookingConfirmationNotifications();
      }
    }).catch(err => console.error('Unable to refresh client bookings:', err));
  }
}, 20000);

/* ============ J. CHAT ASSISTANT ============ */
const FAQ = [
  { keys: ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'kumusta', 'musta', 'maayo'], a: 'Hello! 👋 How can we help you and your pet today?' },
  { keys: ['thank', 'salamat', 'daghang salamat'], a: "You're welcome! 🐾 Let us know if you have more questions." },
  { keys: ['service', 'offer', 'what do you do', 'serbisyo', 'unsa inyong'], a: 'We offer boutique in-home pet care services:\n• Home Safety Audit\n• Pet-Proof Installation\n• Camera Setup\n• In-Home Pet Sitting\n• Pet Wellness Check\nClick "Book Service" at the top to book multiple services!' },
  { keys: ['audit', 'safety', 'hazard', 'inspection'], a: 'The Home Safety Audit (from ₱800) is a room-by-room walkthrough that flags hazards for your pet, with a written report.' },
  { keys: ['proof', 'gate', 'balcony', 'balconies', 'flooring', 'install'], a: 'Pet-Proof Installation (from ₱1,500) covers safety gates, cat balconies, and non-slip flooring, installed at your home.' },
  { keys: ['camera', 'cctv', 'monitor', 'watch my pet'], a: 'Camera Setup (from ₱1,500): we install a pet-facing camera and link it to your phone so you can check on your pet anytime.' },
  { keys: ['sitting', 'sitter', 'walk', 'feeding', 'feed', 'playtime', 'away', 'travel', 'vacation'], a: "In-Home Pet Sitting (from ₱600): we feed, walk, and play with your pet at your own home, so they stay comfortable in their familiar space." },
  { keys: ['wellness', 'health check', 'checkup', 'check-up'], a: 'Pet Wellness Check (from ₱350): a daily health check with a same-day update sent to you.' },
  { keys: ['price', 'rate', 'cost', 'how much', 'fee', 'quote', 'magkano', 'tagpila', 'pila', 'presyo'], a: 'Starting rates:\n• Home Safety Audit ₱800\n• Pet-Proof Installation ₱1,500\n• Camera Setup ₱1,500\n• In-Home Pet Sitting ₱600\n• Pet Wellness Check ₱350\nYou can select multiple services in our booking pop-up!' },
  { keys: ['pay', 'payment', 'gcash', 'cash', 'bayad'], a: 'We accept Cash and GCash! When paying via GCash, you can upload your receipt screenshot directly in the booking pop-up.' },
  { keys: ['contact', 'phone', 'call', 'email', 'number', 'address', 'where', 'location', 'talibon', 'bohol'], a: 'Reach us at:\n📍 Talibon, Bohol\n📞 +63 912 345 6789\n📧 pawsandstay@email.com' }
];
const QUICK = ['Services', 'Rates', 'GCash & Cash', 'Book Now'];
const chat = { history: [], busy: false };
const chatLog = $('#chatLog');

function addMsg(text, who) {
  const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = text;
  chatLog.appendChild(d); chatLog.scrollTop = chatLog.scrollHeight; return d;
}
function faqAnswer(text) {
  const t = text.toLowerCase();
  let best = null, bestScore = 0;
  FAQ.forEach(item => {
    const score = item.keys.filter(k => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t)).length;
    if (score > bestScore) { best = item; bestScore = score; }
  });
  return best ? best.a : "I'm not sure about that one yet 🐾 I can help with our boutique services, rates, hours, GCash payment, and booking. Call +63 912 345 6789 or email pawsandstay@email.com.";
}
async function sendChat(text) {
  if (chat.busy) return; chat.busy = true; $('#quick').innerHTML = '';
  addMsg(text, 'me'); chat.history.push({ role: 'user', text });
  const wait = addMsg('…', 'bot');
  setTimeout(() => {
    const reply = faqAnswer(text);
    wait.textContent = reply;
    chat.history.push({ role: 'assistant', text: reply });
    chat.busy = false;
  }, 400);
}
function toggleChat(open) {
  $('#chat').classList.toggle('open', open); $('#chatBtn').style.display = open ? 'none' : 'block';
  if (open && !chatLog.children.length) {
    addMsg("Hi! I'm the Paws & Stay assistant 🐾 Ask me about our boutique pet services, rates, or booking.", 'bot');
    QUICK.forEach(q => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q;
      b.onclick = () => {
        if (q === 'Book Now') {
          toggleChat(false);
          BookingModal.open();
        } else {
          sendChat(q);
        }
      };
      $('#quick').appendChild(b);
    });
  }
  if (open) $('#chatInput').focus();
}
$('#chatBtn').onclick = () => toggleChat(true);
$('#chatClose').onclick = () => toggleChat(false);
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const i = $('#chatInput'), t = i.value.trim();
  if (t) { i.value = ''; sendChat(t); }
});

render();
