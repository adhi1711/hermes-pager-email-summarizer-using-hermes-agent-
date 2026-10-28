const bcrypt = require('bcryptjs');
const users = require('./src/repositories/users');
const auth = require('./src/services/auth');

async function testLogin() {
  const user = users.findByEmailWithPassword('test@test.com');
  console.log('User from DB:', user);
  
  const valid = await bcrypt.compare('password123', user.password_hash);
  console.log('Password valid:', valid);
  
  try {
    const result = await auth.login('test@test.com', 'password123');
    console.log('Login result:', result);
  } catch (error) {
    console.error('Login error:', error);
  }
}

testLogin();