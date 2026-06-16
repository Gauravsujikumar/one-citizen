const db = require('./db');
(async () => {
  try {
    const r = await db.query("SELECT extracted_data FROM documents WHERE document_type='aadhaar' AND is_verified=1 LIMIT 1");
    console.log('=== AADHAAR DATA ===');
    console.log(JSON.stringify(r.rows[0], null, 2));

    const a = await db.query("SELECT id, service_id, status, form_data, created_at FROM applications ORDER BY created_at DESC LIMIT 2");
    console.log('\n=== APPLICATIONS ===');
    a.rows.forEach(app => console.log(JSON.stringify(app, null, 2)));
  } catch(e) { console.log(e.message); }
  process.exit();
})();
