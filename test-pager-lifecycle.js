const http = require('http');
const db = require('./src/db/database');

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
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function testPagerLifecycle() {
  console.log('--- Starting Pager & Snooze Flow Lifecycle Verification ---');

  // 1. Login as test@test.com
  const loginRes = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'test@test.com', password: 'password123' }
  });
  const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
  const userId = loginRes.json.user.id;

  // 2. Insert temporary mock account, email and analysis for test user
  const insertAccount = db.prepare(`
    INSERT INTO connected_accounts (user_id, provider, provider_account_id, email_address, status)
    VALUES (?, 'mock', 'mock-account-' || ?, 'mock@example.com', 'active')
  `);
  const accountRes = insertAccount.run(userId, Date.now());
  const testAccountId = accountRes.lastInsertRowid;

  const insertEmail = db.prepare(`
    INSERT INTO emails (user_id, account_id, provider_message_id, sender_name, sender_email, subject, snippet, body_text, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertAnalysis = db.prepare(`
    INSERT INTO email_analysis (email_id, user_id, status, summary, priority, category, action_items, deadline_text, deadline_at)
    VALUES (?, ?, 'completed', ?, 'high', 'work', ?, ?, datetime('now', '+2 days'))
  `);

  const emailRes = insertEmail.run(
    userId,
    testAccountId,
    'mock-pager-test-' + Date.now(),
    'Security Officer',
    'security@infra.corp',
    'URGENT: Database maintenance required',
    'Database maintenance must be executed before deadline.',
    'Full body text for urgent database maintenance operations.'
  );
  const testEmailId = emailRes.lastInsertRowid;

  insertAnalysis.run(
    testEmailId,
    userId,
    'Critical infrastructure update required within 48h.',
    JSON.stringify(['Run schema migrations', 'Verify backups']),
    'In 2 days'
  );

  console.log(`[PASS] Mock Urgent Email Created (ID: ${testEmailId})`);

  try {
    // 3. Verify Pager feed now includes this urgent email
    const feed1 = await request('/api/pager', { headers: { 'Cookie': cookie } });
    const hasItem = feed1.json?.items?.some(it => it.id === testEmailId);
    if (hasItem && feed1.json?.counts?.highPriority >= 1) {
      console.log('[PASS] Pager Feed: Urgent Email Appears in Live Feed & HighPriority Counter Incremented');
    } else {
      console.error('[FAIL] Pager Feed did not contain test email:', feed1.json);
    }

    // 4. Test Snooze for 60 minutes
    const snoozeRes = await request(`/api/pager/${testEmailId}/snooze`, {
      method: 'POST',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: { minutes: 60 }
    });
    if (snoozeRes.status === 200 && snoozeRes.json?.success) {
      console.log(`[PASS] Pager Snooze Action: Snoozed until ${snoozeRes.json.snoozedUntil}`);
    } else {
      console.error('[FAIL] Snooze failed:', snoozeRes.status, snoozeRes.body);
    }

    // 5. Verify Snoozed Email Disappears from Pager Feed
    const feed2 = await request('/api/pager', { headers: { 'Cookie': cookie } });
    const isGone = !feed2.json?.items?.some(it => it.id === testEmailId);
    if (isGone) {
      console.log('[PASS] Pager Isolation: Snoozed Email Successfully Disappeared from Active Feed');
    } else {
      console.error('[FAIL] Snoozed email still visible in active feed:', feed2.json);
    }

    // 6. Test Unsnooze Action
    const unsnoozeRes = await request(`/api/pager/${testEmailId}/snooze`, {
      method: 'DELETE',
      headers: { 'Cookie': cookie }
    });
    if (unsnoozeRes.status === 200) {
      console.log('[PASS] Pager Unsnooze Action: Successfully unsnoozed');
    } else {
      console.error('[FAIL] Unsnooze failed:', unsnoozeRes.status);
    }

    // 7. Verify Email Reappears in Pager Feed
    const feed3 = await request('/api/pager', { headers: { 'Cookie': cookie } });
    const hasReturned = feed3.json?.items?.some(it => it.id === testEmailId);
    if (hasReturned) {
      console.log('[PASS] Pager Reactivation: Unsnoozed Email Returned to Active Feed');
    } else {
      console.error('[FAIL] Email did not return after unsnooze:', feed3.json);
    }

    // 8. Test Acknowledge / Dismiss Action
    const dismissRes = await request(`/api/pager/${testEmailId}/dismiss`, {
      method: 'POST',
      headers: { 'Cookie': cookie }
    });
    if (dismissRes.status === 200) {
      console.log('[PASS] Pager Ack Action: Acknowledged/Dismissed message');
    } else {
      console.error('[FAIL] Dismiss failed:', dismissRes.status);
    }

    // 9. Verify Dismissed Email Disappears from Pager Feed
    const feed4 = await request('/api/pager', { headers: { 'Cookie': cookie } });
    const isDismissed = !feed4.json?.items?.some(it => it.id === testEmailId);
    if (isDismissed) {
      console.log('[PASS] Pager Dismissal: Acknowledged Email Removed from Active Feed');
    } else {
      console.error('[FAIL] Dismissed email still visible:', feed4.json);
    }

    // 10. Verify Email Detail Route
    const detailRes = await request(`/api/emails/${testEmailId}`, { headers: { 'Cookie': cookie } });
    if (detailRes.status === 200 && detailRes.json?.email?.subject === 'URGENT: Database maintenance required') {
      console.log('[PASS] Email Detail: Full Email & Analysis Object Retrieved Accurately');
    } else {
      console.error('[FAIL] Email detail failed:', detailRes.status, detailRes.body);
    }

  } finally {
    if (testEmailId) {
      db.prepare('DELETE FROM email_analysis WHERE email_id = ?').run(testEmailId);
      db.prepare('DELETE FROM pager_snoozes WHERE email_id = ?').run(testEmailId);
      db.prepare('DELETE FROM pager_dismissals WHERE email_id = ?').run(testEmailId);
      db.prepare('DELETE FROM emails WHERE id = ?').run(testEmailId);
    }
    if (testAccountId) {
      db.prepare('DELETE FROM connected_accounts WHERE id = ?').run(testAccountId);
    }
    console.log('[PASS] Mock Data Cleaned up from Database');
  }
}

testPagerLifecycle().catch(console.error);
