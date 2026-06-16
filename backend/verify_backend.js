// verify_backend.js - Automated integration test for OneCitizen AI backend
const db = require('./db');
const authModule = require('./routes/auth');
const bcrypt = require('bcryptjs');

async function runTests() {
  console.log('====================================================');
  console.log('   OneCitizen AI Backend Verification Suite');
  console.log('====================================================');

  let passed = 0;
  let failed = 0;

  function report(name, status, err = null) {
    if (status) {
      passed++;
      console.log(`[✔] SUCCESS: ${name}`);
    } else {
      failed++;
      console.log(`[❌] FAILED:  ${name}`);
      if (err) console.error(`    Details: ${err.message || err}`);
    }
  }

  try {
    // Test 1: Database Initialization
    await db.initDb();
    report('Database connection and schema setup', true);

    // Test 2: Clean up previous verification tests to ensure repeatability
    await db.query("DELETE FROM users WHERE email = 'verify_test@onecitizen.gov.in'");
    report('Database cleanup capability', true);

    // Test 3: User Signup / Registration
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('testpass123', salt);
    const signupRes = await db.query(
      "INSERT INTO users (email, password_hash, role) VALUES ('verify_test@onecitizen.gov.in', $1, 'citizen')",
      [hash]
    );
    
    // Retrieve registered user id
    const user = await db.query("SELECT id FROM users WHERE email = 'verify_test@onecitizen.gov.in'");
    const userId = user.rows[0].id;
    
    // Seed blank profile
    await db.query(
      `INSERT INTO citizen_profiles (user_id, name, dob, gender, occupation, education, income_category, income_amount, state, district, caste, is_farmer, family_members)
       VALUES ($1, '', '', '', '', '', 'low', 0, '', '', '', 0, '[]')`,
      [userId]
    );
    report('User registration and profile creation', userId > 0);

    // Test 4: Profile Update / Digital Twin Building
    const updateRes = await db.query(
      `UPDATE citizen_profiles 
       SET name = 'Verification Test User', dob = '12/12/1990', gender = 'Female', occupation = 'Farmer',
           income_amount = 95000, state = 'Telangana', district = 'Rangareddy', is_farmer = 1
       WHERE user_id = $1`,
      [userId]
    );
    
    const profileVerify = await db.query('SELECT * FROM citizen_profiles WHERE user_id = $1', [userId]);
    const isTwinSet = profileVerify.rows[0].name === 'Verification Test User' && profileVerify.rows[0].is_farmer === 1;
    report('Digital Twin parameter loading and updating', isTwinSet);

    // Test 5: Service catalog retrieval
    const services = await db.query('SELECT * FROM services');
    report('Services catalog query', services.rowCount > 0);

    // Test 6: Welfare Schemes query
    const schemes = await db.query('SELECT * FROM schemes');
    report('Welfare schemes list query', schemes.rowCount > 0);

    // Test 7: MeeSeva Geographic search
    const centers = await db.query('SELECT * FROM meeseva_centers');
    report('MeeSeva Centers query', centers.rowCount > 0);

    // Test 8: User Login validation
    const loginUser = await db.query("SELECT * FROM users WHERE email = 'verify_test@onecitizen.gov.in'");
    const loginMatch = await bcrypt.compare('testpass123', loginUser.rows[0].password_hash);
    report('User password verification and hashing encryption', loginMatch);

    // Clean up
    await db.query("DELETE FROM users WHERE email = 'verify_test@onecitizen.gov.in'");
    await db.query("DELETE FROM citizen_profiles WHERE user_id = $1", [userId]);

    console.log('====================================================');
    console.log(` VERIFICATION COMPLETE: ${passed} passed, ${failed} failed`);
    console.log('====================================================');
    
    // Graceful exit
    process.exit(failed > 0 ? 1 : 0);

  } catch (err) {
    report('Unexpected execution error during verification', false, err);
    console.log('====================================================');
    process.exit(1);
  }
}

runTests();
