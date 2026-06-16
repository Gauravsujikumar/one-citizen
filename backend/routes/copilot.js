const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const db = require('../db');

// Gemini AI Chat endpoint
router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    // Fetch user context
    const profileRes = await db.query('SELECT * FROM citizen_profiles WHERE user_id = $1', [req.user.id]);
    const profile = profileRes.rows[0] || {};
    const docsRes = await db.query('SELECT document_type, is_verified, extracted_name, validation_status, expires_at FROM documents WHERE user_id = $1', [req.user.id]);
    const docs = docsRes.rows;

    const uploadedDocs = docs.map(d => {
      return `${d.document_type} (verified: ${d.is_verified ? 'yes' : 'no'})`;
    }).join(', ') || 'None';

    const systemPrompt = `You are "One Citizen AI" — a helpful assistant built into the OneCitizen app for citizens in Telangana, India.

CRITICAL RULE — SERVICE RESTRICTIONS:
You must ONLY help users with the services/certificates that are available in our Service Catalog. Here is the COMPLETE list of available services:
1. Income Certificate
2. Caste Certificate
3. EWS Certificate (Economically Weaker Section)
4. Birth Certificate
5. Death Certificate
6. Old Age Pension (Aasara Pension)
7. Business Registration

If a user asks about ANY other certificate, service, or application that is NOT in the list above (e.g., Marriage Certificate, Residence Certificate, Domicile Certificate, Passport, Driving License, Voter ID, PAN Card, Ration Card, RTI, Land Records, Dharani, etc.), you MUST reply:
"That certificate/service application is not available with us at the moment. Currently, we support: Income Certificate, Caste Certificate, EWS Certificate, Birth Certificate, Death Certificate, Old Age Pension, and Business Registration. We are working on adding more services soon!"

Do NOT provide steps or guidance for services not in the catalog. Only answer about the 7 services listed above.

PERSONALITY:
- Talk like a helpful friend, not a robot. Short, clear sentences.
- Be warm and encouraging. Use emojis sparingly (1-2 per response max).
- Keep answers concise: 2-4 short paragraphs max.
- Use numbered steps when explaining processes.
- Reference the user by name when it feels natural.
- You can answer general greetings and small talk naturally.

USER CONTEXT:
- Name: ${profile.name || 'Citizen'}
- State: ${profile.state || 'Telangana'}
- District: ${profile.district || 'Unknown'}
- Uploaded documents: ${uploadedDocs}

FORMATTING RULES:
- Use plain text only. NO markdown (no **, no ##, no *).
- Use line breaks (newlines) to separate paragraphs.
- Use bullet points with • character.
- Use numbered lists like: 1. 2. 3.
- Keep it readable on a small phone screen.`;

    // Build conversation history for Gemini — only include last 6
    const contents = [];
    if (history && Array.isArray(history)) {
      const recent = history.slice(-6);
      for (const h of recent) {
        // Skip if same message as current (prevent duplication)
        if (h.role === 'user' && h.text === message) continue;
        contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] });
      }
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    // Ensure conversation starts with user role
    if (contents.length > 0 && contents[0].role !== 'user') {
      contents.shift();
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.log('[Copilot] No API key, using fallback');
      return res.json({ reply: getLocalFallback(message, profile) });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    console.log('[Copilot] Sending to Gemini:', message.substring(0, 80));

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 600,
          topP: 0.92
        }
      })
    });

    const data = await response.json();
    let reply = '';
    
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      reply = data.candidates[0].content.parts.map(p => p.text).join('');
      // Strip any markdown bold/header syntax the AI might use despite instructions
      reply = reply.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,3}\s/gm, '').replace(/\*(.*?)\*/g, '$1');
      console.log('[Copilot] Gemini replied:', reply.substring(0, 100));
    } else {
      console.error('[Copilot] Gemini error response:', JSON.stringify(data).substring(0, 500));
      reply = getLocalFallback(message, profile);
    }

    res.json({ reply });
  } catch (err) {
    console.error('[Copilot] Error:', err.message);
    res.json({ reply: getLocalFallback(req.body.message || '', {}) });
  }
});

function getLocalFallback(message, profile) {
  const name = (profile && profile.name) || 'there';
  const q = (message || '').toLowerCase();
  const notAvailable = `Hey ${name}, that certificate/service application is not available with us at the moment.\n\nCurrently, we support:\n• Income Certificate\n• Caste Certificate\n• EWS Certificate\n• Birth Certificate\n• Death Certificate\n• Old Age Pension\n• Business Registration\n\nWe are working on adding more services soon!`;
  
  if (q.includes('hello') || q.includes('hi ') || q.includes('hey') || q === 'hi') {
    return `Hey ${name}! Welcome! I'm your One Citizen AI assistant. You can apply for Income, Caste, EWS, Birth, Death certificates, Old Age Pension, and Business Registration directly from this app!`;
  }
  
  if (q.includes('ews') || q.includes('economically weaker')) {
    return `Hey ${name}! You can apply for an EWS certificate right here!\n\nEligibility:\n• Family income below Rs. 8 lakh per annum\n• Not belonging to SC/ST/OBC categories\n\nDocuments needed:\n• Aadhaar Card\n• Income Certificate\n• Residence proof\n• Self Declaration Form\n\nProcessing: 10 working days | Fee: Rs. 35\n\nTap Apply Now below to start!`;
  }
  
  if (q.includes('death') && (q.includes('certif') || q.includes('apply') || q.includes('get') || q.includes('need') || q.includes('want'))) {
    return `Hey ${name}! You can apply for a Death Certificate directly from this app.\n\nDocuments needed:\n• Death Report from Hospital\n• Aadhaar of Deceased\n• Aadhaar of Applicant\n• Address Proof\n\nFee: Rs. 45 | Processing: 5 working days\n\nTap Apply Now below to start!`;
  }
  
  if (q.includes('birth') && (q.includes('certif') || q.includes('apply') || q.includes('get') || q.includes('need') || q.includes('want'))) {
    return `Hey ${name}! You can apply for a Birth Certificate directly from this app.\n\nDocuments needed:\n• Hospital Birth Report\n• Parent Aadhaar Cards\n• Address Proof\n\nFee: Rs. 50 | Processing: 3 working days\n\nTap Apply Now below to start!`;
  }
  
  if (q.includes('caste') && (q.includes('certif') || q.includes('apply') || q.includes('get') || q.includes('need') || q.includes('want'))) {
    return `Hey ${name}! You can apply for a Caste Certificate directly from this app.\n\nDocuments needed:\n• Aadhaar Card\n• Ration Card\n• Father's Caste Certificate (if available)\n• School Transfer Certificate\n\nFee: Rs. 45 | Processing: 15 working days\n\nTap Apply Now below!`;
  }
  
  if (q.includes('income') && (q.includes('certif') || q.includes('apply') || q.includes('get') || q.includes('need') || q.includes('want'))) {
    return `Hey ${name}! You can apply for an Income Certificate directly from this app.\n\nDocuments needed:\n• Aadhaar Card\n• Passport-size Photo\n\nFee: Rs. 45 | Processing: 7 working days\n\nTap Apply Now below!`;
  }
  
  if (q.includes('pension') || q.includes('aasara') || q.includes('old age')) {
    return `Hey ${name}! You can apply for Old Age Pension from this app.\n\nEligibility:\n• Age 60+ years\n• Income below Rs. 1.5 lakh/year\n\nDocuments: Aadhaar, Age Proof, Income Certificate, Bank Passbook\nFee: Free | Processing: 30 days\n\nTap Apply Now below!`;
  }
  
  if (q.includes('business') && (q.includes('regist') || q.includes('apply') || q.includes('start') || q.includes('license') || q.includes('licence'))) {
    return `Hey ${name}! You can apply for Business Registration from this app.\n\nDocuments needed:\n• PAN Card\n• Aadhaar Card\n• Address Proof\n• Business Address Proof\n\nFee: Rs. 1,500 | Processing: 10 working days\n\nTap Apply Now below!`;
  }

  // Non-available services - return not available message
  if (q.includes('residence') || q.includes('domicile') || q.includes('passport') || 
      q.includes('driving') || q.includes('license') || q.includes('licence') || 
      q.includes('voter') || q.includes('election') || q.includes('pan card') || 
      q.includes('ration') || q.includes('rti') || q.includes('right to information') || 
      q.includes('land') || q.includes('dharani') || q.includes('property') || 
      q.includes('marriage') || q.includes('scholarship') || q.includes('housing') || 
      q.includes('awas') || q.includes('certif')) {
    return notAvailable;
  }
  
  if (q.includes('track') || q.includes('status') || q.includes('progress')) {
    return `Hey ${name}! Track all your applications in the Services tab. Each application shows: Submitted, Under Review, or Approved. Approved certificates go to your Vault!`;
  }
  
  if (q.includes('thank')) {
    return `You're welcome, ${name}! Happy to help!`;
  }

  if (q.includes('meeseva') || q.includes('center near') || q.includes('nearest center')) {
    return `Hey ${name}! You can apply for most services directly from this app. Use the Locator tab to find your nearest MeeSeva center for physical certificate collection.`;
  }
  
  // General fallback
  return `Hey ${name}! I can help you with government services available in our app!\n\nCurrently available:\n• Income Certificate\n• Caste Certificate\n• EWS Certificate\n• Birth Certificate\n• Death Certificate\n• Old Age Pension\n• Business Registration\n\nJust tell me which one you need!`;
}

module.exports = router;
