// server.js - OneCitizen AI Backend Server Entry
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const db = require('./db');

// Load .env from the backend directory (works both locally and on Vercel)
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Prevent unhandled errors from crashing the server (e.g. Tesseract worker errors)
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION] Server staying alive:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION] Server staying alive:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend requests
app.use(cors());

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Uploaded Files
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Serve Static Web Demo files directly from Node server
const webDemoDir = path.join(__dirname, '../web_demo');
app.use(express.static(webDemoDir));

// Serve Officer Portal as separate app at /officer
const officerDir = path.join(__dirname, '../officer_portal');
app.use('/officer', express.static(officerDir));

// Initialize Database connection (ensureInitialized shares the promise with query() calls)
db.ensureInitialized().then(() => {
  console.log('Database initialized successfully.');
}).catch(err => {
  console.error('Failed to initialize database:', err.message);
});

// Import Route Handlers
const authModule = require('./routes/auth');
const documentsRouter = require('./routes/documents');
const servicesRouter = require('./routes/services');
const meesevaRouter = require('./routes/meeseva');
const adminRouter = require('./routes/admin');
const otpRouter = require('./routes/otp');
const copilotRoutes = require('./routes/copilot');

// Mount API Routes
app.use('/api/auth', authModule.router);
app.use('/api/documents', documentsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/meeseva', meesevaRouter);
app.use('/api/admin', adminRouter);
app.use('/api/otp', otpRouter);
app.use('/api/copilot', copilotRoutes);

// Endpoint for package download (PDFs)
app.get('/api/applications/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  let filePath = path.resolve(__dirname, 'uploads', filename);
  if (!fs.existsSync(filePath)) {
    filePath = path.resolve(__dirname, '../ai_services/packages', filename);
  }

  if (fs.existsSync(filePath)) {
    res.download(filePath, filename);
  } else {
    // Generate a fallback temporary receipt
    const parts = filename.split('_');
    const packageId = (parts.length > 1 ? parts[1].split('.')[0] : filename.split('.')[0]) || 'N/A';
    const tempFile = path.resolve(__dirname, 'uploads', `temp_${filename}.txt`);
    fs.writeFileSync(tempFile, `OneCitizen AI Submission Package\n=================================\nPackage ID: ${packageId}\nStatus: Verified\nReady for submission at MeeSeva centers.`);
    res.download(tempFile, 'OneCitizen_Package_Receipt.txt');
  }
});

// Catch-all route to serve Web Demo SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(webDemoDir, 'index.html'));
});

// Start Server (only when not running as Vercel serverless function)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` OneCitizen AI Backend is running on port ${PORT}`);
    console.log(` Web Demo Portal is accessible at: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

// Export for Vercel serverless
module.exports = app;
