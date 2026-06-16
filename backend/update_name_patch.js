// backend/update_name_patch.js
const db = require('./db');

async function runPatch() {
  console.log('Starting DB Patch to set user to Gaurav Sujikumar...');
  await db.initDb();
  
  try {
    // 1. Get User ID
    const userRes = await db.query("SELECT id FROM users WHERE mobile = '9000000001'");
    if (userRes.rowCount === 0) {
      console.error('Demo user with mobile 9000000001 not found.');
      process.exit(1);
    }
    const userId = userRes.rows[0].id;
    console.log(`Found user ID: ${userId}`);

    // 2. Update citizen_profiles
    const profileRes = await db.query(
      `UPDATE citizen_profiles 
       SET name = 'Gaurav Sujikumar', 
           dob = '05/10/2004', 
           gender = 'Male', 
           state = 'Telangana', 
           district = 'Hanamkonda', 
           caste = 'OBC', 
           occupation = 'Student', 
           education = 'Engineering', 
           income_amount = 120000, 
           income_category = 'low', 
           is_farmer = 0 
       WHERE user_id = $1`,
      [userId]
    );
    console.log(`Updated citizen_profiles: ${profileRes.rowCount} rows.`);

    // 3. Update documents
    const docRes = await db.query(
      `UPDATE documents 
       SET extracted_name = 'Gaurav Sujikumar', 
           extracted_dob = '05/10/2004', 
           is_verified = 1, 
           validation_status = $1 
       WHERE user_id = $2 AND document_type = 'aadhaar'`,
      [
        JSON.stringify({
          status: "verified",
          issues: [],
          extracted_data: {
            name: "Gaurav Sujikumar",
            father_name: "Suji Kumar Sr.",
            dob: "05/10/2004",
            gender: "Male",
            id_number: "5489 1204 9021",
            address: "Plot 45, Subedari, Hanamkonda, Telangana - 506001",
            income_amount: null,
            caste: null,
            expiry: "Permanent"
          }
        }),
        userId
      ]
    );
    console.log(`Updated documents: ${docRes.rowCount} rows.`);

    console.log('Database patch successfully completed!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to run database patch:', err.message);
    process.exit(1);
  }
}

runPatch();
