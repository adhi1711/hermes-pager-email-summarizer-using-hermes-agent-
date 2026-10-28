const http = require('http');
const app = require('./src/server');
const db = require('./src/db/database');
const { users, sessions, emails, emailAnalysis, emailReplies, connectedAccounts } = require('./src/repositories');
const { generateSuggestedReply } = require('./src/services/hermesAnalysis');

async function runReplyLifecycleTests() {
  console.log('=== STARTING HERMES REPLY & STATE TRACKING LIFECYCLE TESTS ===');

  // Start test server on ephemeral port
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
    // 1. Ensure test user exists & login
    let user = db.prepare("SELECT * FROM users WHERE email = 'reply-test@hermes.local'").get();
    if (!user) {
      const res = db.prepare("INSERT INTO users (name, email, password_hash) VALUES ('Reply Tester', 'reply-test@hermes.local', 'mockhash')").run();
      testUserId = res.lastInsertRowid;
    } else {
      testUserId = user.id;
    }

    // Create session token directly for test user
    const token = 'test-token-' + Date.now();
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substring(0, 19);
    db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(testUserId, tokenHash, expiresAt);
    cookie = `session=${token}`;

    console.log(`[PASS] Test user authenticated (User ID: ${testUserId})`);

    // 2. Create connected mock Gmail account
    const accRes = db.prepare(`
      INSERT INTO connected_accounts (user_id, provider, provider_account_id, email_address, status)
      VALUES (?, 'mock', 'mock-google-acc-' || ?, 'operator@hermes.local', 'active')
    `).run(testUserId, Date.now());
    testAccountId = accRes.lastInsertRowid;
    console.log(`[PASS] Connected mock account created (Account ID: ${testAccountId})`);

    // 3. Ingest an urgent, high-priority email with thread metadata
    const threadId = 'thread-urgent-' + Date.now();
    const providerMsgId = 'msg-urgent-' + Date.now();
    const emailRes = db.prepare(`
      INSERT INTO emails (user_id, account_id, provider_message_id, thread_id, sender_name, sender_email, recipient, subject, snippet, body_text, received_at)
      VALUES (?, ?, ?, ?, 'Chief Technology Officer', 'cto@enterprise.corp', 'operator@hermes.local', 'CRITICAL: Server load high - approve failover', 'Please approve the database failover protocol immediately.', 'Hello,\n\nThe production database cluster is currently at 98% memory capacity. Please approve initiating the failover protocol to the replica immediately to prevent service degradation.\n\nRegards,\nCTO', datetime('now'))
    `).run(testUserId, testAccountId, providerMsgId, threadId);
    testEmailId = emailRes.lastInsertRowid;
    console.log(`[PASS] High-priority urgent email inserted (Email ID: ${testEmailId}, Thread: ${threadId})`);

    // 4. Test Suggested Reply Generation
    const mockAnalysis = {
      summary: 'Production DB cluster at 98% memory capacity; CTO requests immediate approval for replica failover.',
      priority: 'high',
      category: 'work',
      sentiment: 'urgent',
      action_items: ['Approve initiating database failover protocol to replica'],
      deadline_text: 'Immediately'
    };

    // Store completed analysis with sentiment
    db.prepare(`
      INSERT INTO email_analysis (email_id, user_id, status, summary, priority, category, sentiment, action_items, deadline_text)
      VALUES (?, ?, 'completed', ?, 'high', 'work', 'urgent', ?, ?)
    `).run(testEmailId, testUserId, mockAnalysis.summary, JSON.stringify(mockAnalysis.action_items), mockAnalysis.deadline_text);

    // Call generateSuggestedReply
    const generatedReply = await generateSuggestedReply(
      emails.findById(testUserId, testEmailId),
      mockAnalysis,
      testUserId
    );

    if (generatedReply && generatedReply.status === 'draft' && generatedReply.suggestedBody) {
      console.log(`[PASS] Suggested Reply Automatically Generated in 'draft' status: "${generatedReply.suggestedBody.substring(0, 50)}..."`);
    } else {
      throw new Error(`Expected reply in 'draft' status, got ${JSON.stringify(generatedReply)}`);
    }

    // 5. SAFETY VERIFICATION: Ensure email was NOT sent automatically
    const checkUnsent = db.prepare("SELECT * FROM email_replies WHERE email_id = ?").get(testEmailId);
    if (checkUnsent.status === 'draft' && checkUnsent.sent_at === null) {
      console.log("[PASS] SAFETY GUARANTEE CONFIRMED: Status is strictly 'draft'. No email dispatched automatically.");
    } else {
      throw new Error(`Safety violation! Reply had status ${checkUnsent.status}`);
    }

    // 6. Test GET /api/emails/:id/reply route
    const getRes = await request(`/api/emails/${testEmailId}/reply`, {
      headers: { 'Cookie': cookie }
    });
    if (getRes.status === 200 && getRes.json?.reply?.status === 'draft') {
      console.log("[PASS] GET /api/emails/:id/reply returns draft reply for operator review");
    } else {
      throw new Error(`GET /api/emails/:id/reply failed: ${getRes.status} ${getRes.body}`);
    }

    // 7. Test Operator Editing Draft (PATCH /api/emails/:id/reply)
    const customText = "Hi CTO,\n\nI have reviewed the telemetry and hereby approve the database failover protocol. Proceed with replica promotion.\n\nBest regards,\nOperator";
    const editRes = await request(`/api/emails/${testEmailId}/reply`, {
      method: 'PATCH',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: { editedBody: customText }
    });
    if (editRes.status === 200 && editRes.json?.reply?.editedBody === customText) {
      console.log("[PASS] PATCH /api/emails/:id/reply successfully updated editedBody with operator modifications");
    } else {
      throw new Error(`PATCH /api/emails/:id/reply failed: ${editRes.status} ${editRes.body}`);
    }

    // 8. Test Explicit Operator Send Approval (POST /api/emails/:id/reply/send)
    const sendRes = await request(`/api/emails/${testEmailId}/reply/send`, {
      method: 'POST',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: { replyBody: customText }
    });
    if (sendRes.status === 200 && sendRes.json?.success && sendRes.json?.reply?.status === 'sent') {
      console.log(`[PASS] POST /api/emails/:id/reply/send successfully dispatched email in thread (Message ID: ${sendRes.json.reply.gmailMessageId})`);
    } else {
      throw new Error(`POST /api/emails/:id/reply/send failed: ${sendRes.status} ${sendRes.body}`);
    }

    // 9. Verify Email Record Join Reflects Sent Reply & Sentiment
    const fullEmailRes = await request(`/api/emails/${testEmailId}`, {
      headers: { 'Cookie': cookie }
    });
    const emailData = fullEmailRes.json?.email;
    if (
      emailData?.analysis?.sentiment === 'urgent' &&
      emailData?.reply?.status === 'sent' &&
      emailData?.reply?.sentAt !== null
    ) {
      console.log("[PASS] GET /api/emails/:id joins sentiment ('urgent') and reply status ('sent') correctly");
    } else {
      throw new Error(`Email join verification failed: ${JSON.stringify(emailData)}`);
    }

    // 10. Verify Cannot Re-Send or Edit Already Sent Reply
    const duplicateSendRes = await request(`/api/emails/${testEmailId}/reply/send`, {
      method: 'POST',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: { replyBody: "Duplicate attempt" }
    });
    if (duplicateSendRes.status === 400 && duplicateSendRes.json?.error === 'REPLY_ALREADY_SENT') {
      console.log("[PASS] Duplicate send prevented (Returned 400 REPLY_ALREADY_SENT)");
    } else {
      throw new Error(`Expected 400 REPLY_ALREADY_SENT, got ${duplicateSendRes.status}`);
    }

    const editSentRes = await request(`/api/emails/${testEmailId}/reply`, {
      method: 'PATCH',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: { editedBody: "Edit after sent" }
    });
    if (editSentRes.status === 400 && editSentRes.json?.error === 'CANNOT_EDIT_SENT_REPLY') {
      console.log("[PASS] Editing sent reply prevented (Returned 400 CANNOT_EDIT_SENT_REPLY)");
    } else {
      throw new Error(`Expected 400 CANNOT_EDIT_SENT_REPLY, got ${editSentRes.status}`);
    }

    console.log('\n=== ALL HERMES REPLY & STATE TRACKING TESTS PASSED (10/10) ===');
  } finally {
    // Clean up test records
    if (testEmailId) {
      db.prepare("DELETE FROM emails WHERE id = ?").run(testEmailId);
    }
    if (testAccountId) {
      db.prepare("DELETE FROM connected_accounts WHERE id = ?").run(testAccountId);
    }
    if (testUserId) {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(testUserId);
      db.prepare("DELETE FROM users WHERE id = ?").run(testUserId);
    }
    server.close();
  }
}

runReplyLifecycleTests().catch(err => {
  console.error('[FATAL TEST ERROR]', err);
  process.exit(1);
});
