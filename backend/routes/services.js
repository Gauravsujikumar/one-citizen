// routes/services.js - Gov Services, Scheme Recommendations, Auto-Fill, & Readiness Scoring
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('./auth');

const AI_SERVICES_URL = process.env.AI_SERVICES_URL || 'http://127.0.0.1:8000';

// 1. Get Government Services Catalog
router.get('/', async (req, res) => {
  const { search, category } = req.query;
  try {
    let sql = 'SELECT * FROM services';
    const params = [];

    if (search || category) {
      sql += ' WHERE ';
      const conditions = [];
      if (search) {
        conditions.push(`(name LIKE $${params.length + 1} OR category LIKE $${params.length + 1})`);
        params.push(`%${search}%`);
      }
      if (category) {
        conditions.push(`category = $${params.length + 1}`);
        params.push(category);
      }
      sql += conditions.join(' AND ');
    }

    const result = await db.query(sql, params);
    
    // Parse JSON columns
    const services = result.rows.map(s => {
      try { s.eligibility_rules = JSON.parse(s.eligibility_rules); } catch(e) {}
      try { s.required_documents = JSON.parse(s.required_documents); } catch(e) {}
      try { s.steps = JSON.parse(s.steps); } catch(e) {}
      return s;
    });

    res.json(services);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve government services' });
  }
});

// Get all applications submitted by the logged-in user
router.get('/user-applications', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, s.name as service_name, s.category as service_category, s.fees as fees
       FROM applications a
       JOIN services s ON a.service_id = s.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve user applications' });
  }
});

// Clear all applications for the authenticated user
router.delete('/clear-applications', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM applications WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'All applications cleared' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear applications' });
  }
});

// Delete a single application by ID (only owner can delete)
router.delete('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM applications WHERE id = $1 AND user_id = $2',
      [req.params.appId, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.json({ message: 'Application removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete application' });
  }
});

// 2. Get Single Service Details
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM services WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    const service = result.rows[0];
    try { service.eligibility_rules = JSON.parse(service.eligibility_rules); } catch(e) {}
    try { service.required_documents = JSON.parse(service.required_documents); } catch(e) {}
    try { service.steps = JSON.parse(service.steps); } catch(e) {}
    
    res.json(service);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve service details' });
  }
});

// Helper to calculate age from DOB string (DD/MM/YYYY)
function calculateAge(dobStr) {
  if (!dobStr) return 0;
  const parts = dobStr.split('/');
  if (parts.length !== 3) return 0;
  
  const birthDate = new Date(parts[2], parts[1] - 1, parts[0]);
  const today = new Date();
  
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// 3. Scheme Recommendations Engine
router.get('/recommendations/list', authenticateToken, async (req, res) => {
  try {
    // Get citizen profile
    const profileRes = await db.query('SELECT * FROM citizen_profiles WHERE user_id = $1', [req.user.id]);
    if (profileRes.rowCount === 0) {
      return res.status(400).json({ error: 'Please create profile first' });
    }
    const profile = profileRes.rows[0];
    const age = calculateAge(profile.dob);

    // Get all schemes
    const schemesRes = await db.query('SELECT * FROM schemes');
    const recommended = [];

    for (let sc of schemesRes.rows) {
      let rules = {};
      try { rules = JSON.parse(sc.eligibility_rules); } catch(e) {}
      
      let eligible = true;
      const reasons = [];

      // Check Age Rule (min)
      if (rules.min_age !== undefined && age < rules.min_age) {
        eligible = false;
        reasons.push(`Minimum age required is ${rules.min_age} (You: ${age})`);
      }

      // Check Age Rule (max)
      if (rules.max_age !== undefined && age > rules.max_age) {
        eligible = false;
        reasons.push(`Maximum age is ${rules.max_age} (You: ${age})`);
      }
      
      // Check Farmer Rule
      if (rules.is_farmer !== undefined && profile.is_farmer !== rules.is_farmer) {
        eligible = false;
        reasons.push(`Scheme is for farmers only`);
      }

      // Check Gender Rule
      if (rules.gender && profile.gender && profile.gender.toLowerCase() !== rules.gender.toLowerCase()) {
        eligible = false;
        reasons.push(`Targeted for ${rules.gender} applicants`);
      }
      if (rules.gender && !profile.gender) {
        eligible = false;
        reasons.push(`Gender info required (${rules.gender} only)`);
      }

      // Check Income Rule
      if (rules.max_income && profile.income_amount > rules.max_income) {
        eligible = false;
        reasons.push(`Income exceeds limit of ₹${rules.max_income.toLocaleString()}`);
      }

      // Check Occupation Rule
      if (rules.occupation && profile.occupation !== rules.occupation) {
        eligible = false;
        reasons.push(`Targeted for ${rules.occupation} occupation`);
      }

      // Check Education Rule
      if (rules.education && profile.education !== rules.education) {
        eligible = false;
        reasons.push(`Requires ${rules.education} education`);
      }

      try { sc.required_documents = JSON.parse(sc.required_documents); } catch(e) {}
      try { sc.eligibility_rules = rules; } catch(e) {}

      recommended.push({
        scheme: sc,
        is_eligible: eligible,
        reasons: eligible ? ['All criteria matched'] : reasons
      });
    }

    res.json(recommended);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process recommendations' });
  }
});

// 4. Auto-Fill Service Fields
router.get('/auto-fill/:serviceId', authenticateToken, async (req, res) => {
  try {
    // Get profile
    const profileRes = await db.query('SELECT * FROM citizen_profiles WHERE user_id = $1', [req.user.id]);
    const profile = profileRes.rows[0];
    
    // Get user mobile
    const userRes = await db.query('SELECT mobile FROM users WHERE id = $1', [req.user.id]);
    const user = userRes.rows[0];
    
    // Get documents in vault to extract numbers and data
    const docsRes = await db.query('SELECT * FROM documents WHERE user_id = $1', [req.user.id]);
    
    const fillData = {
      name: profile?.name || '',
      dob: profile?.dob || '',
      gender: profile?.gender || '',
      state: profile?.state || 'Telangana',
      district: profile?.district || '',
      aadhaar_number: '',
      pan_number: '',
      income_amount: profile?.income_amount || '',
      caste: profile?.caste || '',
      mobile: user?.mobile || '',
      address: '',
      father_name: '',
      pincode: ''
    };

    for (let doc of docsRes.rows) {
      if (doc.document_type === 'aadhaar') {
        fillData.aadhaar_number = doc.extracted_id_number || '';
        // Try to get address from extracted_data
        try {
          const data = typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : doc.extracted_data;
          if (data) {
            fillData.address = data.address || fillData.address;
            fillData.father_name = data.father_name || data.care_of || fillData.father_name;
            fillData.pincode = data.pincode || fillData.pincode;
          }
        } catch(e) {}
      }
      if (doc.document_type === 'pan') {
        fillData.pan_number = doc.extracted_id_number || '';
        try {
          const data = typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : doc.extracted_data;
          if (data && data.father_name) fillData.father_name = data.father_name;
        } catch(e) {}
      }
    }

    res.json(fillData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate auto-fill data' });
  }
});

// 5. Application Readiness Score & Document Validation Engine
router.get('/readiness/:serviceId', authenticateToken, async (req, res) => {
  const serviceId = req.params.serviceId;

  try {
    // Get Service details
    const serviceRes = await db.query('SELECT * FROM services WHERE id = $1', [serviceId]);
    if (serviceRes.rowCount === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const service = serviceRes.rows[0];
    let reqDocs = [];
    try { reqDocs = JSON.parse(service.required_documents); } catch(e) {}

    // Get User Documents in Vault
    const docsRes = await db.query('SELECT * FROM documents WHERE user_id = $1', [req.user.id]);
    const vaultDocs = docsRes.rows;

    let score = 100;
    const issues = [];
    const documentAnalysis = [];

    // Check each required document
    for (let reqDoc of reqDocs) {
      const foundDoc = vaultDocs.find(d => d.document_type === reqDoc);
      
      if (!foundDoc) {
        score -= 25; // Deduct heavily for missing document
        issues.push({
          type: 'missing_document',
          severity: 'critical',
          message: `Missing required document: ${reqDoc.toUpperCase()}`
        });
        documentAnalysis.push({
          document_type: reqDoc,
          status: 'missing',
          is_verified: false
        });
      } else {
        let validationStatus = {};
        try { validationStatus = JSON.parse(foundDoc.validation_status || '{}'); } catch(e) {}

        const docIssues = validationStatus.issues || [];
        const isVerified = foundDoc.is_verified === 1;

        if (!isVerified) {
          score -= 10;
          issues.push({
            type: 'unverified_document',
            severity: 'warning',
            message: `Document '${reqDoc.toUpperCase()}' has validation warnings: ${docIssues.join(', ')}`
          });
        }

        // Check if expired
        const expiresVal = foundDoc.expires_at;
        if (expiresVal && expiresVal !== 'Permanent') {
          const parts = expiresVal.split('/');
          if (parts.length === 3) {
            const expDate = new Date(parts[2], parts[1] - 1, parts[0]);
            if (expDate < new Date()) {
              score -= 15;
              issues.push({
                type: 'expired_document',
                severity: 'critical',
                message: `Expired document: Your ${reqDoc.toUpperCase()} certificate expired on ${expiresVal}`
              });
            }
          }
        }

        documentAnalysis.push({
          document_type: reqDoc,
          status: 'present',
          is_verified: isVerified && !issues.some(i => i.type === 'expired_document' && i.message.includes(reqDoc.toUpperCase())),
          issues: docIssues
        });
      }
    }

    // Failsafe score range
    score = Math.max(0, Math.min(100, score));

    res.json({
      service_id: serviceId,
      service_name: service.name,
      readiness_score: score,
      issues,
      document_analysis: documentAnalysis,
      is_submission_ready: score >= 80 && !issues.some(i => i.severity === 'critical')
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to calculate readiness score' });
  }
});

// 6. Submit Application & Generate package PDF
router.post('/submit', authenticateToken, async (req, res) => {
  const { service_id, form_data, readiness_score, validation_report } = req.body;

  if (!service_id || !form_data) {
    return res.status(400).json({ error: 'service_id and form_data are required' });
  }

  try {
    // Check if user already has an active (non-rejected) application for this service
    const existingApp = await db.query(
      `SELECT id, status FROM applications 
       WHERE user_id = $1 AND service_id = $2 AND status != $3
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, service_id, 'rejected']
    );

    if (existingApp.rows.length > 0) {
      const statusLabel = existingApp.rows[0].status === 'approved' ? 'approved' : 
                          existingApp.rows[0].status === 'under_review' ? 'under review' : 'pending';
      return res.status(409).json({ 
        error: `You already have an application for this service that is ${statusLabel}. You can only re-apply if your previous application was rejected.`,
        existing_application_id: existingApp.rows[0].id,
        existing_status: existingApp.rows[0].status
      });
    }

    // Generate MeeSeva-style Application ID
    // Format: PREFIX + DISTRICT_CODE + YYMM + 10-digit timestamp-based sequence
    const servicePrefixes = {
      'income': 'LRIC', 'caste': 'LRCC', 'birth': 'LRBC', 'death': 'LRDC',
      'residence': 'LRRC', 'marriage': 'LRMC', 'obc': 'LROB', 'ews': 'LREW',
      'integrated': 'LRIG', 'domicile': 'LRDM', 'age': 'LRAC', 'character': 'LRCH'
    };
    const svcRow = await db.query('SELECT name, category, fees, processing_time FROM services WHERE id = $1', [service_id]);
    const svcInfo = svcRow.rows[0] || {};
    const svcCategory = (svcInfo.category || '').toLowerCase();
    const svcNameLower = (svcInfo.name || '').toLowerCase();
    
    let prefix = 'LRGN';
    for (const [key, pfx] of Object.entries(servicePrefixes)) {
      if (svcCategory.includes(key) || svcNameLower.includes(key)) { prefix = pfx; break; }
    }

    // Pull district from user's Aadhaar card
    let userDistrict = form_data.district || '';
    if (!userDistrict) {
      try {
        const aadhaarRow = await db.query(
          `SELECT extracted_data FROM documents WHERE user_id = $1 AND document_type = 'aadhaar' AND is_verified = 1 LIMIT 1`,
          [req.user.id]
        );
        if (aadhaarRow.rows.length > 0) {
          const ed = typeof aadhaarRow.rows[0].extracted_data === 'string' ? JSON.parse(aadhaarRow.rows[0].extracted_data) : aadhaarRow.rows[0].extracted_data;
          const addr = ed.address || '';
          // Extract district from address - look for known district names
          const knownDistricts = ['Hyderabad','Ranga Reddy','Rangareddy','Medchal','Sangareddy','Warangal','Karimnagar','Nizamabad','Khammam','Nalgonda','Mahabubnagar','Adilabad','Siddipet','Mancherial','Kamareddy','Medak','Suryapet','Jangaon','Yadadri','Vikarabad','Wanaparthy','Nagarkurnool','Jogulamba','Mulugu','Narayanpet','Jayashankar'];
          for (const d of knownDistricts) {
            if (addr.toLowerCase().includes(d.toLowerCase())) { userDistrict = d.toUpperCase(); break; }
          }
          if (!userDistrict) userDistrict = 'WARANGAL';
        }
      } catch(e) { /* silent */ }
    }
    if (!userDistrict) userDistrict = 'WARANGAL';

    // District code mapping
    const districtCodes = { 'HYDERABAD': '01', 'RANGA REDDY': '02', 'RANGAREDDY': '02', 'MEDCHAL': '03', 'SANGAREDDY': '04', 'WARANGAL': '05', 'KARIMNAGAR': '06', 'NIZAMABAD': '07', 'KHAMMAM': '08', 'NALGONDA': '09', 'MAHABUBNAGAR': '10', 'ADILABAD': '11', 'SIDDIPET': '12', 'MEDAK': '13' };
    const distCode = districtCodes[userDistrict.toUpperCase()] || '05';
    
    const now = new Date();
    const yymm = String(now.getFullYear()).slice(-2) + String(now.getMonth() + 1).padStart(2, '0');
    // Build a realistic 10-digit sequence from timestamp
    const tsSeq = String(now.getTime()).slice(-10);
    const applicationId = prefix + distCode + yymm + tsSeq;
    const transactionId = 'TT' + applicationId;

    // Contact Python service to compile package PDF
    let pdfFilename = `package_${applicationId}.pdf`;
    
    try {
      const pyResponse = await fetch(`${AI_SERVICES_URL}/generate-package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: applicationId,
          user_id: req.user.id,
          service_id,
          form_data,
          readiness_score,
          validation_report
        })
      });

      if (pyResponse.ok) {
        const pyResult = await pyResponse.json();
        pdfFilename = pyResult.pdf_path || pdfFilename;
      }
    } catch (pyErr) {
      console.warn('Could not connect to Python PDF compilation. Saving mock path. Error:', pyErr.message);
    }

    // Remove any old rejected applications for the same service to ensure 1 card per certificate
    await db.query(
      `DELETE FROM applications WHERE user_id = $1 AND service_id = $2 AND status = 'rejected'`,
      [req.user.id, service_id]
    );

    await db.query(
      `INSERT INTO applications (id, user_id, service_id, form_data, readiness_score, validation_report, status, package_pdf_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        applicationId,
        req.user.id,
        service_id,
        JSON.stringify(form_data),
        readiness_score || 0,
        JSON.stringify(validation_report || {}),
        'pending',
        pdfFilename
      ]
    );

    // Add alert notification
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user.id,
        'Application Submitted',
        `Your application for ${form_data.service_name || 'Government Certificate'} has been queued for verification. Application No: ${applicationId}`,
        'alert'
      ]
    );


    res.status(201).json({
      message: 'Application submitted successfully',
      application_id: applicationId,
      transaction_id: transactionId,
      applicant_name: form_data.applicant_name || form_data.name || '',
      service_name: svcInfo.name || form_data.service_name || '',
      district: userDistrict,
      date_of_payment: now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      payment_mode: 'Online',
      pdf_download_url: `/api/applications/download/${pdfFilename}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit application package' });
  }
});


module.exports = router;
