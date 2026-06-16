// firestore.js - Dual-mode data layer: Firestore with SQLite fallback
const admin = require('firebase-admin');
const db = require('./db');

let firestoreDb = null;
let firestoreAvailable = null; // null = untested, true/false = tested

async function checkFirestore() {
  if (firestoreAvailable !== null) return firestoreAvailable;
  try {
    if (!admin.apps.length) { firestoreAvailable = false; return false; }
    const fs = admin.firestore();
    await fs.collection('_health').doc('check').set({ ts: Date.now() });
    firestoreDb = fs;
    firestoreAvailable = true;
    console.log('[Data Layer] Firestore connected successfully.');
    return true;
  } catch (e) {
    firestoreAvailable = false;
    console.warn('[Data Layer] Firestore unavailable, using SQLite fallback:', e.message);
    return false;
  }
}

function getFirestore() {
  if (!firestoreDb && admin.apps.length) {
    firestoreDb = admin.firestore();
  }
  return firestoreDb;
}

// Retry Firestore every 60s if it was unavailable (local dev only — serverless doesn't support intervals)
if (!process.env.VERCEL) {
  setInterval(async () => {
    if (firestoreAvailable === false) {
      firestoreAvailable = null;
      await checkFirestore();
    }
  }, 60000);
}

// ══════════════════════════════════════════════
//  USER FUNCTIONS
// ══════════════════════════════════════════════

async function getUser(userId) {
  if (await checkFirestore()) {
    const doc = await firestoreDb.collection('users').doc(String(userId)).get();
    if (!doc.exists) return null;
    return { id: userId, ...doc.data() };
  }
  const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows && result.rows[0] || null;
}

async function getUserByFirebaseUid(uid) {
  if (await checkFirestore()) {
    const snapshot = await firestoreDb.collection('users').where('firebase_uid', '==', uid).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }
  // SQLite fallback - look by email since SQLite doesn't store firebase_uid
  const result = await db.query('SELECT * FROM users WHERE email = $1', [uid.replace('demo_', '')]);
  return result.rows && result.rows[0] || null;
}

async function getUserByEmail(email) {
  if (await checkFirestore()) {
    const snapshot = await firestoreDb.collection('users').where('email', '==', email).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows && result.rows[0] || null;
}

async function createUser(data) {
  if (await checkFirestore()) {
    const userRef = firestoreDb.collection('users').doc();
    const userId = userRef.id;
    data.created_at = new Date().toISOString();
    await userRef.set(data);
    await createProfile(userId, { email: data.email || '' });
    return { id: userId, ...data };
  }
  // SQLite fallback
  // Check if user already exists
  const existing = await db.query('SELECT * FROM users WHERE email = $1', [data.email || '']);
  if (existing.rows && existing.rows[0]) {
    return existing.rows[0];
  }
  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(Math.random().toString(36), salt);
  await db.query(
    'INSERT INTO users (email, password_hash, role, mobile) VALUES ($1, $2, $3, $4)',
    [data.email || '', hash, data.role || 'citizen', data.phone || '']
  );
  const result = await db.query('SELECT * FROM users WHERE email = $1', [data.email]);
  const user = result.rows[0];
  if (user) {
    try {
      await db.query(
        `INSERT INTO citizen_profiles (user_id, name, dob, gender, occupation, education, income_category, income_amount, state, district, caste, is_farmer, family_members)
         VALUES ($1,'','','','','','',0,'','','',0,'[]')`,
        [user.id]
      );
    } catch (e) { /* profile might exist */ }
  }
  return user;
}

// ══════════════════════════════════════════════
//  PROFILE FUNCTIONS
// ══════════════════════════════════════════════

async function getProfile(userId) {
  if (await checkFirestore()) {
    const doc = await firestoreDb.collection('citizen_profiles').doc(String(userId)).get();
    if (!doc.exists) return null;
    return { user_id: userId, ...doc.data() };
  }
  const result = await db.query('SELECT * FROM citizen_profiles WHERE user_id = $1', [userId]);
  return result.rows && result.rows[0] || null;
}

async function createProfile(userId, data = {}) {
  const defaults = {
    name: '', dob: '', gender: '', occupation: '', education: '',
    income_category: '', income_amount: 0, state: '', district: '',
    caste: '', is_farmer: 0, family_members: '[]',
    father_name: '', mother_name: '', religion: '',
    marital_status: '', blood_group: '', address: '',
    city: '', pincode: '', phone: '', email: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const profileData = { ...defaults, ...data };
  if (await checkFirestore()) {
    await firestoreDb.collection('citizen_profiles').doc(String(userId)).set(profileData);
    return { user_id: userId, ...profileData };
  }
  // SQLite fallback - already created in createUser
  return { user_id: userId, ...profileData };
}

async function updateProfile(userId, data) {
  data.updated_at = new Date().toISOString();
  if (await checkFirestore()) {
    await firestoreDb.collection('citizen_profiles').doc(String(userId)).set(data, { merge: true });
    return;
  }
  // SQLite fallback
  const fields = Object.keys(data);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  const values = fields.map(f => data[f]);
  values.push(userId);
  try {
    await db.query(`UPDATE citizen_profiles SET ${sets.join(', ')} WHERE user_id = $${values.length}`, values);
  } catch (e) { console.error('[updateProfile SQLite]', e.message); }
}

// ══════════════════════════════════════════════
//  DOCUMENT FUNCTIONS
// ══════════════════════════════════════════════

async function getDocuments(userId) {
  if (await checkFirestore()) {
    const snapshot = await firestoreDb
      .collection('citizen_profiles').doc(String(userId))
      .collection('documents').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  const result = await db.query('SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return result.rows || [];
}

async function getDocumentsByType(userId, docType) {
  if (await checkFirestore()) {
    const snapshot = await firestoreDb
      .collection('citizen_profiles').doc(String(userId))
      .collection('documents')
      .where('document_type', '==', docType).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  const result = await db.query(
    'SELECT * FROM documents WHERE user_id = $1 AND document_type = $2', [userId, docType]
  );
  return result.rows || [];
}

async function addDocument(userId, docId, data) {
  data.created_at = new Date().toISOString();
  if (await checkFirestore()) {
    await firestoreDb
      .collection('citizen_profiles').doc(String(userId))
      .collection('documents').doc(docId).set(data);
    return;
  }
  await db.query(
    `INSERT INTO documents (id, user_id, document_type, file_path, extracted_name, extracted_dob, extracted_id_number, is_verified, validation_status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [docId, userId, data.document_type, data.file_path, data.extracted_name || '', data.extracted_dob || '',
     data.extracted_id_number || '', data.is_verified || 0, data.validation_status || '{}', data.expires_at || 'Permanent']
  );
}

async function deleteDocument(userId, docId) {
  if (await checkFirestore()) {
    await firestoreDb
      .collection('citizen_profiles').doc(String(userId))
      .collection('documents').doc(docId).delete();
    return;
  }
  await db.query('DELETE FROM documents WHERE id = $1', [docId]);
}

async function deleteDocumentsByType(userId, docType) {
  const docs = await getDocumentsByType(userId, docType);
  if (await checkFirestore()) {
    const batch = firestoreDb.batch();
    docs.forEach(doc => {
      const ref = firestoreDb
        .collection('citizen_profiles').doc(String(userId))
        .collection('documents').doc(doc.id);
      batch.delete(ref);
    });
    if (docs.length > 0) await batch.commit();
  } else {
    for (const doc of docs) {
      await db.query('DELETE FROM documents WHERE id = $1', [doc.id]);
    }
  }
  return docs;
}

// ══════════════════════════════════════════════
//  NOTIFICATION FUNCTIONS
// ══════════════════════════════════════════════

async function getNotifications(userId) {
  if (await checkFirestore()) {
    const snapshot = await firestoreDb
      .collection('citizen_profiles').doc(String(userId))
      .collection('notifications')
      .orderBy('created_at', 'desc').limit(20).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  return [];
}

async function addNotification(userId, data) {
  data.is_read = 0;
  data.created_at = new Date().toISOString();
  if (await checkFirestore()) {
    await firestoreDb
      .collection('citizen_profiles').doc(String(userId))
      .collection('notifications').add(data);
  }
}

async function markNotificationRead(userId, notifId) {
  if (await checkFirestore()) {
    await firestoreDb
      .collection('citizen_profiles').doc(String(userId))
      .collection('notifications').doc(notifId).update({ is_read: 1 });
  }
}

module.exports = {
  getFirestore, checkFirestore,
  getProfile, createProfile, updateProfile,
  getDocuments, getDocumentsByType, addDocument, deleteDocument, deleteDocumentsByType,
  getUser, getUserByEmail, getUserByFirebaseUid, createUser,
  getNotifications, addNotification, markNotificationRead
};
