const auth = require('./src/services/auth');

async function test() {
  try {
    const result = await auth.login('test@test.com', 'password123');
    console.log('Success:', result);
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

test();