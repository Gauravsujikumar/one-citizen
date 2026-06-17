// routes/auth.js - Auth & Profile (Digital Twin) Routes
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const admin = require('firebase-admin');

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CRITICAL: JWT_SECRET environment variable is missing in production!');
  }
  JWT_SECRET = 'onecitizen_secure_secret_key';
}

// ── Firebase Admin init (only when service account is configured) ──
let firebaseAdminReady = false;
try {
  if (!admin.apps.length) {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath) {
      const path = require('path');
      const fs = require('fs');
      const resolvedPath = path.isAbsolute(serviceAccountPath)
        ? serviceAccountPath
        : path.resolve(process.cwd(), serviceAccountPath);

      if (fs.existsSync(resolvedPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        firebaseAdminReady = true;
        console.log('[Firebase Admin] Initialized from service account.');
      } else {
        console.warn(`[Firebase Admin] Service account file not found at: ${resolvedPath}`);
      }
    } else {
      console.warn('[Firebase Admin] FIREBASE_SERVICE_ACCOUNT_PATH not set — firebase-login will be skipped.');
    }
  } else {
    firebaseAdminReady = true;
  }
} catch (e) {
  console.error('[Firebase Admin] Init error:', e.message);
}

// Middleware to verify JWT Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// User Sign Up
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Check if user exists
    const existing = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Insert user
    const userRole = 'citizen';
    const result = await db.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
      [email, hash, userRole]
    );

    // Get user id (depends on DB type)
    let userId;
    if (db.getDbType() === 'postgres') {
      const user = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      userId = user.rows[0].id;
    } else {
      userId = result.lastID;
    }

    // Initialize an empty citizen profile for this user
    await db.query(
      `INSERT INTO citizen_profiles (user_id, name, dob, gender, occupation, education, income_category, income_amount, state, district, caste, is_farmer, family_members)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [userId, '', '', '', '', '', 'low', 0, '', '', '', 0, '[]']
    );

    // Generate token
    const token = jwt.sign({ id: userId, email, role: userRole }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: userId, email, role: userRole }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error occurred during registration' });
  }
});

// User Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error occurred during login' });
  }
});

// Get User Profile (Citizen Digital Twin)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const firestore = require('../firestore');
    let profile = await firestore.getProfile(req.user.id);

    if (!profile) {
      // Auto-create empty profile if missing
      profile = await firestore.createProfile(req.user.id, { email: req.user.email || '' });
    }
    
    // Parse family members
    if (typeof profile.family_members === 'string') {
      try { profile.family_members = JSON.parse(profile.family_members || '[]'); }
      catch(e) { profile.family_members = []; }
    }

    // Auto-fill from uploaded documents in Firestore
    const docs = await firestore.getDocuments(req.user.id);
    const updates = {};

    for (let doc of docs) {
      let extData = {};
      try {
        const valStatus = typeof doc.validation_status === 'string'
          ? JSON.parse(doc.validation_status || '{}')
          : (doc.validation_status || {});
        extData = valStatus.extracted_data || {};
      } catch(e) {}

      if (doc.document_type === 'aadhaar') {
        if (!profile.name && (doc.extracted_name || extData.name)) {
          updates.name = doc.extracted_name || extData.name;
        }
        if (!profile.dob && (doc.extracted_dob || extData.dob)) {
          updates.dob = doc.extracted_dob || extData.dob;
        }
      } else if (doc.document_type === 'income') {
        const incomeVal = extData.income_amount || 0;
        if (!profile.income_amount && incomeVal > 0) {
          updates.income_amount = Number(incomeVal);
          updates.income_category = incomeVal > 500000 ? 'high' : incomeVal > 200000 ? 'medium' : 'low';
        }
      } else if (doc.document_type === 'caste') {
        if (!profile.caste && extData.caste) updates.caste = extData.caste;
      }
    }

    if (Object.keys(updates).length > 0) {
      await firestore.updateProfile(req.user.id, updates);
      Object.assign(profile, updates);
    }

    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update User Profile (Citizen Digital Twin)
router.put('/profile', authenticateToken, async (req, res) => {
  const {
    name, dob, gender, occupation, education,
    income_category, income_amount, state, district, caste, is_farmer, family_members,
    father_name, mother_name, religion, marital_status, blood_group,
    address, city, pincode, phone, email
  } = req.body;

  try {
    const firestore = require('../firestore');
    const familyStr = family_members ? JSON.stringify(family_members) : '[]';
    
    await firestore.updateProfile(req.user.id, {
      name: name || '', dob: dob || '', gender: gender || '',
      occupation: occupation || '', education: education || '',
      income_category: income_category || '', income_amount: Number(income_amount) || 0,
      state: state || '', district: district || '', caste: caste || '',
      is_farmer: is_farmer ? 1 : 0, family_members: familyStr,
      father_name: father_name || '', mother_name: mother_name || '',
      religion: religion || '', marital_status: marital_status || '',
      blood_group: blood_group || '', address: address || '',
      city: city || '', pincode: pincode || '', phone: phone || '', email: email || ''
    });

    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Firebase Auth Login (Email/Password or Phone)
// Body: { idToken: <Firebase ID token>, email: "user@example.com" }
router.post('/firebase-login', async (req, res) => {
  const { idToken, email, mobile } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Firebase ID token is required.' });

  let firebaseUid = null;
  let userEmail = email || null;
  let phoneNumber = mobile ? `+91${mobile}` : null;

  // Verify Firebase token
  const isDev = process.env.NODE_ENV === 'development';
  if (firebaseAdminReady && (idToken !== 'demo_mock_token' || !isDev)) {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      firebaseUid = decoded.uid;
      userEmail = decoded.email || userEmail;
      phoneNumber = decoded.phone_number || phoneNumber;
    } catch (e) {
      return res.status(401).json({ error: 'Invalid Firebase token: ' + e.message });
    }
  } else {
    // Only allow demo mode in development
    if (!isDev) {
      return res.status(401).json({ error: 'Mock tokens are not allowed in production.' });
    }
    // Demo mode fallback
    firebaseUid = 'demo_' + (email || mobile || 'user');
  }

  try {
    const firestore = require('../firestore');

    // Look for existing user by Firebase UID, then by email
    let user = await firestore.getUserByFirebaseUid(firebaseUid);
    if (!user && userEmail) {
      user = await firestore.getUserByEmail(userEmail);
    }

    if (!user) {
      // Auto-register: create a new citizen account in Firestore
      user = await firestore.createUser({
        firebase_uid: firebaseUid,
        email: userEmail || '',
        phone: phoneNumber || '',
        role: 'citizen'
      });
    }

    if (!user) return res.status(500).json({ error: 'Failed to create user.' });

    const token = jwt.sign(
      { id: user.id, email: user.email || userEmail, role: user.role || 'citizen' },
      JWT_SECRET, { expiresIn: '24h' }
    );
    res.json({
      message: 'Firebase login successful',
      token,
      user: { id: user.id, email: user.email || userEmail, role: user.role || 'citizen' }
    });
  } catch (err) {
    console.error('[firebase-login error]', err.message);
    res.status(500).json({ error: 'Server error during login: ' + err.message });
  }
});

// Google Sign-In - Step 1: Check if email exists
router.post('/google-check', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const result = await db.query('SELECT id, email FROM users WHERE email = $1', [email]);
    if (result.rows && result.rows[0]) {
      res.json({ status: 'existing', email: result.rows[0].email });
    } else {
      res.json({ status: 'new', email });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error.' });
  }
});

// Google Sign-In - Step 2a: Register new user with password
router.post('/google-signup', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  try {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows && existing.rows[0]) {
      return res.status(400).json({ error: 'Account already exists. Please login instead.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    await db.query(
      'INSERT INTO users (email, password_hash, role, mobile) VALUES ($1, $2, $3, $4)',
      [email, hash, 'citizen', '']
    );
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (user) {
      await db.query(
        `INSERT INTO citizen_profiles (user_id, name, dob, gender, occupation, education, income_category, income_amount, state, district, caste, is_farmer, family_members)
         VALUES ($1,$2,'','','','','low',0,'','','',0,'[]')`,
        [user.id, displayName || '']
      );
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ message: 'Account created successfully', token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error('[google-signup error]', err.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// Google Sign-In - Step 2b: Login existing user with password
router.post('/google-verify', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows || !result.rows[0]) {
      return res.status(400).json({ error: 'Account not found.' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ message: 'Login successful', token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error('[google-verify error]', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

module.exports = {
  router,
  authenticateToken
};
