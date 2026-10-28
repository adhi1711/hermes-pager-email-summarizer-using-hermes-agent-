const db = require('./src/db/database');
const sessions = db.prepare('SELECT * FROM sessions').all();
console.log('Sessions:', sessions);