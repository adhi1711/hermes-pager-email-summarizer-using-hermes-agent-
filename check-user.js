const db = require('./src/db/database');
const users = require('./src/repositories/users');

const user = users.findByEmail('test@test.com');
console.log('User:', user);