-- OneCitizen AI Database Schema

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- For SQLite (Will be handled dynamically in db.js for Postgres)
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'citizen', -- 'citizen', 'admin'
    mobile VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Citizen Profile / Digital Twin Table
CREATE TABLE IF NOT EXISTS citizen_profiles (
    user_id INTEGER PRIMARY KEY,
    name VARCHAR(255),
    dob VARCHAR(50),
    gender VARCHAR(50),
    occupation VARCHAR(255),
    education VARCHAR(255),
    income_category VARCHAR(100), -- 'low', 'medium', 'high'
    income_amount REAL,
    state VARCHAR(255),
    district VARCHAR(255),
    caste VARCHAR(100),
    is_farmer INTEGER DEFAULT 0, -- 0 = False, 1 = True
    family_members TEXT, -- JSON string list of family members
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Secure Document Vault Table
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(100) PRIMARY KEY,
    user_id INTEGER NOT NULL,
    document_type VARCHAR(100) NOT NULL, -- 'aadhaar', 'pan', 'income', 'caste', 'degree', 'birth', 'address', 'passport'
    file_path TEXT NOT NULL,
    extracted_name VARCHAR(255),
    extracted_dob VARCHAR(50),
    extracted_id_number VARCHAR(100),
    is_verified INTEGER DEFAULT 0, -- 0 = Unverified, 1 = Verified
    validation_status TEXT, -- JSON string containing errors/warnings
    expires_at VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Government Services Table
CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL, -- 'certificate', 'business', 'pension', 'education'
    eligibility_rules TEXT NOT NULL, -- JSON string detailing eligibility criteria
    required_documents TEXT NOT NULL, -- JSON string list of required docs
    fees REAL DEFAULT 0,
    processing_time VARCHAR(100),
    steps TEXT NOT NULL -- JSON string list of steps
);

-- Welfare Schemes Table
CREATE TABLE IF NOT EXISTS schemes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    benefit_amount VARCHAR(100),
    eligibility_rules TEXT NOT NULL, -- JSON string
    required_documents TEXT NOT NULL -- JSON string
);

-- Service Applications Table
CREATE TABLE IF NOT EXISTS applications (
    id VARCHAR(100) PRIMARY KEY,
    user_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    form_data TEXT NOT NULL, -- JSON string of filled fields
    readiness_score INTEGER DEFAULT 0,
    validation_report TEXT, -- JSON string containing report
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'under_review', 'approved', 'rejected'
    officer_notes TEXT, -- Officer's approval/rejection reason
    package_pdf_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0, -- 0 = Unread, 1 = Read
    type VARCHAR(100), -- 'alert', 'scheme', 'expiry'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- MeeSeva Centers Table
CREATE TABLE IF NOT EXISTS meeseva_centers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    address TEXT NOT NULL,
    rating REAL DEFAULT 4.0,
    wait_time VARCHAR(50) DEFAULT '15 mins',
    services TEXT NOT NULL -- JSON string list
);
