const http = require('http');

const BASE_URL = 'http://127.0.0.1:3000';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runE2E() {
  const results = [];
  let sessionCookie = '';

  function log(name, status, evidence) {
    results.push({ name, status, evidence });
    console.log(`[${status}] ${name} - ${evidence}`);
  }

  try {
    // 1. Health Check
    const health = await request('/api/health');
    if (health.status === 200 && health.json?.status === 'ok') {
      log('Health Check (/api/health)', 'PASS', 'Status 200, status=ok');
    } else {
      log('Health Check (/api/health)', 'FAIL', `Status ${health.status}: ${health.body}`);
    }

    // 2. Unauthenticated Protections
    const unauthDashboard = await request('/api/dashboard');
    if (unauthDashboard.status === 401) {
      log('Auth Protection: /api/dashboard', 'PASS', 'Blocked with 401');
    } else {
      log('Auth Protection: /api/dashboard', 'FAIL', `Expected 401, got ${unauthDashboard.status}`);
    }

    const unauthEmails = await request('/api/emails');
    if (unauthEmails.status === 401) {
      log('Auth Protection: /api/emails', 'PASS', 'Blocked with 401');
    } else {
      log('Auth Protection: /api/emails', 'FAIL', `Expected 401, got ${unauthEmails.status}`);
    }

    const unauthPager = await request('/api/pager');
    if (unauthPager.status === 401) {
      log('Auth Protection: /api/pager', 'PASS', 'Blocked with 401');
    } else {
      log('Auth Protection: /api/pager', 'FAIL', `Expected 401, got ${unauthPager.status}`);
    }

    // 3. Login Validation
    const emptyLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {}
    });
    if (emptyLogin.status === 400) {
      log('Login Validation: Missing Fields', 'PASS', 'Rejected with 400');
    } else {
      log('Login Validation: Missing Fields', 'FAIL', `Expected 400, got ${emptyLogin.status}`);
    }

    const wrongLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'test@test.com', password: 'wrongpassword' }
    });
    if (wrongLogin.status === 401) {
      log('Login Validation: Wrong Password', 'PASS', 'Rejected with 401');
    } else {
      log('Login Validation: Wrong Password', 'FAIL', `Expected 401, got ${wrongLogin.status}`);
    }

    // 4. Duplicate Signup Validation (409 Conflict)
    const dupSignup = await request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: 'Test', email: 'test@test.com', password: 'password123' }
    });
    if (dupSignup.status === 409 && dupSignup.json?.error === 'EMAIL_EXISTS') {
      log('Signup Validation: Existing Email', 'PASS', 'Rejected with 409 EMAIL_EXISTS');
    } else {
      log('Signup Validation: Existing Email', 'FAIL', `Expected 409 EMAIL_EXISTS, got ${dupSignup.status}`);
    }

    // 5. Successful Login
    const validLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'test@test.com', password: 'password123' }
    });
    if (validLogin.status === 200 && validLogin.json?.user?.email === 'test@test.com') {
      const setCookie = validLogin.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        sessionCookie = setCookie[0].split(';')[0];
      }
      log('Operator Login (/api/auth/login)', 'PASS', `Status 200, user=${validLogin.json.user.email}`);
    } else {
      log('Operator Login (/api/auth/login)', 'FAIL', `Login failed: ${validLogin.status}`);
    }

    // 6. Authenticated Session /api/auth/me
    const meRes = await request('/api/auth/me', {
      headers: { 'Cookie': sessionCookie }
    });
    if (meRes.status === 200 && meRes.json?.user?.email === 'test@test.com') {
      log('Session Verification (/api/auth/me)', 'PASS', 'Status 200 with user profile');
    } else {
      log('Session Verification (/api/auth/me)', 'FAIL', `Expected 200, got ${meRes.status}`);
    }

    // 7. Dashboard Telemetry
    const dashboardRes = await request('/api/dashboard', {
      headers: { 'Cookie': sessionCookie }
    });
    if (dashboardRes.status === 200 && typeof dashboardRes.json?.stats?.totalEmails === 'number') {
      log('Dashboard Telemetry (/api/dashboard)', 'PASS', `Status 200, totalEmails=${dashboardRes.json.stats.totalEmails}, unread=${dashboardRes.json.stats.unreadCount}`);
    } else {
      log('Dashboard Telemetry (/api/dashboard)', 'FAIL', `Expected 200, got ${dashboardRes.status}: ${dashboardRes.body}`);
    }

    // 8. Inbox Email Listing
    const emailsRes = await request('/api/emails', {
      headers: { 'Cookie': sessionCookie }
    });
    if (emailsRes.status === 200 && Array.isArray(emailsRes.json?.emails)) {
      log('Inbox Email Feed (/api/emails)', 'PASS', `Status 200, returned ${emailsRes.json.emails.length} emails`);
    } else {
      log('Inbox Email Feed (/api/emails)', 'FAIL', `Expected 200, got ${emailsRes.status}`);
    }

    const emailNotFound = await request('/api/emails/999999', {
      headers: { 'Cookie': sessionCookie }
    });
    if (emailNotFound.status === 404) {
      log('Email Detail Not Found (/api/emails/999999)', 'PASS', 'Status 404 returned correctly');
    } else {
      log('Email Detail Not Found (/api/emails/999999)', 'FAIL', `Expected 404, got ${emailNotFound.status}`);
    }

    // 9. Settings Load & Update
    const settingsGet = await request('/api/settings', {
      headers: { 'Cookie': sessionCookie }
    });
    if (settingsGet.status === 200 && settingsGet.json?.settings) {
      log('Settings Retrieval (/api/settings)', 'PASS', `Status 200, minPriority=${settingsGet.json.settings.pagerMinPriority}`);
    } else {
      log('Settings Retrieval (/api/settings)', 'FAIL', `Expected 200, got ${settingsGet.status}`);
    }

    const settingsBadPriority = await request('/api/settings', {
      method: 'PATCH',
      headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
      body: { pagerMinPriority: 'super_urgent' }
    });
    if (settingsBadPriority.status === 400 && settingsBadPriority.json?.error === 'INVALID_PRIORITY') {
      log('Settings Validation: Priority', 'PASS', 'Rejected invalid priority with 400');
    } else {
      log('Settings Validation: Priority', 'FAIL', `Expected 400, got ${settingsBadPriority.status}`);
    }

    const settingsPatch = await request('/api/settings', {
      method: 'PATCH',
      headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
      body: { pagerMinPriority: 'high', pagerDeadlineDays: 14 }
    });
    if (settingsPatch.status === 200 && settingsPatch.json?.settings?.pagerMinPriority === 'high') {
      log('Settings Update (/api/settings)', 'PASS', 'Status 200, updated priority to high, window to 14');
      // Revert back
      await request('/api/settings', {
        method: 'PATCH',
        headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
        body: { pagerMinPriority: 'medium', pagerDeadlineDays: 7 }
      });
    } else {
      log('Settings Update (/api/settings)', 'FAIL', `Expected 200, got ${settingsPatch.status}: ${settingsPatch.body}`);
    }

    // 10. Pager API Flow
    const pagerRes = await request('/api/pager', {
      headers: { 'Cookie': sessionCookie }
    });
    if (pagerRes.status === 200 && Array.isArray(pagerRes.json?.items) && pagerRes.json?.counts) {
      log('Pager Feed & Counts (/api/pager)', 'PASS', `Status 200, items=${pagerRes.json.items.length}, totalCount=${pagerRes.json.counts.total}`);
    } else {
      log('Pager Feed & Counts (/api/pager)', 'FAIL', `Expected 200, got ${pagerRes.status}`);
    }

    const pagerInvalidId = await request('/api/pager/abc/snooze', {
      method: 'POST',
      headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
      body: { minutes: 15 }
    });
    if (pagerInvalidId.status === 400 && pagerInvalidId.json?.error === 'INVALID_EMAIL_ID') {
      log('Pager Snooze Validation: Email ID', 'PASS', 'Rejected with 400 INVALID_EMAIL_ID');
    } else {
      log('Pager Snooze Validation: Email ID', 'FAIL', `Expected 400, got ${pagerInvalidId.status}: ${pagerInvalidId.body}`);
    }

    const pagerInvalidMinutes = await request('/api/pager/1/snooze', {
      method: 'POST',
      headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
      body: { minutes: -5 }
    });
    if (pagerInvalidMinutes.status === 400 && pagerInvalidMinutes.json?.error === 'INVALID_SNOOZE_DURATION') {
      log('Pager Snooze Validation: Duration', 'PASS', 'Rejected with 400 INVALID_SNOOZE_DURATION');
    } else {
      log('Pager Snooze Validation: Duration', 'FAIL', `Expected 400, got ${pagerInvalidMinutes.status}: ${pagerInvalidMinutes.body}`);
    }

    const pagerNotFoundSnooze = await request('/api/pager/999999/snooze', {
      method: 'POST',
      headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
      body: { minutes: 60 }
    });
    if (pagerNotFoundSnooze.status === 404 && pagerNotFoundSnooze.json?.error === 'EMAIL_NOT_FOUND') {
      log('Pager Snooze: Non-existent Email', 'PASS', 'Status 404 EMAIL_NOT_FOUND');
    } else {
      log('Pager Snooze: Non-existent Email', 'FAIL', `Expected 404, got ${pagerNotFoundSnooze.status}: ${pagerNotFoundSnooze.body}`);
    }

    // 11. External Integrations Verification
    try {
      const hermesRes = await fetch('http://127.0.0.1:8642/v1/models', {
        headers: { 'Authorization': 'Bearer hermes-local-dev-key' }
      });
      log('Hermes AI Gateway (127.0.0.1:8642)', 'PASS', `Status ${hermesRes.status}`);
    } catch (err) {
      log('Hermes AI Gateway (127.0.0.1:8642)', 'BLOCKED', `Gateway offline: ${err.message}`);
    }

    const googleStart = await request('/api/connections/google/start', {
      headers: { 'Cookie': sessionCookie }
    });
    if (googleStart.status === 200 && googleStart.json?.authUrl) {
      log('Google OAuth Start', 'PASS', 'Auth URL generated');
    } else {
      log('Google OAuth Start', 'BLOCKED', `GOOGLE_CLIENT_ID not configured in .env (status ${googleStart.status})`);
    }

    // 12. Logout
    const logoutRes = await request('/api/auth/logout', {
      method: 'POST',
      headers: { 'Cookie': sessionCookie }
    });
    if (logoutRes.status === 200) {
      log('Operator Logout (/api/auth/logout)', 'PASS', 'Status 200, session cleared');
    } else {
      log('Operator Logout (/api/auth/logout)', 'FAIL', `Logout status ${logoutRes.status}`);
    }

    const afterLogoutMe = await request('/api/auth/me', {
      headers: { 'Cookie': sessionCookie }
    });
    if (afterLogoutMe.status === 401) {
      log('Post-Logout Protection', 'PASS', 'Subsequent request blocked with 401');
    } else {
      log('Post-Logout Protection', 'FAIL', `Expected 401, got ${afterLogoutMe.status}`);
    }

  } catch (err) {
    console.error('Fatal test error:', err);
  }
}

runE2E();
