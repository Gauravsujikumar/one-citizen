// db.js - Dual PostgreSQL / SQLite Client wrapper for OneCitizen AI
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env from the backend directory (works both locally and on Vercel)
dotenv.config({ path: path.resolve(__dirname, '.env') });

let dbType = 'sqlite';
let pgPool = null;
let sqliteDb = null;
let _initPromise = null; // Guards against race conditions on Vercel serverless

// Log environment for debugging on Vercel
console.log(`[DB] VERCEL=${process.env.VERCEL || 'false'}, DATABASE_URL=${process.env.DATABASE_URL ? 'SET (' + process.env.DATABASE_URL.substring(0, 30) + '...)' : 'NOT SET'}`);

// Initialize Database connection
async function initDb() {
  const pgUrl = process.env.DATABASE_URL;

  if (pgUrl) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: pgUrl,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });

    try {
      // Test connection
      await pgPool.query('SELECT NOW()');
      dbType = 'postgres';
      console.log('[DB] Successfully connected to PostgreSQL (Neon).');
    } catch (err) {
      console.error('[DB] PostgreSQL connection FAILED:', err.message);
      if (process.env.VERCEL) {
        // On Vercel, do NOT fall back to SQLite — it won't work
        throw new Error('PostgreSQL connection failed on Vercel: ' + err.message);
      }
      console.warn('[DB] Falling back to SQLite for local development.');
      dbType = 'sqlite';
      initSqlite();
    }
  } else {
    if (process.env.VERCEL) {
      console.warn('[DB] DATABASE_URL is not set. Falling back to temporary SQLite in /tmp for Vercel Serverless Demo.');
    }
    dbType = 'sqlite';
    initSqlite();
  }

  // Setup tables and seed data
  await setupDatabase();
}

// Ensure DB is fully initialized before any query (prevents race conditions on Vercel cold starts)
function ensureInitialized() {
  if (!_initPromise) {
    _initPromise = initDb().catch(err => {
      console.error('[DB] Initialization failed:', err.message);
      _initPromise = null; // Allow retry on next request
      throw err;
    });
  }
  return _initPromise;
}

function initSqlite() {
  try {
    const sqlite3 = require('sqlite3').verbose();
    let dbPath = path.resolve(__dirname, 'one_citizen.db');
    if (process.env.VERCEL) {
      dbPath = path.join(require('os').tmpdir(), 'one_citizen.db');
      const srcPath = path.resolve(__dirname, 'one_citizen.db');
      if (fs.existsSync(srcPath) && !fs.existsSync(dbPath)) {
        try {
          fs.copyFileSync(srcPath, dbPath);
          console.log('[DB] Copied pre-seeded SQLite database to /tmp.');
        } catch (copyErr) {
          console.warn('[DB] Failed to copy pre-seeded SQLite database:', copyErr.message);
        }
      }
    }
    console.log(`[DB] Connecting to SQLite at: ${dbPath}`);
    sqliteDb = new sqlite3.Database(dbPath);
  } catch (err) {
    console.error('[DB] Failed to load sqlite3 native module:', err.message);
    throw new Error('SQLite is not supported on Vercel serverless. Please configure a PostgreSQL database by adding the DATABASE_URL environment variable in your Vercel Project Settings.');
  }
}

// Internal query — does NOT wait for init (used during setup to avoid circular deadlock)
async function rawQuery(text, params = []) {
  if (dbType === 'postgres') {
    const res = await pgPool.query(text, params);
    return { rows: res.rows, rowCount: res.rowCount };
  } else {
    let sqliteText = text.replace(/\$\d+/g, '?');
    const isInsert = sqliteText.trim().toUpperCase().startsWith('INSERT');

    return new Promise((resolve, reject) => {
      if (isInsert || sqliteText.trim().toUpperCase().startsWith('UPDATE') || sqliteText.trim().toUpperCase().startsWith('DELETE')) {
        sqliteDb.run(sqliteText, params, function(err) {
          if (err) return reject(err);
          resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
        });
      } else {
        sqliteDb.all(sqliteText, params, (err, rows) => {
          if (err) return reject(err);
          resolve({ rows: rows || [], rowCount: rows ? rows.length : 0 });
        });
      }
    });
  }
}

// Public query — waits for DB init to complete (safe for route handlers)
async function query(text, params = []) {
  await ensureInitialized();
  return rawQuery(text, params);
}

// Create database schemas and insert default data if tables are empty
async function setupDatabase() {
  // Fast-path: Skip schema recreation and migrations if the database is already fully initialized
  try {
    await rawQuery('SELECT 1 FROM users LIMIT 1');
    console.log('[DB] Core database already initialized. Skipping setup.');
    return;
  } catch (err) {
    console.log('[DB] Core database not initialized. Running schema setup...');
  }

  const schemaPath = path.resolve(__dirname, 'schema.sql');
  let schemaSql = fs.readFileSync(schemaPath, 'utf8');

  if (dbType === 'postgres') {
    // Convert SQLite AUTOINCREMENT to Postgres SERIAL
    schemaSql = schemaSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
    schemaSql = schemaSql.replace(/is_farmer INTEGER DEFAULT 0/g, 'is_farmer SMALLINT DEFAULT 0');
    schemaSql = schemaSql.replace(/is_read INTEGER DEFAULT 0/g, 'is_read SMALLINT DEFAULT 0');
    schemaSql = schemaSql.replace(/is_verified INTEGER DEFAULT 0/g, 'is_verified SMALLINT DEFAULT 0');
    schemaSql = schemaSql.replace(/REAL/g, 'DECIMAL(12,2)');

    // Split SQL by semicolon and execute queries
    const statements = schemaSql.split(';').filter(stmt => stmt.trim() !== '');
    for (let stmt of statements) {
      await pgPool.query(stmt);
    }
  } else {
    // For SQLite, execute statements
    const statements = schemaSql.split(';').filter(stmt => stmt.trim() !== '');
    for (let stmt of statements) {
      await new Promise((resolve, reject) => {
        sqliteDb.run(stmt, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Migration: add officer_notes column if missing
  try {
    await rawQuery("ALTER TABLE applications ADD COLUMN officer_notes TEXT");
    console.log('Added officer_notes column to applications');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migration: add updated_at column if missing
  try {
    await rawQuery("ALTER TABLE applications ADD COLUMN updated_at TEXT");
    console.log('Added updated_at column to applications');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migration: add category and created_at to schemes if missing
  try { await rawQuery("ALTER TABLE schemes ADD COLUMN category TEXT DEFAULT 'General'"); } catch(e) {}
  try { await rawQuery("ALTER TABLE schemes ADD COLUMN created_at TEXT"); } catch(e) {}

  // Re-seed schemes if count doesn't match expected set (16 schemes)
  const scCount = await rawQuery('SELECT count(*) as count FROM schemes');
  if (parseInt(scCount.rows[0].count) !== 16) {
    await rawQuery('DELETE FROM schemes');
    console.log('Re-seeding welfare schemes with latest rules...');
  }

  // Seed default data
  await seedDefaultData();
}

async function seedDefaultData() {
  // 1. Seed Services
  const servicesCheck = await rawQuery('SELECT count(*) as count FROM services');
  const serviceCount = parseInt(servicesCheck.rows[0].count);

  if (serviceCount === 0) {
    console.log('Seeding government services...');
    const defaultServices = [
      {
        name: 'Income Certificate',
        category: 'certificate',
        eligibility_rules: JSON.stringify({ min_age: 18, states: ['Telangana', 'Andhra Pradesh'] }),
        required_documents: JSON.stringify(['Aadhaar Card', 'Passport-size Photo']),
        fees: 45.0,
        processing_time: '7 Days',
        steps: JSON.stringify(['Upload documents', 'Verification by Revenue Officer', 'Approval by Tahsildar', 'Download digital certificate'])
      },
      {
        name: 'Caste Certificate',
        category: 'certificate',
        eligibility_rules: JSON.stringify({ categories: ['SC', 'ST', 'OBC'] }),
        required_documents: JSON.stringify(['Aadhaar Card', 'Passport-size Photo', "Father's Caste Certificate (if available)", 'School Transfer Certificate (TC)', 'SSC Memo / Educational Records', 'Ration Card', 'Address Proof', 'Affidavit or Self Declaration']),
        fees: 45.0,
        processing_time: '15 Days',
        steps: JSON.stringify(['Submit family caste proof', 'VRO Verification', 'MRO Approval', 'Issue Certificate'])
      },
      {
        name: 'EWS Certificate',
        category: 'certificate',
        eligibility_rules: JSON.stringify({ min_age: 18 }),
        required_documents: JSON.stringify(['Aadhaar Card', 'Passport-size Photo', 'Income Certificate', 'Property Details', 'Ration Card', 'Residence Proof', 'Self Declaration Form']),
        fees: 35.0,
        processing_time: '10 Days',
        steps: JSON.stringify(['Upload documents', 'Income verification', 'Property check', 'Issue Certificate'])
      },
      {
        name: 'Birth Certificate',
        category: 'certificate',
        eligibility_rules: JSON.stringify({}),
        required_documents: JSON.stringify(['Hospital Birth Report', 'Parent Aadhaar Cards', 'Parent Mobile Number', 'Address Proof']),
        fees: 50.0,
        processing_time: '3 Days',
        steps: JSON.stringify(['Hospital record matching', 'Municipal officer verification', 'Digital signature generation'])
      },
      {
        name: 'Death Certificate',
        category: 'certificate',
        eligibility_rules: JSON.stringify({}),
        required_documents: JSON.stringify(['Death Report from Hospital', 'Aadhaar of Deceased', 'Aadhaar of Applicant', 'Address Proof', 'Medical Certificate of Cause of Death', 'Burial/Cremation Record (if applicable)']),
        fees: 45.0,
        processing_time: '5 Days',
        steps: JSON.stringify(['Hospital death record matching', 'VRO Verification', 'MRO Approval', 'Issue Certificate'])
      },
      {
        name: 'Old Age Pension',
        category: 'pension',
        eligibility_rules: JSON.stringify({ min_age: 60, max_income: 150000 }),
        required_documents: JSON.stringify(['Aadhaar Card', 'Passport-size Photo', 'Age Proof', 'Income Certificate', 'Bank Passbook', 'Ration Card', 'Mobile Number', 'Residence Proof']),
        fees: 0.0,
        processing_time: '30 Days',
        steps: JSON.stringify(['Submit application', 'Gram Panchayat / Ward verification', 'Sanction order issue'])
      },
      {
        name: 'Business Registration',
        category: 'business',
        eligibility_rules: JSON.stringify({ min_age: 18 }),
        required_documents: JSON.stringify(['PAN Card', 'Aadhaar Card', 'Address Proof', 'Business Address Proof', 'Passport-size Photo']),
        fees: 1500.0,
        processing_time: '10 Days',
        steps: JSON.stringify(['Trade name approval', 'Local municipality inspection', 'License issuance'])
      }
    ];

    for (let s of defaultServices) {
      await rawQuery(
        `INSERT INTO services (name, category, eligibility_rules, required_documents, fees, processing_time, steps) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [s.name, s.category, s.eligibility_rules, s.required_documents, s.fees, s.processing_time, s.steps]
      );
    }
  }

  // 2. Seed Schemes
  const schemesCheck = await rawQuery('SELECT count(*) as count FROM schemes');
  const schemeCount = parseInt(schemesCheck.rows[0].count);

  if (schemeCount === 0) {
    console.log('Seeding government welfare schemes...');
    const now = new Date();
    const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
    const defaultSchemes = [
      // --- Agriculture ---
      { name: 'PM-KISAN (Farmer Income Support)', description: 'An initiative by the Government of India providing up to ₹6,000 per year in three equal installments to all small and marginal landholding farmer families.', benefit_amount: '₹6,000 / Year', eligibility_rules: JSON.stringify({ is_farmer: 1, max_income: 300000 }), required_documents: JSON.stringify(['aadhaar', 'address']), category: 'Agriculture', created_at: daysAgo(90) },
      { name: 'Kisan Credit Card (KCC)', description: 'Provides affordable credit to farmers for purchase of seeds, fertilizers, pesticides and other agricultural inputs during cropping season.', benefit_amount: 'Up to ₹3 Lakhs at 4% Interest', eligibility_rules: JSON.stringify({ is_farmer: 1, max_income: 500000 }), required_documents: JSON.stringify(['aadhaar', 'address']), category: 'Agriculture', created_at: daysAgo(15) },

      // --- Education ---
      { name: 'Post-Matric Scholarship Scheme', description: 'Financial assistance to students belonging to SC, ST, and OBC categories to pursue post-matriculation or post-secondary courses.', benefit_amount: 'Full Tuition Fee Waiver + ₹1,200/Month', eligibility_rules: JSON.stringify({ max_income: 250000, education: 'Engineering', max_age: 30 }), required_documents: JSON.stringify(['aadhaar', 'income', 'caste', 'degree']), category: 'Education', created_at: daysAgo(60) },
      { name: 'PM Vidyalakshmi Education Loan', description: 'Interest subsidy on education loans for economically weaker sections to pursue higher education in India and abroad.', benefit_amount: 'Full Interest Subsidy during Moratorium', eligibility_rules: JSON.stringify({ max_income: 200000, max_age: 35 }), required_documents: JSON.stringify(['aadhaar', 'income']), category: 'Education', created_at: daysAgo(5) },
      { name: 'National Means-cum-Merit Scholarship', description: 'Scholarship for meritorious students of economically weaker sections studying in Class IX to XII.', benefit_amount: '₹12,000 / Year', eligibility_rules: JSON.stringify({ max_income: 150000, min_age: 13, max_age: 18 }), required_documents: JSON.stringify(['aadhaar', 'income']), category: 'Education', created_at: daysAgo(2) },

      // --- Entrepreneurship ---
      { name: 'Startup India Seed Fund Scheme', description: 'Financial assistance to startups for proof of concept, prototype development, product trials, and commercialization.', benefit_amount: 'Up to ₹20 Lakhs Grant / ₹50 Lakhs Debt', eligibility_rules: JSON.stringify({ occupation: 'Entrepreneur', min_age: 21 }), required_documents: JSON.stringify(['pan', 'address']), category: 'Entrepreneurship', created_at: daysAgo(45) },
      { name: 'MUDRA Loan (Shishu Category)', description: 'Collateral-free loans for micro-enterprises and small businesses under the Micro Units Development and Refinance Agency.', benefit_amount: 'Up to ₹50,000 Loan at Low Interest', eligibility_rules: JSON.stringify({ occupation: 'Self-employed', min_age: 18 }), required_documents: JSON.stringify(['aadhaar', 'pan']), category: 'Entrepreneurship', created_at: daysAgo(8) },

      // --- Housing ---
      { name: 'PM Awas Yojana (Rural Housing)', description: 'Welfare program to provide pucca houses with basic amenities to all homeless householders and households living in dilapidated houses.', benefit_amount: '₹1.2 Lakhs Subsidy', eligibility_rules: JSON.stringify({ max_income: 120000 }), required_documents: JSON.stringify(['aadhaar', 'income', 'address']), category: 'Housing', created_at: daysAgo(75) },
      { name: 'PM Awas Yojana (Urban - CLSS)', description: 'Credit-linked subsidy for first-time home buyers in urban areas from EWS/LIG/MIG categories.', benefit_amount: 'Up to ₹2.67 Lakhs Interest Subsidy', eligibility_rules: JSON.stringify({ max_income: 180000 }), required_documents: JSON.stringify(['aadhaar', 'income', 'pan']), category: 'Housing', created_at: daysAgo(3) },

      // --- Health ---
      { name: 'Ayushman Bharat (PM-JAY)', description: 'Provides health cover of ₹5 lakh per family per year for secondary and tertiary care hospitalization to bottom 40% vulnerable families.', benefit_amount: '₹5 Lakhs Health Cover / Family', eligibility_rules: JSON.stringify({ max_income: 150000 }), required_documents: JSON.stringify(['aadhaar', 'ration']), category: 'Health', created_at: daysAgo(30) },
      { name: 'Janani Suraksha Yojana', description: 'Cash assistance and free delivery services for pregnant women below poverty line to promote institutional deliveries.', benefit_amount: '₹1,400 Cash + Free Delivery', eligibility_rules: JSON.stringify({ max_income: 200000, gender: 'female', min_age: 18, max_age: 45 }), required_documents: JSON.stringify(['aadhaar', 'income']), category: 'Health', created_at: daysAgo(1) },

      // --- Women & Child ---
      { name: 'Beti Bachao Beti Padhao', description: 'Multi-sectoral initiative to address declining child sex ratio and empower the girl child through education and awareness.', benefit_amount: 'Education & Awareness Support', eligibility_rules: JSON.stringify({ gender: 'female', max_age: 18 }), required_documents: JSON.stringify(['aadhaar']), category: 'Women & Child', created_at: daysAgo(50) },
      { name: 'Sukanya Samriddhi Yojana', description: 'Small savings scheme for the girl child offering high interest rate and tax benefits under Section 80C.', benefit_amount: '8.2% Interest + Tax Benefits', eligibility_rules: JSON.stringify({ gender: 'female', max_age: 10 }), required_documents: JSON.stringify(['aadhaar', 'pan']), category: 'Women & Child', created_at: daysAgo(7) },

      // --- Senior Citizens ---
      { name: 'Indira Gandhi National Old Age Pension', description: 'Monthly pension to BPL citizens aged 60 years and above. Enhanced amount for citizens above 80 years.', benefit_amount: '₹300–₹500 / Month', eligibility_rules: JSON.stringify({ min_age: 60, max_income: 100000 }), required_documents: JSON.stringify(['aadhaar', 'income']), category: 'Senior Citizens', created_at: daysAgo(40) },

      // --- Employment ---
      { name: 'PM Garib Kalyan Rojgar Abhiyan', description: 'Employment generation in rural areas through 25 different work categories including construction, sanitation, and plantation.', benefit_amount: 'Guaranteed Employment + ₹202/Day', eligibility_rules: JSON.stringify({ max_income: 100000, min_age: 18 }), required_documents: JSON.stringify(['aadhaar', 'address']), category: 'Employment', created_at: daysAgo(12) },
      { name: 'PM Kaushal Vikas Yojana (PMKVY 4.0)', description: 'Skill development and certification scheme for Indian youth. Free training in 300+ job roles with placement assistance.', benefit_amount: 'Free Training + ₹8,000 Reward', eligibility_rules: JSON.stringify({ min_age: 15, max_age: 35, max_income: 300000 }), required_documents: JSON.stringify(['aadhaar']), category: 'Employment', created_at: daysAgo(0) },
    ];

    for (let sc of defaultSchemes) {
      await rawQuery(
        `INSERT INTO schemes (name, description, benefit_amount, eligibility_rules, required_documents, category, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sc.name, sc.description, sc.benefit_amount, sc.eligibility_rules, sc.required_documents, sc.category || 'General', sc.created_at || new Date().toISOString()]
      );
    }
  }

  // 3. Seed MeeSeva Centers
  const centersCheck = await rawQuery('SELECT count(*) as count FROM meeseva_centers');
  const centersCount = parseInt(centersCheck.rows[0].count);

  if (centersCount === 0) {
    console.log('Seeding MeeSeva Centers...');
    const defaultCenters = [
      {
        name: 'MeeSeva Center Himayatnagar',
        latitude: 17.4025,
        longitude: 78.4842,
        address: 'Plot 4, Main Road, Himayatnagar, Hyderabad - 500029',
        rating: 4.3,
        wait_time: '8 mins',
        services: JSON.stringify(['Income Certificate', 'Caste Certificate', 'Aadhaar Enrollment', 'Voter enrollment'])
      },
      {
        name: 'MeeSeva Center Gachibowli',
        latitude: 17.440081,
        longitude: 78.348916,
        address: 'Plot No. 12, Ground Floor, Gachibowli Road, Hyderabad - 500032 (Opposite IIIT Gate)',
        rating: 4.2,
        wait_time: '10 mins',
        services: JSON.stringify(['Income Certificate', 'Caste Certificate', 'Aadhaar Enrollment', 'Electricity Bill Payment'])
      },
      {
        name: 'CSC & MeeSeva Madhapur',
        latitude: 17.448293,
        longitude: 78.391485,
        address: 'H.No 1-98/5, Beside Metro Station Pillar C1653, Madhapur, Hyderabad - 500081',
        rating: 4.5,
        wait_time: '5 mins',
        services: JSON.stringify(['Caste Certificate', 'Birth Certificate', 'PAN Application', 'Passport Seva Assistant'])
      },
      {
        name: 'MeeSeva Center Begumpet',
        latitude: 17.437462,
        longitude: 78.459345,
        address: 'Shop 4, Municipal Complex, Prakash Nagar, Begumpet, Hyderabad - 500016',
        rating: 3.9,
        wait_time: '25 mins',
        services: JSON.stringify(['Income Certificate', 'Death Certificate', 'Pensions Submit', 'Voter ID Registration'])
      },
      {
        name: 'Kukatpally MeeSeva Portal',
        latitude: 17.494793,
        longitude: 78.399587,
        address: 'Phase-1, KPHB Colony, Kukatpally, Hyderabad - 500072 (Near Remedy Hospital)',
        rating: 4.1,
        wait_time: '15 mins',
        services: JSON.stringify(['Birth Certificate', 'Death Certificate', 'Business Registration', 'Land Record Adangal'])
      }
    ];

    for (let c of defaultCenters) {
      await rawQuery(
        `INSERT INTO meeseva_centers (name, latitude, longitude, address, rating, wait_time, services) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [c.name, c.latitude, c.longitude, c.address, c.rating, c.wait_time, c.services]
      );
    }
  }

  // 4. Seed Officer/Admin Account
  const adminCheck = await rawQuery("SELECT count(*) as count FROM users WHERE role = 'admin'");
  const adminCount = parseInt(adminCheck.rows[0].count);

  if (adminCount === 0) {
    console.log('Seeding officer admin account...');
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('officer123', 10);
    await rawQuery(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)`,
      ['officer@onecitizen.gov.in', hash, 'admin']
    );
    console.log('Officer account created: officer@onecitizen.gov.in / officer123');
  }
}

module.exports = {
  initDb,
  ensureInitialized,
  query,
  getDbType: () => dbType
};
