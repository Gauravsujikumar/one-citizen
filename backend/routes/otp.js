// routes/otp.js - Real SMS OTP using Twilio
const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const db = require('../db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'onecitizen_secure_secret_key';
const OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS || '300');

// In-memory OTP store: { mobile: { otp, expiresAt } }
const otpStore = new Map();

// Initialise Twilio client (only if credentials are configured)
function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || sid.startsWith('AC') && sid.length < 34 || !token || token === 'your_auth_token_here') {
    return null; // Not configured yet
  }
  return twilio(sid, token);
}

// Generate a random 6-digit OTP
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── POST /api/otp/send ────────────────────────────────────────────
// Body: { mobile: "9XXXXXXXXX" }
// Sends a real SMS via Twilio; falls back to console log if not configured
router.post('/send', async (req, res) => {
  const { mobile } = req.body;

  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number is required.' });
  }

  const otp = generateOtp();
  const expiresAt = Date.now() + OTP_EXPIRY_SECONDS * 1000;

  // Store OTP server-side
  otpStore.set(mobile, { otp, expiresAt });

  const client = getTwilioClient();

  if (client) {
    // ── Real SMS via Twilio ──
    try {
      await client.messages.create({
        body: `Your OneCitizen OTP is: ${otp}. Valid for ${OTP_EXPIRY_SECONDS / 60} minutes. Do not share with anyone. - Govt of Telangana`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `+91${mobile}`
      });
      console.log(`[OTP] Real SMS sent to +91${mobile}`);
      res.json({ success: true, message: `OTP sent to +91${mobile}` });
    } catch (err) {
      console.error('[Twilio Error]', err.message);
      res.status(500).json({ error: 'Failed to send SMS. Check Twilio credentials in .env' });
    }
  } else {
    // ── Dev/Demo fallback: print to console ──
    console.warn(`[OTP - DEV MODE] +91${mobile} → OTP: ${otp}  (Twilio not configured)`);
    res.json({
      success: true,
      message: `OTP sent to +91${mobile}`,
      _dev_otp: otp  // Only returned when Twilio is NOT configured
    });
  }
});

// ── POST /api/otp/verify ──────────────────────────────────────────
// Body: { mobile: "9XXXXXXXXX", otp: "123456" }
// On success returns JWT token (same as /auth/login)
router.post('/verify', async (req, res) => {
  const { mobile, otp } = req.body;

  if (!mobile || !otp) {
    return res.status(400).json({ error: 'Mobile and OTP are required.' });
  }

  const record = otpStore.get(mobile);

  if (!record) {
    return res.status(400).json({ error: 'No OTP requested for this number. Please request again.' });
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(mobile);
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
  }

  if (record.otp !== otp.trim()) {
    return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
  }

  // OTP valid — consume it
  otpStore.delete(mobile);

  // Map mobile → existing user (by mobile field if present, else use demo accounts)
  try {
    // Try to find a user whose mobile matches
    let result = await db.query('SELECT * FROM users WHERE mobile = $1', [mobile]);
    let user = result.rows && result.rows[0];

    if (!user) {
      // Fallback: demo mobile → email mapping
      const DEMO_MAP = {
        '9000000001': 'citizen@onecitizen.gov.in',
        '9000000002': 'admin@onecitizen.gov.in',
      };
      const email = DEMO_MAP[mobile];
      if (email) {
        result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        user = result.rows && result.rows[0];
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'No account linked to this mobile number.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'OTP verified. Login successful.',
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('[OTP verify DB error]', err.message);
    res.status(500).json({ error: 'Database error during login.' });
  }
});

module.exports = router;
