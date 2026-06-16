const db = require('./db');

async function reset() {
  await db.initDb();
  
  try {
    await db.query("UPDATE citizen_profiles SET name='', dob='', gender='', occupation='', education='', income_category='', income_amount=0, state='', district='', caste='', is_farmer=0");
    console.log('All profile data cleared.');
  } catch(e) {
    console.log('Profile clear error:', e.message);
  }

  try {
    await db.query("DELETE FROM documents");
    console.log('All documents cleared.');
  } catch(e) {
    console.log('Document clear error:', e.message);
  }
  
  process.exit(0);
}

reset();
