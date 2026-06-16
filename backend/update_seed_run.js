// backend/update_seed_run.js
const db = require('./db');

async function runSeed() {
  console.log('Resetting and seeding database for Gaurav Sujikumar (User 2)...');
  await db.initDb();

  try {
    const userId = 2; // User 2 is 9000000001
    
    // Clear old data
    await db.query("DELETE FROM citizen_profiles WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM documents WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM applications WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM notifications WHERE user_id = $1", [userId]);

    // Insert profile
    await db.query(
      `INSERT INTO citizen_profiles (user_id, name, dob, gender, occupation, education, income_category, income_amount, state, district, caste, is_farmer, family_members)
       VALUES ($1, 'Gaurav Sujikumar', '05/10/2004', 'Male', 'Student', 'Engineering', 'medium', 180000, 'Telangana', 'Hanamkonda', 'OBC', 0, '[]')`,
      [userId]
    );

    // Seed Aadhaar document (verified, 1 document)
    const valObj = {
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
    };
    
    await db.query(
      `INSERT INTO documents (id, user_id, document_type, file_path, extracted_name, extracted_id_number, is_verified, validation_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['doc_aadhaar', userId, 'aadhaar', 'uploads/mock_aadhaar.pdf', 'Gaurav Sujikumar', '5489 1204 9021', 1, JSON.stringify(valObj)]
    );

    // Seed 3 active applications separately to prevent SQLite binding issues
    await db.query(
      `INSERT INTO applications (id, user_id, service_id, form_data, readiness_score, status, created_at)
       VALUES ('app_income', $1, 1, '{"service_name":"Income Certificate"}', 85, 'approved', '2026-05-10 10:00:00')`,
      [userId]
    );

    await db.query(
      `INSERT INTO applications (id, user_id, service_id, form_data, readiness_score, status, created_at)
       VALUES ('app_caste', $1, 2, '{"service_name":"Caste Certificate"}', 90, 'pending', '2026-05-08 14:30:00')`,
      [userId]
    );

    await db.query(
      `INSERT INTO applications (id, user_id, service_id, form_data, readiness_score, status, created_at)
       VALUES ('app_scholarship', $1, 3, '{"service_name":"Scholarship Application"}', 95, 'pending', '2026-05-05 09:15:00')`,
      [userId]
    );

    console.log('Successfully re-seeded citizen database records!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed DB:', err.message);
    process.exit(1);
  }
}

runSeed();
