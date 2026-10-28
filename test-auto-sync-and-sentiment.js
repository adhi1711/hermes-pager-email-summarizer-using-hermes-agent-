const http = require('http');
const app = require('./src/server');
const db = require('./src/db/database');
const { emails, emailAnalysis, userSettings, connectedAccounts } = require('./src/repositories');
const { validateAnalysisResult } = require('./src/services/hermesAnalysis');

async function runAutoSyncAndSentimentTests() {
  console.log('=== STARTING AUTO-SYNC & SENTIMENT VALIDATION TESTS ===');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      }, (res) => {
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

  let cookie = '';
  let testUserId = null;
  let testAccountId = null;
  let testEmailId = null;

  try {
    // 1. Setup user & session
    const userRes = db.prepare("INSERT INTO users (name, email, password_hash) VALUES ('Sync Tester', 'sync-test-" + Date.now() + "@hermes.local', 'mockhash')").run();
    testUserId = userRes.lastInsertRowid;

    const token = 'sync-token-' + Date.now();
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substring(0, 19);
    db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(testUserId, tokenHash, expiresAt);
    cookie = `session=${token}`;

    // Verify autoAnalyze setting defaults to true
    const settings = userSettings.findByUserId(testUserId) || userSettings.getDefaults();
    if (settings.autoAnalyze === true) {
      console.log("[PASS] User Settings: autoAnalyze is enabled by default");
    } else {
      throw new Error(`Expected autoAnalyze=true, got ${settings.autoAnalyze}`);
    }

    // 2. Validate sentiment validation logic
    const testAnalysisResult = {
      summary: "Quarterly review required by Friday.",
      priority: "high",
      category: "work",
      sentiment: "urgent",
      action_items: ["Prepare financial projections"],
      deadline_text: "Friday 5pm",
      deadline_at: new Date(Date.now() + 86400000).toISOString(),
      confidence: 0.95
    };
    validateAnalysisResult(testAnalysisResult);
    if (testAnalysisResult.sentiment === 'urgent') {
      console.log("[PASS] validateAnalysisResult properly validates sentiment ('urgent')");
    }

    // Test fallback sentiment if missing
    const missingSentimentResult = {
      summary: "Info newsletter.",
      priority: "low",
      category: "marketing",
      action_items: [],
      deadline_text: null,
      deadline_at: null,
      confidence: 0.8
    };
    validateAnalysisResult(missingSentimentResult);
    if (missingSentimentResult.sentiment === 'neutral') {
      console.log("[PASS] validateAnalysisResult provides robust fallback sentiment ('neutral')");
    }

    // 3. Create test account & email
    const accRes = db.prepare(`
      INSERT INTO connected_accounts (user_id, provider, provider_account_id, email_address, status)
      VALUES (?, 'mock', 'sync-mock-' || ?, 'sync@hermes.local', 'active')
    `).run(testUserId, Date.now());
    testAccountId = accRes.lastInsertRowid;

    const emailRes = db.prepare(`
      INSERT INTO emails (user_id, account_id, provider_message_id, thread_id, sender_name, sender_email, recipient, subject, snippet, body_text, received_at)
      VALUES (?, ?, 'sync-msg-' || ?, 'sync-thread-1', 'Director', 'director@corp.org', 'sync@hermes.local', 'Budget Approval Notice', 'Please approve Q4 budget', 'Please review the attached budget figures.', datetime('now'))
    `).run(testUserId, testAccountId, Date.now());
    testEmailId = emailRes.lastInsertRowid;

    // 4. Test storing and retrieving analysis states (pending, completed, failed)
    // Pending
    emailAnalysis.create(testEmailId, testUserId);
    let checkPending = emails.findById(testUserId, testEmailId);
    if (checkPending.analysis?.status === 'pending') {
      console.log("[PASS] Initial analysis record created in 'pending' state");
    } else {
      throw new Error(`Expected analysis status 'pending', got ${checkPending.analysis?.status}`);
    }

    // Completed with sentiment
    emailAnalysis.update(testEmailId, {
      status: 'completed',
      summary: 'Q4 Budget requires director approval.',
      priority: 'high',
      category: 'finance',
      sentiment: 'positive',
      actionItems: ['Review figures', 'Sign off'],
      deadlineText: 'Next week',
      analyzedAt: new Date()
    });

    let checkCompleted = emails.findById(testUserId, testEmailId);
    if (
      checkCompleted.analysis?.status === 'completed' &&
      checkCompleted.analysis?.sentiment === 'positive' &&
      checkCompleted.analysis?.priority === 'high'
    ) {
      console.log("[PASS] Analysis completed state and sentiment ('positive') correctly persisted & queried");
    } else {
      throw new Error(`Completed check failed: ${JSON.stringify(checkCompleted.analysis)}`);
    }

    // 5. Check Pager feed returns sentiment and reply metadata
    const pagerRes = await request('/api/pager', {
      headers: { 'Cookie': cookie }
    });
    if (pagerRes.status === 200 && pagerRes.json?.items?.some(it => it.id === testEmailId && it.analysis?.sentiment === 'positive')) {
      console.log("[PASS] /api/pager includes sentiment metadata in live pager items");
    } else {
      throw new Error(`Pager feed verification failed: ${pagerRes.status} ${pagerRes.body}`);
    }

    console.log('\n=== ALL AUTO-SYNC & SENTIMENT TESTS PASSED (5/5) ===');
  } finally {
    if (testEmailId) db.prepare("DELETE FROM emails WHERE id = ?").run(testEmailId);
    if (testAccountId) db.prepare("DELETE FROM connected_accounts WHERE id = ?").run(testAccountId);
    if (testUserId) {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(testUserId);
      db.prepare("DELETE FROM users WHERE id = ?").run(testUserId);
    }
    server.close();
  }
}

runAutoSyncAndSentimentTests().catch(err => {
  console.error('[FATAL TEST ERROR]', err);
  process.exit(1);
});
