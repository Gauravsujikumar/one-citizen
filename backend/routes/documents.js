// routes/documents.js - Document Vault & OCR Routes
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db');
const firestore = require('../firestore');
const { authenticateToken } = require('./auth');

const AI_SERVICES_URL = process.env.AI_SERVICES_URL || 'http://127.0.0.1:8000';

// Helper: document type code to human-readable label
function getDocTypeLabel(type) {
  const labels = {
    aadhaar: 'Aadhaar Card', pan: 'PAN Card', income: 'Income Certificate',
    caste: 'Caste Certificate', residence: 'Residence Certificate',
    ration: 'Ration Card', degree: 'Degree Certificate',
    birth: 'Birth Certificate', death: 'Death Certificate',
    passport: 'Passport', driving: 'Driving License',
    driving_license: 'Driving License', voter: 'Voter ID Card'
  };
  return labels[type] || type;
}

// Setup File Upload Storage
const isVercel = !!process.env.VERCEL;

// Resolve correct uploads directory (handles read-only Vercel filesystem)
let uploadsDir = path.resolve(__dirname, '../uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (err) {
  uploadsDir = path.join(os.tmpdir(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch (tmpErr) {}
  }
}

const diskStorageConfig = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: isVercel ? multer.memoryStorage() : diskStorageConfig,
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, JPEG, PNG, and PDF files are allowed.'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper: get a temporary file path for OCR processing (writes buffer to /tmp on Vercel)
function getFilePath(reqFile) {
  if (reqFile.path) return reqFile.path; // diskStorage — already on disk
  // memoryStorage — write buffer to /tmp
  const tmpPath = path.join(os.tmpdir(), reqFile.fieldname + '-' + Date.now() + path.extname(reqFile.originalname));
  fs.writeFileSync(tmpPath, reqFile.buffer);
  return tmpPath;
}

// Helper: get the stored filename reference
function getFileName(reqFile) {
  if (reqFile.filename) return reqFile.filename; // diskStorage
  // memoryStorage — generate a virtual filename
  return reqFile.fieldname + '-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(reqFile.originalname);
}

// Upload Document and Extract Data via OCR
router.post('/upload', authenticateToken, upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { document_type } = req.body;
  if (!document_type) {
    return res.status(400).json({ error: 'document_type is required (e.g. aadhaar, pan, income, etc.)' });
  }

  const isTempFile = !!req.file.buffer;
  const filePath = getFilePath(req.file);
  const storedFileName = getFileName(req.file);
  const documentId = 'doc_' + Math.random().toString(36).substr(2, 9);

  // Write file buffer to the uploads directory for memoryStorage (Vercel)
  if (req.file.buffer) {
    try {
      const destPath = path.join(uploadsDir, storedFileName);
      fs.writeFileSync(destPath, req.file.buffer);
    } catch (writeErr) {
      console.error('[Upload] Failed to save file to uploads directory:', writeErr.message);
    }
  }

  try {
    // 1. Fetch citizen profile to inform fallback OCR if needed
    const profile = await firestore.getProfile(req.user.id);
    const profileName = profile ? profile.name : '';
    const profileDob = profile ? profile.dob : '';

    // PHOTO-TYPE DOCUMENTS: Skip OCR entirely — photos don't contain extractable text
    const photoTypes = ['passport_size_photo', 'passport_photo', 'photo', 'passport-size_photo', 'passport_size_photos'];
    // NON-OCR DOCUMENTS: Supplementary docs that don't need text extraction — just store them
    const nonOcrTypes = [
      'salary_certificate', 'employer_certificate', 'income_tax_return', 'pension_documents',
      'income_proof_of_family_members', 'school_transfer_certificate__tc_', 'school_transfer_certificate_tc_',
      'ssc_memo___educational_records', 'ssc_memo_educational_records', 'affidavit_or_self_declaration',
      'self_declaration_form', 'property_details', 'hospital_birth_report', 'death_report_from_hospital',
      'medical_certificate_of_cause_of_death', 'burial_cremation_record__if_applicable_',
      'burial_cremation_record_if_applicable_', 'bank_passbook', 'business_address_proof',
      'father_s_caste_certificate__if_available_', 'mobile_number', 'parent_mobile_number',
      'parent_aadhaar_cards', 'age_proof', 'address_proof', 'residence_proof', 'domicile_proof',
      'birth', 'aadhaar_of_deceased', 'aadhaar_of_applicant'
    ];
    const isPhotoType = photoTypes.includes(document_type);
    const isNonOcrType = nonOcrTypes.includes(document_type);

    if (isPhotoType || isNonOcrType) {
      // Replace existing document of same type
      const existingPhotoDocs = await firestore.getDocumentsByType(req.user.id, document_type);
      for (const oldDoc of existingPhotoDocs) {
        const oldFilePath = path.join(uploadsDir, oldDoc.file_path);
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
        await firestore.deleteDocument(req.user.id, oldDoc.id);
      }

      await firestore.addDocument(req.user.id, documentId, {
        user_id: req.user.id, document_type, file_path: storedFileName,
        extracted_name: '', extracted_dob: '', extracted_id_number: '',
        is_verified: 1, validation_status: JSON.stringify({ status: 'verified', issues: [] }), expires_at: 'Permanent'
      });

      return res.status(201).json({
        message: isPhotoType ? 'Photo uploaded successfully' : 'Document uploaded successfully',
        warnings: [],
        document: {
          id: documentId,
          document_type,
          file_name: req.file.originalname,
          file_path: storedFileName,
          extracted_data: {},
          validation: { status: 'verified', issues: [] }
        }
      });
    }

    // SKIP OCR: When uploading during certificate application, just store directly
    const skipOcr = req.body.skip_ocr === 'true' || req.body.skip_ocr === true;
    if (skipOcr) {
      // Replace existing document of same type
      const existingSkipDocs = await firestore.getDocumentsByType(req.user.id, document_type);
      for (const oldDoc of existingSkipDocs) {
        const oldFilePath = path.join(uploadsDir, oldDoc.file_path);
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
        await firestore.deleteDocument(req.user.id, oldDoc.id);
      }

      await firestore.addDocument(req.user.id, documentId, {
        user_id: req.user.id, document_type, file_path: storedFileName,
        extracted_name: '', extracted_dob: '', extracted_id_number: '',
        is_verified: 1, validation_status: JSON.stringify({ status: 'verified', issues: [] }), expires_at: 'Permanent'
      });

      return res.status(201).json({
        message: 'Document uploaded successfully',
        warnings: [],
        document: {
          id: documentId,
          document_type,
          file_name: req.file.originalname,
          file_path: storedFileName,
          extracted_data: {},
          validation: { status: 'verified', issues: [] }
        }
      });
    }

    // 2. Use Gemini Vision API directly for accurate OCR extraction (core docs only: aadhaar, pan, income, caste, etc.)
    let extractedData = {};
    let validationReport = { status: 'unverified', issues: [] };
    const logPath = isVercel ? path.join(os.tmpdir(), 'ocr_debug.log') : path.resolve(__dirname, '../../ocr_debug.log');

    function safeLog(msg) { try { fs.appendFileSync(logPath, msg); } catch(e) {} }

    try {
      safeLog(`\n--- Gemini Vision OCR for ${req.file.originalname} (type: ${document_type}) ---\n`);
      extractedData = await runGeminiVisionOCR(filePath, document_type, req.file.mimetype, logPath);
      if (extractedData && extractedData.name) {
        validationReport.status = 'verified';
      }
      safeLog(`Gemini result: ${JSON.stringify(extractedData)}\n`);
    } catch (gemErr) {
      safeLog(`Gemini Vision error: ${gemErr.message}\n`);
      console.warn('[OCR] Gemini Vision failed:', gemErr.message);
      // Try local fallback only if not on Vercel (Tesseract not available on serverless)
      if (!isVercel) {
        try {
          extractedData = await runLocalFallbackOCR(filePath, document_type, profileName, profileDob);
        } catch(fallbackErr) {
          console.warn('[OCR] Fallback OCR also failed:', fallbackErr.message);
        }
      }
      // If all OCR fails, still save the document as unverified (don't crash the upload)
    }

    // 2.5. Document type verification — reject wrong documents
    // A) Check via ID number patterns
    if (extractedData.id_number) {
      const idNum = (extractedData.id_number || '').trim();
      // User selected Aadhaar but uploaded PAN
      if (document_type === 'aadhaar' && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(idNum)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.status(400).json({
          error: 'Wrong document type',
          message: `You selected "Aadhaar Card" but this appears to be a PAN Card (ID: ${idNum}). Please upload the correct document.`
        });
      }
      // User selected PAN but uploaded Aadhaar
      if (document_type === 'pan' && /^\d{4}\s?\d{4}\s?\d{4}$/.test(idNum.replace(/\s/g, ''))) {
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.status(400).json({
          error: 'Wrong document type',
          message: `You selected "PAN Card" but this appears to be an Aadhaar Card (ID: ${idNum}). Please upload the correct document.`
        });
      }
    }

    // B) Check via Gemini's detected_type field
    if (extractedData.detected_type) {
      const detected = extractedData.detected_type.toLowerCase().trim();
      const selected = document_type.toLowerCase().trim();
      
      // All document types that can be distinguished
      const allTypes = ['aadhaar', 'pan', 'voter', 'driving', 'driving_license', 'passport', 'ration', 'income', 'caste', 'residence', 'birth', 'death'];
      // Normalize driving_license to driving for comparison
      const normalizeType = (t) => t === 'driving_license' ? 'driving' : t;
      const normDetected = normalizeType(detected);
      const normSelected = normalizeType(selected);
      
      const isKnownSelected = allTypes.map(normalizeType).includes(normSelected);
      const isKnownDetected = allTypes.map(normalizeType).includes(normDetected);
      
      // Reject if both are known types and they don't match
      if (isKnownSelected && isKnownDetected && normDetected !== normSelected) {
        const detectedLabel = getDocTypeLabel(detected) || detected.toUpperCase();
        const selectedLabel = getDocTypeLabel(selected) || selected.toUpperCase();
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.status(400).json({
          error: 'Document type mismatch',
          message: `You selected "${selectedLabel}" but the uploaded document is a "${detectedLabel}". Please upload the correct document type.`,
          typeMismatch: { selected: selectedLabel, detected: detectedLabel }
        });
      }
    }

    // --- Fuzzy name matching helper (Levenshtein distance) ---
    function levenshtein(a, b) {
      const m = a.length, n = b.length;
      const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = Math.min(
            dp[i-1][j] + 1, dp[i][j-1] + 1,
            dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)
          );
        }
      }
      return dp[m][n];
    }
    // Two words are "fuzzy equal" if edit distance ≤ 2 for short words, ≤ 3 for long words
    function fuzzyWordMatch(w1, w2) {
      const maxDist = Math.max(w1.length, w2.length) <= 5 ? 2 : 3;
      return levenshtein(w1, w2) <= maxDist;
    }

    // 3. Cross-verify OCR Name with profile — reject if name doesn't match
    // Case-insensitive, order-insensitive, fuzzy comparison
    if (profile && profile.name && extractedData.name && document_type !== 'aadhaar') {
      const pn = profile.name.toLowerCase().trim();
      const en = extractedData.name.toLowerCase().trim();
      const pnWords = pn.split(/\s+/).filter(w => w.length > 0).sort();
      const enWords = en.split(/\s+/).filter(w => w.length > 0).sort();
      
      // Level 1: exact match (case-insensitive)
      const exactMatch = pn === en;
      // Level 2: substring match
      const substringMatch = pn.includes(en) || en.includes(pn);
      // Level 3: same words in any order
      const wordsMatch = pnWords.join(' ') === enWords.join(' ');
      // Level 4: fuzzy word-pair matching (handles OCR typos like Sujl ≈ Sujit)
      const fuzzyWordsMatch = pnWords.length === enWords.length && 
        pnWords.every(pw => enWords.some(ew => fuzzyWordMatch(pw, ew)));
      // Level 5: overall similarity > 70%
      const dist = levenshtein(pn.replace(/\s+/g, ''), en.replace(/\s+/g, ''));
      const maxLen = Math.max(pn.replace(/\s+/g, '').length, en.replace(/\s+/g, '').length);
      const similarity = maxLen > 0 ? (1 - dist / maxLen) : 0;
      const isSimilarEnough = similarity >= 0.7;
      
      if (!exactMatch && !substringMatch && !wordsMatch && !fuzzyWordsMatch && !isSimilarEnough) {
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.status(400).json({
          error: 'Document data mismatch',
          message: `Upload rejected — the Name on this document does not match your profile. This document may belong to someone else.`,
          mismatches: [{
            field: 'Name',
            newValue: extractedData.name,
            existingValue: profile.name,
            existingDocType: 'profile'
          }]
        });
      }
    }

    // Cross-document consistency: compare name and DOB against Aadhaar card only (source of truth)
    const aadhaarDocsForValidation = await firestore.getDocumentsByType(req.user.id, 'aadhaar');
    const aadhaarForValidation = { rows: aadhaarDocsForValidation };
    const newName = (extractedData.name || '').toLowerCase().trim();
    const newDob = (extractedData.dob || '').trim();
    const mismatchFields = [];
    const warnings = [];

    // Helper: check if two names have the same words (case-insensitive, order-insensitive)
    function areNamesSame(name1, name2) {
      const parts1 = name1.toLowerCase().split(/\s+/).filter(p => p.length > 0).sort();
      const parts2 = name2.toLowerCase().split(/\s+/).filter(p => p.length > 0).sort();
      if (parts1.length === 0 || parts2.length === 0) return false;
      return parts1.join(' ') === parts2.join(' ');
    }

    if (aadhaarForValidation.rows.length > 0) {
      const aadhaar = aadhaarForValidation.rows[0];
      const aadhaarName = (aadhaar.extracted_name || '').toLowerCase().trim();
      const aadhaarDob = (aadhaar.extracted_dob || '').trim();

      // Check name against Aadhaar — case-insensitive, order-insensitive, fuzzy
      if (newName && aadhaarName && newName !== aadhaarName) {
        const anWords = aadhaarName.split(/\s+/).filter(w => w.length > 0).sort();
        const nnWords = newName.split(/\s+/).filter(w => w.length > 0).sort();
        const substringMatch = newName.includes(aadhaarName) || aadhaarName.includes(newName);
        const wordsMatch = anWords.join(' ') === nnWords.join(' ');
        const fuzzyWordsMatch = anWords.length === nnWords.length && 
          anWords.every(aw => nnWords.some(nw => fuzzyWordMatch(aw, nw)));
        const dist = levenshtein(newName.replace(/\s+/g, ''), aadhaarName.replace(/\s+/g, ''));
        const maxLen = Math.max(newName.replace(/\s+/g, '').length, aadhaarName.replace(/\s+/g, '').length);
        const isSimilarEnough = maxLen > 0 ? (1 - dist / maxLen) >= 0.7 : false;
        
        if (!substringMatch && !wordsMatch && !fuzzyWordsMatch && !isSimilarEnough) {
          mismatchFields.push({
            field: 'Name',
            newValue: extractedData.name,
            existingValue: aadhaar.extracted_name,
            existingDocType: 'aadhaar'
          });
        }
      }

      // Check DOB only if the document actually has a DOB extracted
      if (newDob && newDob.length > 0 && aadhaarDob && newDob !== aadhaarDob) {
        mismatchFields.push({
          field: 'Date of Birth',
          newValue: extractedData.dob,
          existingValue: aadhaar.extracted_dob,
          existingDocType: 'aadhaar'
        });
      }
    }

    if (mismatchFields.length > 0) {
      // Return error - don't allow upload with mismatched data
      // Clean up the uploaded file
      try { fs.unlinkSync(filePath); } catch (e) {}
      const fieldNames = mismatchFields.map(m => m.field).join(' and ');
      return res.status(400).json({
        error: 'Document data mismatch',
        message: `Upload rejected — the ${fieldNames} on this document does not match your Aadhaar Card. This document may belong to someone else.`,
        mismatches: mismatchFields
      });
    }

    // 4. Save Document details to DB (initially set to 1/verified if DigiLocker, otherwise 0/unverified until citizen confirms details)
    const isVerified = (req.file.originalname && req.file.originalname.startsWith('digilocker_')) ? 1 : 0;
    if (isVerified) {
      validationReport.status = 'verified';
      validationReport.issues = [];
    }

    // Check expiry / validity date
    const expiryStr = extractedData.validity_date || extractedData.expiry || '';
    let isExpired = false;
    if (expiryStr && expiryStr !== 'Permanent') {
      const parts = expiryStr.split('/');
      let expiryDate;
      if (parts.length === 3) {
        expiryDate = new Date(parts[2], parts[1] - 1, parts[0]); // DD/MM/YYYY
      } else {
        expiryDate = new Date(expiryStr);
      }
      if (!isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
        isExpired = true;
        validationReport.issues = validationReport.issues || [];
        validationReport.issues.push(`Document expired on ${expiryStr}. Please apply for a new ${getDocTypeLabel(document_type)}.`);
        validationReport.expired = true;
      }
    }

    validationReport.extracted_data = extractedData;

    // Replace existing document of same type (one document per type)
    const existingOcrDocs = await firestore.getDocumentsByType(req.user.id, document_type);
    for (const oldDoc of existingOcrDocs) {
      const oldFilePath = path.join(uploadsDir, oldDoc.file_path);
      try { fs.unlinkSync(oldFilePath); } catch (e) { /* file may already be gone */ }
      await firestore.deleteDocument(req.user.id, oldDoc.id);
    }

    await firestore.addDocument(req.user.id, documentId, {
      user_id: req.user.id, document_type, file_path: storedFileName,
      extracted_name: extractedData.name || '', extracted_dob: extractedData.dob || '',
      extracted_id_number: extractedData.id_number || '',
      is_verified: isVerified, validation_status: JSON.stringify(validationReport),
      expires_at: extractedData.validity_date || extractedData.expiry || 'Permanent'
    });

    // 5. Auto-Fill Digital Twin Profile with ALL Extracted Details
    if (profile) {
      const profileUpdates = {};
      if (document_type === 'aadhaar') {
        if (extractedData.name) profileUpdates.name = extractedData.name;
        if (extractedData.dob) profileUpdates.dob = extractedData.dob;
      }
      if (document_type === 'income' && extractedData.income_amount) {
        profileUpdates.income_amount = Number(extractedData.income_amount);
        profileUpdates.income_category = extractedData.income_amount > 500000 ? 'high' : extractedData.income_amount > 200000 ? 'medium' : 'low';
      }
      if (document_type === 'caste' && extractedData.caste) {
        profileUpdates.caste = extractedData.caste;
      }
      if (Object.keys(profileUpdates).length > 0) {
        await firestore.updateProfile(req.user.id, profileUpdates);
        console.log('Auto-updated citizen profile from OCR:', Object.keys(profileUpdates));
      }
    }

    res.status(201).json({
      message: 'Document uploaded and processed successfully',
      warnings: warnings,
      document: {
        id: documentId,
        document_type,
        file_name: req.file.originalname,
        file_path: storedFileName,
        extracted_data: extractedData,
        validation: validationReport
      }
    });

  } catch (err) {
    console.error('[Upload Error]', err.message, err.stack);
    res.status(500).json({ error: 'Failed to upload document: ' + err.message });
  } finally {
    if (isTempFile) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.error('Failed to clean up temporary file:', e.message);
      }
    }
  }
});

// Get all documents in the Vault
router.get('/', authenticateToken, async (req, res) => {
  try {
    const docs = await firestore.getDocuments(req.user.id);
    const parsed = docs.map(doc => {
      if (typeof doc.validation_status === 'string') {
        try { doc.validation_status = JSON.parse(doc.validation_status); } catch (e) { doc.validation_status = { status: 'unverified', issues: [] }; }
      }
      return doc;
    });
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve vault documents' });
  }
});

// Delete document from Vault
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const allDocs = await firestore.getDocuments(req.user.id);
    const doc = allDocs.find(d => d.id === req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found or unauthorized' });
    }

    await firestore.deleteDocument(req.user.id, req.params.id);

    // Attempt to delete physical file
    if (doc.file_path) {
      const filePath = path.join(uploadsDir, doc.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    res.json({ message: 'Document deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Verify / Approve document
router.put('/:id/verify', authenticateToken, async (req, res) => {
  try {
    // Verify ownership
    const allDocs = await firestore.getDocuments(req.user.id);
    const doc = allDocs.find(d => d.id === req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found or unauthorized' });
    }

    let validationStatus = {};
    if (typeof doc.validation_status === 'string') {
      try { validationStatus = JSON.parse(doc.validation_status || '{}'); } catch (e) { validationStatus = {}; }
    } else {
      validationStatus = doc.validation_status || {};
    }

    validationStatus.status = 'verified';
    validationStatus.issues = [];

    // Update the document verification status
    const firestoreAvail = await firestore.checkFirestore();
    if (firestoreAvail) {
      const firestoreDb = firestore.getFirestore();
      await firestoreDb
        .collection('citizen_profiles').doc(String(req.user.id))
        .collection('documents').doc(req.params.id)
        .set({ is_verified: 1, validation_status: JSON.stringify(validationStatus) }, { merge: true });
    } else {
      const db = require('../db');
      await db.query(
        'UPDATE documents SET is_verified = 1, validation_status = $1 WHERE id = $2 AND user_id = $3',
        [JSON.stringify(validationStatus), req.params.id, req.user.id]
      );
    }

    // Auto-fill profile from newly verified document
    const profile = await firestore.getProfile(req.user.id);
    if (profile) {
      const extData = validationStatus.extracted_data || {};
      const profileUpdates = {};

      if (doc.document_type === 'aadhaar') {
        if (doc.extracted_name) profileUpdates.name = doc.extracted_name;
        if (doc.extracted_dob) profileUpdates.dob = doc.extracted_dob;
      }
      if (doc.document_type === 'income') {
        const incomeAmount = extData.income_amount || 0;
        if (incomeAmount > 0) {
          profileUpdates.income_amount = Number(incomeAmount);
          profileUpdates.income_category = incomeAmount > 500000 ? 'high' : incomeAmount > 200000 ? 'medium' : 'low';
        }
      }
      if (doc.document_type === 'caste' && extData.caste) {
        profileUpdates.caste = extData.caste;
      }

      if (Object.keys(profileUpdates).length > 0) {
        await firestore.updateProfile(req.user.id, profileUpdates);
        console.log('[Verify] Auto-updated citizen profile:', Object.keys(profileUpdates));
      }
    }

    res.json({ message: 'Document verified successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to verify document' });
  }
});

// Gemini Vision OCR — sends actual image to Gemini multimodal API for accurate extraction
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

async function runGeminiVisionOCR(filePath, docType, mimeType, logPath) {
  if (!GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY configured');

  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString('base64');
  const mediaMime = mimeType || 'image/jpeg';

  const docTypeLabels = {
    aadhaar: 'Aadhaar Card (Indian UID)',
    pan: 'PAN Card (Indian tax ID)',
    voter: 'Voter ID Card (EPIC)',
    driving: 'Driving License',
    ration: 'Ration Card',
    passport: 'Passport',
    income: 'Income Certificate',
    caste: 'Caste Certificate',
    birth: 'Birth Certificate',
    residence: 'Residence Certificate'
  };

  const docLabel = docTypeLabels[docType] || docType;

  let prompt;
  if (docType === 'income') {
    prompt = `You are a document OCR expert. This is an image of an Indian Income Certificate issued by a government office (MeeSeva/Tahsildar).
IMPORTANT INSTRUCTIONS FOR INCOME CERTIFICATE:
- The "name" field should be the RECIPIENT/APPLICANT name (the person the certificate is issued FOR), NOT the Tahsildar or issuing officer.
- The recipient's name typically appears after "Sri/Smt/Kumari" in the certificate body text, often in the bottom-left or middle section.
- The application/reference number is usually in the TOP-RIGHT corner of the document.
- The income amount is the annual income figure mentioned in the certificate.
- The issuing officer's name (Tahsildar/MRO) appears at the bottom with a signature - DO NOT use this as the "name".
- Look for father's name after "S/O" or "D/O" or "W/O".

Return ONLY a valid JSON object:
{
  "name": "Full name of the RECIPIENT/APPLICANT (NOT the officer who signed it)",
  "father_name": "Father's/Husband's name from S/O or D/O or W/O",
  "dob": "Date of birth if present, in DD/MM/YYYY format",
  "gender": "Male or Female",
  "id_number": "Application/Reference number from the top-right area",
  "address": "Address of the recipient if present",
  "income_amount": "Annual income amount as a number (e.g. 120000)",
  "caste": "Caste/community if mentioned",
  "detected_type": "What type of document is this ACTUALLY? Must be one of: aadhaar, pan, voter, driving, ration, passport, income, caste, birth, residence, death",
  "expiry": "Validity date or Permanent"
}
Read ACTUAL text from the image. Do NOT guess. Use empty string if not found. Return ONLY JSON.`;
  } else if (docType === 'caste') {
    prompt = `You are a document OCR expert. This is an image of an Indian Caste Certificate issued by a government office.
IMPORTANT INSTRUCTIONS FOR CASTE CERTIFICATE:
- The "name" field should be the RECIPIENT/APPLICANT name (the person the certificate is issued FOR), NOT the issuing officer.
- The recipient's name typically appears after "Sri/Smt/Kumari" in the certificate body.
- The caste/community category (SC/ST/BC/OBC) is the key information.
- The issuing officer's name appears at the bottom with signature - DO NOT use this as "name".
- Look for father's name after "S/O" or "D/O" or "W/O".

Return ONLY a valid JSON object:
{
  "name": "Full name of the RECIPIENT/APPLICANT (NOT the officer)",
  "father_name": "Father's/Husband's name from S/O or D/O or W/O",
  "dob": "Date of birth if present, in DD/MM/YYYY format",
  "gender": "Male or Female",
  "id_number": "Certificate/Application number",
  "address": "Address of the recipient if present",
  "caste": "Caste or community category (e.g. SC, ST, BC-A, OBC etc.)",
  "detected_type": "What type of document is this ACTUALLY? Must be one of: aadhaar, pan, voter, driving, ration, passport, income, caste, birth, residence, death",
  "expiry": "Validity date or Permanent"
}
Read ACTUAL text from the image. Do NOT guess. Use empty string if not found. Return ONLY JSON.`;
  } else if (docType === 'driving' || docType === 'driving_license') {
    prompt = `You are a document OCR expert. This is an image of an Indian Driving License.
IMPORTANT INSTRUCTIONS FOR DRIVING LICENSE:
- The "name" field should contain ONLY the license holder's full name, nothing else.
- The license number is in format like "TS00 XXXXXXXXXX" or "TG003XXXXXXXXXX" — extract the FULL license number.
- Extract the Date of Birth in DD/MM/YYYY format.
- CRITICAL DATE EXTRACTION RULES:
  * Indian Driving Licenses have TWO key dates: an ISSUE/DOI date and a VALIDITY/EXPIRY date.
  * The ISSUE date is when the license was issued (recent past, e.g. 2020, 2023, 2025).
  * The EXPIRY/VALIDITY date is when the license expires (far future, e.g. 2040, 2043, 2045, 2046).
  * For the "expiry" field, you MUST return the LATER date (the one with a year like 203x, 204x, 205x).
  * NEVER put the issue date in the "expiry" field. If you see dates like 01/01/2024 and 01/01/2044, the expiry is 01/01/2044.
  * Look for labels like "Valid Till", "Validity", "NT" (Non-Transport), "TR" (Transport) near dates.
- Look for father's/husband's name (S/O, D/O, W/O).

Return ONLY a valid JSON object:
{
  "name": "ONLY the license holder's full name, no extra text",
  "father_name": "Father's/Husband's name",
  "dob": "Date of birth in DD/MM/YYYY",
  "gender": "Male or Female",
  "id_number": "The full driving license number",
  "issue_date": "The ISSUE/DOI date in DD/MM/YYYY (the earlier/past date)",
  "detected_type": "What type of document is this ACTUALLY? Must be one of: aadhaar, pan, voter, driving, ration, passport, income, caste, birth, residence, death",
  "expiry": "The LATER/FUTURE validity expiry date in DD/MM/YYYY (NOT the issue date — must be 20+ years from issue)"
}
Read ACTUAL text from the image. Do NOT guess. Use empty string if not found. Return ONLY JSON.`;
  } else {
    prompt = `You are a document OCR expert. This is an image of an Indian ${docLabel}.
Extract ALL text fields from this document image accurately. Return ONLY a valid JSON object with these fields (use empty string if not found):
{
  "name": "ONLY the full name of the HOLDER/OWNER of this document, nothing else",
  "father_name": "Father's/Husband's name if present",
  "dob": "Date of birth in DD/MM/YYYY format",
  "gender": "Male or Female",
  "id_number": "The main ID number (Aadhaar 12-digit, PAN 10-char, etc.)",
  "address": "Full address if present",
  "detected_type": "What type of document is this ACTUALLY? Must be one of: aadhaar, pan, voter, driving, ration, passport, income, caste, birth, residence, death",
  "expiry": "Expiry/validity date or Permanent"
}
IMPORTANT: Read the ACTUAL text from the image. Do NOT make up or guess any values. If a field is not visible, use empty string "".
Return ONLY the JSON object, no markdown, no explanation.`;
  }

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: mediaMime,
            data: base64Image
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048
    }
  };

  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash'
  ];

  let response = null;
  let lastError = '';

  // Try each model, with a retry on 429
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      console.log(`[Gemini OCR] Trying model ${model} (attempt ${attempt + 1})...`);
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          console.log(`[Gemini OCR] Success with model ${model}`);
          break;
        }

        const errText = await response.text().catch(() => '');
        lastError = `${model} returned ${response.status}`;
        if (logPath) try { fs.appendFileSync(logPath, `${model} error ${response.status}: ${errText.substring(0, 200)}\n`); } catch(e) {}
        
        // If rate limited, wait longer and retry
        if (response.status === 429 && attempt === 0) {
          console.log(`[Gemini OCR] Rate limited on ${model}, waiting 10s before retry...`);
          await new Promise(r => setTimeout(r, 10000));
          response = null;
          continue;
        }
        response = null;
        break; // Other error, try next model
      } catch (fetchErr) {
        lastError = `${model} fetch failed: ${fetchErr.message}`;
        response = null;
        break;
      }
    }
    if (response && response.ok) break;
  }

  if (!response || !response.ok) {
    throw new Error(`All Gemini models failed. Last error: ${lastError}`);
  }

  const result = await response.json();
  const textContent = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (logPath) try { fs.appendFileSync(logPath, `Gemini raw response: ${textContent.substring(0, 500)}\n`); } catch(e) {}

  // Parse JSON from response (strip markdown code fences if present)
  let jsonStr = textContent.trim();
  // Remove markdown code fences with any language tag
  jsonStr = jsonStr.replace(/^```\w*\s*/i, '').replace(/\s*```\s*$/i, '');
  // If still not valid JSON, try to extract JSON object from the text
  if (!jsonStr.startsWith('{')) {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
  }
  // Remove trailing commas before closing braces (common Gemini issue)
  jsonStr = jsonStr.replace(/,\s*}/g, '}');

  try {
    const parsed = JSON.parse(jsonStr);
    console.log('[Gemini OCR] Successfully extracted:', parsed.name, parsed.id_number);
    return parsed;
  } catch (parseErr) {
    // Try to recover truncated JSON — Gemini sometimes cuts off the response
    // Strip the last incomplete key-value pair and close the object
    let recovered = jsonStr;
    // Remove trailing comma and incomplete field
    recovered = recovered.replace(/,\s*"[^"]*"\s*:\s*[^,}]*$/s, '');
    // Remove any trailing comma
    recovered = recovered.replace(/,\s*$/, '');
    // Add closing brace if missing
    if (!recovered.trim().endsWith('}')) recovered = recovered.trim() + '}';
    try {
      const parsed = JSON.parse(recovered);
      console.log('[Gemini OCR] Recovered truncated JSON. Extracted:', parsed.name, parsed.id_number);
      return parsed;
    } catch (e2) {
      if (logPath) try { fs.appendFileSync(logPath, `Gemini JSON parse error: ${parseErr.message}\nRaw: ${jsonStr.substring(0, 500)}\n`); } catch(e) {}
      throw new Error('Failed to parse Gemini response as JSON');
    }
  }
}

// Local OCR fallback using Tesseract if Gemini is unavailable
async function runLocalFallbackOCR(filePath, docType, profileName, profileDob) {
  let ocrText = '';
  try {
    const Tesseract = require('tesseract.js');
    const result = await Tesseract.recognize(filePath, 'eng+tel', {
      logger: () => {}
    });
    ocrText = result.data.text || '';
    console.log('[OCR] Tesseract extracted text length:', ocrText.length);
    console.log('[OCR] First 300 chars:', ocrText.substring(0, 300));
  } catch (tessErr) {
    console.warn('[OCR] Tesseract failed:', tessErr.message);
    ocrText = '';
  }

  const text = ocrText;
  const textLower = text.toLowerCase();
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 2);

  // --- Extract Name ---
  let name = '';

  // For Income/Caste certificates: find recipient name after Sri/Smt/Kumari (NOT the officer)
  if (docType === 'income' || docType === 'caste') {
    for (const line of lines) {
      // Match patterns like "Sri/Smt/Kumari NAME S/O ..." or "SA/Srimathi/Kumari NAME"
      const m = line.match(/(?:Sri|Sri\.|Smt|Smt\.|Kumari|Srimathi|SA\/Srimathi\/Kumari)\s+([A-Z][A-Za-z\s.]+?)(?:\s+(?:S\/O|D\/O|W\/O|C\/O|5\/0|5\/O|S\/0|s\/o|son|daughter|wife)|,|\s*$)/i);
      if (m && m[1] && m[1].trim().length > 2) {
        name = m[1].trim().replace(/[|]/g, '').replace(/\s+/g, ' ');
        break;
      }
    }
    // Also try "certify that ... NAME" pattern
    if (!name) {
      const fullText = lines.join(' ');
      const certMatch = fullText.match(/certify\s+that\s+.*?(?:Sri|Smt|Kumari)\s+([A-Z][A-Za-z\s.]+?)(?:\s+(?:S\/O|D\/O|W\/O|is|,))/i);
      if (certMatch && certMatch[1] && certMatch[1].trim().length > 2) {
        name = certMatch[1].trim().replace(/[|]/g, '').replace(/\s+/g, ' ');
      }
    }
  }

  // Strategy 1: Find line with "name:" label
  if (!name) {
    for (const line of lines) {
      const m = line.match(/(?:name|naam)\s*[:\-]\s*(.+)/i);
      if (m && m[1] && m[1].trim().length > 3) {
        name = m[1].trim().replace(/[|]/g, '').replace(/\s+/g, ' ');
        break;
      }
    }
  }
  
  // Strategy 2: For Aadhaar - find English name line (2+ words starting with caps, no digits, not a header)
  if (!name) {
    const skipWords = ['government', 'india', 'unique', 'identification', 'authority', 'enrolment', 'registration', 'male', 'female', 'address', 'house', 'vidya', 'nagar', 'near', 'tahsildar', 'mandal', 'revenue', 'district', 'certificate'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/[|]/g, '').trim();
      // Must be 2+ words, mostly letters, starts with uppercase
      if (/^[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+/.test(line) && !/\d{3}/.test(line) && line.length < 45 && line.length > 5) {
        const lower = line.toLowerCase();
        if (!skipWords.some(w => lower.includes(w))) {
          name = line.replace(/[^A-Za-z\s.]/g, '').replace(/\s+/g, ' ').trim();
          break;
        }
      }
    }
  }
  
  if (!name) name = profileName || '';

  // --- Extract Father's Name ---
  // OCR often misreads S/O as 5/0, S/0, 5/O etc.
  let fatherName = '';
  for (const line of lines) {
    const m = line.match(/(?:S\/O|D\/O|C\/O|W\/O|5\/0|5\/O|S\/0|s\/o)\s*[:\-.]?\s*(.+)/i);
    if (m && m[1]) {
      let fn = m[1].replace(/[|]/g, '').replace(/\s+/g, ' ').trim();
      // Remove trailing digits or special chars
      fn = fn.replace(/\d+$/g, '').trim();
      if (fn.length > 2 && fn.length < 60) {
        fatherName = fn;
        break;
      }
    }
  }
  if (!fatherName) {
    for (const line of lines) {
      const m = line.match(/(?:Father|Father'?s?\s*Name|Husband)\s*[:\-]?\s*(.+)/i);
      if (m && m[1]) {
        fatherName = m[1].replace(/[|]/g, '').replace(/\s+/g, ' ').trim();
        break;
      }
    }
  }

  // --- Extract DOB ---
  let dob = '';
  const dobPatterns = [
    /(?:DOB|Date\s*of\s*Birth|Birth|Year\s*of\s*Birth)\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]\d{1,2}[\s\/\-\.]\d{4})/i,
    /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/,
    /(\d{4}[\/\-]\d{2}[\/\-]\d{2})/,
  ];
  for (const pat of dobPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      let d = m[1].replace(/[\s\.]/g, '/').replace(/-/g, '/');
      if (/^\d{4}\//.test(d)) {
        const parts = d.split('/');
        d = parts[2] + '/' + parts[1] + '/' + parts[0];
      }
      dob = d;
      break;
    }
  }
  if (!dob) dob = profileDob || '';

  // --- Extract Gender ---
  let gender = '';
  if (/\b(male|पुरुष|MALE)\b/i.test(text) && !/female/i.test(text)) gender = 'Male';
  else if (/\b(female|महिला|FEMALE|स्त्री)\b/i.test(text)) gender = 'Female';

  // --- Extract Aadhaar Number ---
  let idNumber = '';
  const aadhaarMatch = text.match(/\b(\d{4}\s?\d{4}\s?\d{4})\b/);
  if (aadhaarMatch) {
    idNumber = aadhaarMatch[1].replace(/(\d{4})\s?(\d{4})\s?(\d{4})/, '$1 $2 $3');
  }

  // --- Extract PAN Number ---
  const panMatch = text.toUpperCase().match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
  if (panMatch) {
    idNumber = panMatch[1];
  }

  // --- Extract Address ---
  // Collect lines after S/O (father) line that look like address parts
  let address = '';
  let fatherLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/(?:S\/O|D\/O|C\/O|W\/O|5\/0|5\/O|S\/0|Father)/i.test(lines[i])) {
      fatherLineIdx = i;
      break;
    }
  }
  if (fatherLineIdx >= 0) {
    const addrLines = [];
    for (let i = fatherLineIdx + 1; i < lines.length && addrLines.length < 5; i++) {
      const line = lines[i].replace(/[|]/g, '').trim();
      if (!line || line.length < 3) continue;
      // Stop at DOB, gender, Aadhaar number lines
      if (/\b(DOB|Date\s*of\s*Birth|Male|Female|\d{4}\s\d{4}\s\d{4})\b/i.test(line)) break;
      // Skip lines that are just Telugu text or noise
      if (/^[A-Za-z0-9\s,.\-\/]+$/.test(line) && line.length > 3) {
        addrLines.push(line);
      }
    }
    if (addrLines.length > 0) {
      address = addrLines.join(', ').replace(/\s+/g, ' ').trim().substring(0, 200);
    }
  }
  // Fallback: keyword-based
  if (!address) {
    const addrMatch = text.match(/(?:Address|Addr|पता)\s*[:\-]?\s*(.+(?:\n.+){0,4})/i);
    if (addrMatch && addrMatch[1]) {
      address = addrMatch[1].replace(/\n/g, ', ').replace(/\s+/g, ' ').trim().substring(0, 200);
    }
  }

  // --- Detect document type from text ---
  let detectedType = docType;
  if (/aadhaar|आधार|uidai|unique\s*identification/i.test(text)) detectedType = 'aadhaar';
  else if (/income\s*tax|permanent\s*account|pan\s*card/i.test(text)) detectedType = 'pan';
  else if (/income\s*certificate|annual\s*income|tahsildar/i.test(text)) detectedType = 'income';
  else if (/caste\s*certificate|community|backward\s*class/i.test(text)) detectedType = 'caste';
  else if (/residence\s*cert|residential\s*cert|proof\s*of\s*residence/i.test(text)) detectedType = 'residence';
  else if (/birth\s*certificate|date\s*of\s*birth.*registration/i.test(text)) detectedType = 'birth';
  else if (/death\s*certificate|death\s*report/i.test(text)) detectedType = 'death';
  else if (/driving\s*licen[cs]e|transport|motor\s*vehicle/i.test(text)) detectedType = 'driving';
  else if (/voter|election|electoral/i.test(text)) detectedType = 'voter';
  else if (/passport|republic\s*of\s*india.*passport/i.test(text)) detectedType = 'passport';
  else if (/ration\s*card|public\s*distribution/i.test(text)) detectedType = 'ration';

  // --- Build response based on document type ---
  if (docType === 'aadhaar') {
    return {
      name: name, father_name: fatherName, dob: dob,
      id_number: idNumber || '', address: address,
      gender: gender || '', expiry: 'Permanent', detected_type: detectedType
    };
  } else if (docType === 'pan') {
    // PAN-specific: extract name (usually ALL CAPS lines), father's name
    let panName = name;
    let panFather = fatherName;
    if (!panName) {
      // PAN cards have names in ALL CAPS - find lines with 2+ uppercase words
      for (const line of lines) {
        const clean = line.replace(/[|]/g, '').trim();
        if (/^[A-Z][A-Z\s]{4,40}$/.test(clean) && !/INCOME|TAX|DEPARTMENT|GOVT|INDIA|PERMANENT|ACCOUNT|CARD|SIGNATURE/.test(clean)) {
          if (!panName) { panName = clean; }
          else if (!panFather) { panFather = clean; break; }
        }
      }
    }
    return {
      name: panName || name, father_name: panFather || fatherName, dob: dob,
      id_number: idNumber || '', expiry: 'Permanent', detected_type: detectedType
    };
  } else if (docType === 'income') {
    let incomeAmount = 0;
    const incMatch = text.match(/(?:income|annual|salary)\s*[:\-]?\s*(?:Rs\.?|INR)?\s*([\d,]+)/i);
    if (incMatch) incomeAmount = parseInt(incMatch[1].replace(/,/g, ''));
    return {
      name: name, father_name: fatherName, dob: dob,
      id_number: idNumber || '', income_amount: incomeAmount || 0,
      address: address, detected_type: detectedType,
      expiry: 'Permanent'
    };
  } else if (docType === 'caste') {
    let casteName = '';
    const casteMatch = text.match(/(?:caste|community|category)\s*[:\-]?\s*([A-Za-z\s\/\-]+)/i);
    if (casteMatch) casteName = casteMatch[1].trim().split(/\s{2,}/)[0].trim();
    return {
      name: name, father_name: fatherName, dob: dob,
      id_number: idNumber || '', caste: casteName || '',
      address: address, detected_type: detectedType,
      expiry: 'Permanent'
    };
  } else if (docType === 'birth') {
    return {
      name: name, dob: dob, id_number: idNumber || '',
      place_of_birth: '', father_name: fatherName,
      expiry: 'Permanent', detected_type: detectedType
    };
  } else if (docType === 'driving' || docType === 'driving_license') {
    // Extract driving license number
    let dlNumber = idNumber || '';
    if (!dlNumber) {
      const dlMatch = text.match(/(?:DL\.?\s*No\.?|License\s*No\.?|Licence\s*No\.?)\s*[:\-]?\s*([A-Z0-9\s\-]{10,25})/i);
      if (dlMatch) dlNumber = dlMatch[1].trim();
    }
    if (!dlNumber) {
      const longNum = text.match(/\b(\d{16,20})\b/);
      if (longNum) dlNumber = longNum[1];
    }
    // Extract ALL dates from the text and pick the LATEST one as expiry
    let dlExpiry = '';
    const allDates = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/g) || [];
    if (allDates.length > 0) {
      // Parse all dates and find the one furthest in the future
      let latestDate = null;
      let latestStr = '';
      allDates.forEach(ds => {
        const parts = ds.split(/[\/\-]/);
        if (parts.length === 3) {
          const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
          if (!isNaN(d.getTime()) && (!latestDate || d > latestDate)) {
            // Skip DOB (dates before 2010)
            if (d.getFullYear() >= 2010) {
              latestDate = d;
              latestStr = ds;
            }
          }
        }
      });
      dlExpiry = latestStr;
    }
    return {
      name: name, father_name: fatherName, dob: dob,
      id_number: dlNumber, address: address,
      expiry: dlExpiry, detected_type: detectedType
    };
  } else if (docType === 'voter') {
    return {
      name: name, dob: dob, id_number: idNumber || '',
      expiry: 'Permanent', detected_type: detectedType
    };
  }

  return {
    name: name, dob: dob, id_number: idNumber || '',
    expiry: 'Permanent', detected_type: detectedType
  };
}

module.exports = router;
