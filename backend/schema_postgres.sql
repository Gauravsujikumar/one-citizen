-- OneCitizen AI Database Schema (PostgreSQL / Neon)

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'citizen',
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
    income_category VARCHAR(100),
    income_amount REAL,
    state VARCHAR(255),
    district VARCHAR(255),
    caste VARCHAR(100),
    is_farmer INTEGER DEFAULT 0,
    family_members TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Secure Document Vault Table
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(100) PRIMARY KEY,
    user_id INTEGER NOT NULL,
    document_type VARCHAR(100) NOT NULL,
    file_path TEXT NOT NULL,
    extracted_name VARCHAR(255),
    extracted_dob VARCHAR(50),
    extracted_id_number VARCHAR(100),
    is_verified INTEGER DEFAULT 0,
    validation_status TEXT,
    expires_at VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Government Services Table
CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    eligibility_rules TEXT NOT NULL,
    required_documents TEXT NOT NULL,
    fees REAL DEFAULT 0,
    processing_time VARCHAR(100),
    steps TEXT NOT NULL
);

-- Welfare Schemes Table
CREATE TABLE IF NOT EXISTS schemes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    benefit_amount VARCHAR(100),
    eligibility_rules TEXT NOT NULL,
    required_documents TEXT NOT NULL
);

-- Service Applications Table
CREATE TABLE IF NOT EXISTS applications (
    id VARCHAR(100) PRIMARY KEY,
    user_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    form_data TEXT NOT NULL,
    readiness_score INTEGER DEFAULT 0,
    validation_report TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    officer_notes TEXT,
    package_pdf_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- MeeSeva Centers Table
CREATE TABLE IF NOT EXISTS meeseva_centers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    address TEXT NOT NULL,
    rating REAL DEFAULT 4.0,
    wait_time VARCHAR(50) DEFAULT '15 mins',
    services TEXT NOT NULL
);

-- ========== SEED DATA ==========

-- Default Admin User (password: admin123)
INSERT INTO users (email, password_hash, role) VALUES 
('admin@onecitizen.gov.in', '$2a$10$XQxBj3CJKqLvYIwPOWZhN.fT7k0eBQqPkJzGxGDqVrMBH8aRwXqTW', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Government Services
INSERT INTO services (name, category, eligibility_rules, required_documents, fees, processing_time, steps) VALUES
('Income Certificate', 'certificate', '{"min_age": 18, "required_docs": ["aadhaar", "income"]}', '["aadhaar", "income"]', 35, '7-10 days', '["Fill application", "Upload documents", "Pay fees", "Visit MeeSeva"]'),
('Caste Certificate', 'certificate', '{"min_age": 18, "required_docs": ["aadhaar", "caste"]}', '["aadhaar", "caste"]', 25, '7-14 days', '["Fill application", "Upload documents", "Pay fees", "Visit MeeSeva"]'),
('OBC Certificate', 'certificate', '{"min_age": 18, "required_docs": ["aadhaar"]}', '["aadhaar"]', 25, '7-14 days', '["Fill application", "Upload documents", "Pay fees", "Visit MeeSeva"]'),
('Birth Certificate', 'certificate', '{"required_docs": ["aadhaar"]}', '["aadhaar", "birth"]', 50, '5-7 days', '["Fill application", "Upload documents", "Pay fees", "Visit MeeSeva"]'),
('Trade License', 'business', '{"min_age": 21, "required_docs": ["aadhaar", "pan"]}', '["aadhaar", "pan", "address"]', 500, '15-30 days', '["Fill application", "Upload documents", "Pay fees", "Inspection", "License issued"]'),
('Old Age Pension', 'pension', '{"min_age": 60, "income_category": "low", "required_docs": ["aadhaar"]}', '["aadhaar", "income"]', 0, '30 days', '["Fill application", "Upload documents", "Verification", "Pension activated"]')
ON CONFLICT DO NOTHING;

-- Welfare Schemes
INSERT INTO schemes (name, description, benefit_amount, eligibility_rules, required_documents) VALUES
('Rythu Bandhu', 'Investment support for agriculture season', '₹10,000/acre/season', '{"is_farmer": true, "state": "Telangana"}', '["aadhaar", "land_document"]'),
('Kalyana Lakshmi', 'Financial assistance for marriage of girls from weaker sections', '₹1,00,116', '{"gender": "female", "income_category": "low"}', '["aadhaar", "income", "caste"]'),
('Aasara Pension', 'Monthly pension for elderly, widows, disabled & toddy tappers', '₹2,016/month', '{"min_age": 57, "income_category": "low"}', '["aadhaar", "income"]'),
('KCR Kit', 'Nutritional support kit for pregnant women delivering in government hospitals', '₹12,000', '{"gender": "female"}', '["aadhaar", "birth"]')
ON CONFLICT DO NOTHING;

-- MeeSeva Centers (Warangal area)
INSERT INTO meeseva_centers (name, latitude, longitude, address, rating, wait_time, services) VALUES
('MeeSeva - Hanamkonda', 17.9854, 79.5341, 'Subedari X Road, Hanamkonda, Warangal', 4.2, '12 mins', '["Income Certificate","Caste Certificate","Birth Certificate"]'),
('MeeSeva - Warangal Fort', 17.9571, 79.5941, 'Near Warangal Fort, Warangal Urban', 3.8, '20 mins', '["Income Certificate","OBC Certificate","Trade License"]'),
('MeeSeva - Kazipet', 17.9615, 79.5166, 'Station Road, Kazipet, Warangal', 4.5, '8 mins', '["Income Certificate","Caste Certificate","Old Age Pension"]')
ON CONFLICT DO NOTHING;
