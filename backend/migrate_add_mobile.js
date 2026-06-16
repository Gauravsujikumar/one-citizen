const db = require('./db');
db.initDb().then(async () => {
  try {
    await db.query('ALTER TABLE users ADD COLUMN mobile TEXT');
    console.log('✅ mobile column added to users table');
  } catch (e) {
    if (e.message && e.message.includes('duplicate column')) {
      console.log('ℹ️  mobile column already exists');
    } else {
      console.log('Column note:', e.message);
    }
  }
  process.exit(0);
});
