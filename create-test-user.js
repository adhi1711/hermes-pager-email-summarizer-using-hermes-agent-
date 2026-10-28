const fs = require('fs');
const path = require('path');

const db = require('./src/db/database');
const users = require('./src/repositories/users');
const bcrypt = require('bcryptjs');

async function createTestUser() {
  const existing = users.findByEmail('test@test.com');
  if (existing) {
    console.log('User already exists:', existing);
    return;
  }

  const passwordHash = await bcrypt.hash('password123', 12);
  const user = users.create('Test User', 'test@test.com', passwordHash);
  console.log('Created user:', user);
}

createTestUser();