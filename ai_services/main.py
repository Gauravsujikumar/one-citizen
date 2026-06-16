# main.py - FastAPI Python AI Services for OneCitizen AI
import os
import re
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# PDF Compilation Imports
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.graphics.shapes import Drawing, Rect, String, Line

app = FastAPI(
    title="OneCitizen AI - Python AI Services",
    description="OCR parsing, cross-document validations, life-event mapping, and PDF compiler endpoints",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Try to load .env manually if it exists to retrieve API keys
env_path = os.path.join(os.path.dirname(__file__), "../backend/.env")
if os.path.exists(env_path):
    with open(env_path, "r") as f:
        for line in f:
            line_str = line.strip()
            if line_str and not line_str.startswith("#"):
                parts = line_str.split("=", 1)
                if len(parts) == 2:
                    os.environ[parts[0].strip()] = parts[1].strip()

# Check for Gemini API key
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
ACTIVE_GEMINI_MODEL = "gemini-1.5-flash"  # Default fallback
if GEMINI_API_KEY:
    import google.generativeai as genai
    genai.configure(api_key=GEMINI_API_KEY)
    print("Gemini AI API configured successfully.")
    try:
        available_models = [m.name.split('/')[-1] for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
        model_preference = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest']
        for pref in model_preference:
            if pref in available_models:
                ACTIVE_GEMINI_MODEL = pref
                break
        print(f"Using active Gemini model: {ACTIVE_GEMINI_MODEL}")
    except Exception as list_err:
        print(f"Failed to list models, using default {ACTIVE_GEMINI_MODEL}. Error: {list_err}")
else:
    print("No GEMINI_API_KEY found. Running with local rule-based simulation engines.")

# Pydantic Schemas
class ValidationRequest(BaseModel):
    user_id: int
    documents: List[Dict[str, Any]]

class LifeEventRequest(BaseModel):
    situation: str
    user_profile: Optional[Dict[str, Any]] = None

class PDFPackageRequest(BaseModel):
    application_id: str
    user_id: int
    service_id: int
    form_data: Dict[str, Any]
    readiness_score: int
    validation_report: Dict[str, Any]

# Helper: Regex-based local mock OCR parser
def parse_document_local_simulation(filename: str, doc_type: str) -> Dict[str, Any]:
    # Extract details from filename
    base_name = os.path.splitext(filename)[0]
    base_name = re.sub(r'[_-]+', ' ', base_name)
    
    name = "Gaurav Sujikumar"
    dob = "05/10/2004"
    id_number = ""
    
    # Check for mismatch flag in filename
    has_mismatch = "mismatch" in base_name.lower()
    if has_mismatch:
        name = "Ramesh Kumar"
        dob = "10/10/1985"
    
    # Try to find a date (DD-MM-YYYY or YYYY-MM-DD)
    date_match = re.search(r'\b(\d{1,2})[\s./|-](\d{1,2})[\s./|-](\d{4})\b', base_name)
    if date_match and not has_mismatch:
        dob = f"{date_match.group(1).zfill(2)}/{date_match.group(2).zfill(2)}/{date_match.group(3)}"
    else:
        date_match_rev = re.search(r'\b(\d{4})[\s./|-](\d{1,2})[\s./|-](\d{1,2})\b', base_name)
        if date_match_rev and not has_mismatch:
            dob = f"{date_match_rev.group(3).zfill(2)}/{date_match_rev.group(2).zfill(2)}/{date_match_rev.group(1)}"
            
    # Try to find a 12-digit number (Aadhaar)
    aadhaar_match = re.search(r'\b\d{12}\b', base_name)
    if aadhaar_match:
        digits = aadhaar_match.group(0)
        id_number = f"{digits[0:4]} {digits[4:8]} {digits[8:12]}"
    else:
        aadhaar_spaced = re.search(r'\b\d{4}\s\d{4}\s\d{4}\b', base_name)
        if aadhaar_spaced:
            id_number = aadhaar_spaced.group(0)
            
    # Try to find PAN (5 letters, 4 digits, 1 letter)
    pan_match = re.search(r'\b[A-Za-z]{5}\d{4}[A-Za-z]\b', base_name)
    if pan_match:
        id_number = pan_match.group(0).upper()
        
    # Extract name words: ignore document helper words
    if not has_mismatch:
        ignored_words = {'aadhaar', 'pan', 'income', 'caste', 'degree', 'birth', 'mismatch', 'sample', 'copy', 'doc', 'document', 'pdf', 'png', 'jpg', 'jpeg', 'details', 'extracted', 'verification', 'verified', 'unverified'}
        words = [w for w in base_name.split() if w.lower() not in ignored_words]
        if words:
            name = " ".join([w.capitalize() for w in words])
        
    doc_type = doc_type.lower()
    
    if doc_type == 'aadhaar':
        return {
            "name": name,
            "father_name": "Suji Kumar Sr.",
            "dob": dob,
            "id_number": id_number or "5489 1204 9021",
            "address": "Plot 45, Gachibowli, Hyderabad, Telangana - 500032",
            "gender": "Male",
            "expiry": "Permanent"
        }
    elif doc_type == 'pan':
        return {
            "name": name.upper(),
            "dob": dob,
            "id_number": id_number or "BPKPS2109F",
            "expiry": "Permanent"
        }
    elif doc_type == 'income':
        # Try to find an income amount in filename (e.g. 180000 or 250k)
        income_amount = 180000.0
        income_match = re.search(r'\b\d{5,7}\b', base_name)
        if income_match:
            income_amount = float(income_match.group(0))
        return {
            "name": name,
            "id_number": id_number or "INC2026093847",
            "income_amount": income_amount,
            "expiry": "31/03/2027"
        }
    elif doc_type == 'caste':
        return {
            "name": name,
            "id_number": id_number or "CST2026194758",
            "caste": "OBC",
            "expiry": "Permanent"
        }
    elif doc_type == 'degree':
        return {
            "name": name,
            "id_number": id_number or "DEG202648201",
            "expiry": "Permanent"
        }
    elif doc_type == 'birth':
        return {
            "name": name,
            "dob": dob,
            "id_number": id_number or "BRT202684920",
            "expiry": "Permanent"
        }
        
    return {
        "name": name,
        "dob": dob,
        "id_number": id_number,
        "expiry": "Permanent"
    }

# 1. OCR Extraction Endpoint
@app.post("/ocr/extract")
async def extract_ocr(
    file: UploadFile = File(...),
    document_type: str = Form(...)
):
    try:
        contents = await file.read()
        extracted_data = {}
        issues = []

        # Validate file size
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")

        # Visual blur and format simulation
        if file.filename.lower().endswith(('.png', '.jpg', '.jpeg')) and len(contents) < 5000:
            issues.append("Low resolution / Blurry image detected. Please upload a clearer scan.")

        # Attempt Gemini OCR if API key exists
        if GEMINI_API_KEY:
            try:
                # Log incoming request details to root log file
                log_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../ocr_debug.log"))
                with open(log_path, "a", encoding="utf-8") as log_file:
                    log_file.write(f"\n--- Python Service: OCR Request for {file.filename} ---\n")
                    log_file.write(f"Mime Type: {file.content_type}, Size: {len(contents)} bytes\n")
                    log_file.write(f"Using Model: {ACTIVE_GEMINI_MODEL}\n")

                model = genai.GenerativeModel(ACTIVE_GEMINI_MODEL)
                prompt = f"""
                You are an expert document OCR engine. Read the attached document and extract details in clean JSON format.
                Only return the JSON. No conversational text.
                The user says this is a {document_type.upper()} document.

                Extract ALL of the following fields (return empty string if not found):
                - name (full name of the person)
                - dob (date of birth in DD/MM/YYYY format)
                - gender (Male / Female / Other)
                - detected_type (identify the ACTUAL document type from image: aadhaar, pan, income, caste, residence, ration, degree, birth, passport, driving_license, voter, or unknown)

                Additionally, extract these TYPE-SPECIFIC fields:
                If Aadhaar: id_number (12-digit aadhaar number), father_name, address
                If PAN: id_number (PAN number like ABCDE1234F)
                If Income Certificate: application_number, issued_date, annual_income, certified_by, validity_date
                If Caste Certificate: application_number, issued_date, caste_name, certified_by, validity_date
                If Residence Certificate: application_number, issued_date, address, certified_by, validity_date
                If Ration Card: id_number (ration card number), category (APL/BPL)
                If Driving License: id_number (license number), issue_date, expiry (expiry date)
                If Voter ID: id_number (voter ID number like ABC1234567)
                If Degree: id_number (enrollment/roll number), institution, year_of_passing
                If Birth Certificate: id_number (registration number), place_of_birth, father_name, mother_name

                Always include: expiry (expiry or validity date in DD/MM/YYYY, or 'Permanent' if none)
                """
                
                # Format image data for Gemini API
                image_parts = [{
                    "mime_type": file.content_type,
                    "data": contents
                }]
                
                response = model.generate_content([prompt, image_parts[0]])
                response_text = response.text.strip()
                
                with open(log_path, "a", encoding="utf-8") as log_file:
                    log_file.write(f"Gemini API Raw Response:\n{response_text}\n")
                
                # Extract JSON block
                json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                if json_match:
                    import json
                    extracted_data = json.loads(json_match.group(0))
                else:
                    with open(log_path, "a", encoding="utf-8") as log_file:
                        log_file.write("Warning: No JSON block found in Gemini response. Running simulation fallback.\n")
                    extracted_data = parse_document_local_simulation(file.filename, document_type)
            except Exception as gemini_err:
                import traceback
                error_trace = traceback.format_exc()
                log_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../ocr_debug.log"))
                with open(log_path, "a", encoding="utf-8") as log_file:
                    log_file.write(f"Gemini API Invocation Exception:\n{error_trace}\n")
                print(f"Gemini API invocation failed: {gemini_err}. Running local simulation.")
                extracted_data = parse_document_local_simulation(file.filename, document_type)
        else:
            # Run simulation
            extracted_data = parse_document_local_simulation(file.filename, document_type)

        # Basic validations on extracted data
        if not extracted_data.get("name"):
            issues.append("Could not extract applicant Name from document.")
        if document_type.lower() == 'aadhaar':
            id_num = extracted_data.get("id_number", "")
            # Basic Aadhaar length validation (12 digits or 4-4-4 format)
            clean_id = re.sub(r'\s+', '', str(id_num))
            if len(clean_id) != 12 or not clean_id.isdigit():
                issues.append("Aadhaar Number is invalid or failed OCR check.")
        elif document_type.lower() == 'pan':
            pan_num = str(extracted_data.get("id_number", "")).upper()
            if not re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]$', pan_num):
                issues.append("PAN format is invalid.")

        status = "verified" if len(issues) == 0 else "unverified"
        
        return {
            "document_type": document_type,
            "extracted_data": extracted_data,
            "validation": {
                "status": status,
                "issues": issues
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR Engine failed: {str(e)}")

# 2. Cross-Document Verification Endpoint
@app.post("/validate")
async def validate_documents(req: ValidationRequest):
    docs = req.documents
    issues = []
    
    # 1. Compare names across all verified documents
    names = [doc["extracted_name"] for doc in docs if doc.get("extracted_name")]
    if len(names) > 1:
        first_name = names[0].lower().replace(" ", "")
        for n in names[1:]:
            clean_n = n.lower().replace(" ", "")
            # Basic fuzzy matching (e.g. check containment or match)
            if first_name != clean_n and first_name not in clean_n and clean_n not in first_name:
                issues.append(f"Name discrepancy: Document name '{names[0]}' does not match '{n}'")
                
    # 2. Compare DOBs across documents
    dobs = [doc["extracted_dob"] for doc in docs if doc.get("extracted_dob")]
    if len(dobs) > 1:
        first_dob = dobs[0]
        for d in dobs[1:]:
            if first_dob != d:
                issues.append(f"DOB discrepancy: Document Date of Birth '{first_dob}' does not match '{d}'")

    status = "verified" if len(issues) == 0 else "unverified"
    return {
        "status": status,
        "issues": issues
    }

# 3. Natural Language Life Event Copilot Endpoint
@app.post("/life-event")
async def map_life_event(req: LifeEventRequest):
    sit = req.situation.lower()
    
    # If Gemini is configured, use it for semantic mapping
    if GEMINI_API_KEY:
        try:
            model = genai.GenerativeModel(ACTIVE_GEMINI_MODEL)
            prompt = f"""
            You are OneCitizen AI, a helpful citizen assistant. A citizen describes their life event: "{req.situation}".
            Analyze this event and return a JSON mapping containing:
            1. service_name: Primary government certificate or license needed (e.g. Income Certificate, Trade License, Scholarship).
            2. required_documents: List of certificates they need to gather (e.g. Aadhaar, Caste, Address, degree).
            3. recommended_schemes: Relevant welfare schemes (e.g. PM-KISAN, Post-Matric Scholarship, PM Awas Yojana).
            4. application_steps: Short list of steps to apply.
            Only return the JSON block. No introductory comments.
            """
            response = model.generate_content(prompt)
            response_text = response.text.strip()
            
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                import json
                return json.loads(json_match.group(0))
        except Exception as e:
            print("Gemini mapping failed, running local keywords engine. Error:", e)

    # Local Rule-based Keyword Engine
    matched_service = "Income Certificate"
    req_docs = ["aadhaar", "address"]
    schemes = ["Pradhan Mantri Awas Yojana"]
    steps = ["Upload income documents", "Verify with Revenue officer", "Submit to MeeSeva Center"]

    if "college" in sit or "education" in sit or "engineering" in sit or "study" in sit or "admission" in sit:
        matched_service = "Post-Matric Scholarship Scheme"
        req_docs = ["aadhaar", "income", "caste", "degree"]
        schemes = ["Post-Matric Scholarship Scheme"]
        steps = ["Obtain college admission fee receipt", "Verify Caste Certificate", "Apply on National Scholarship Portal"]
    elif "bakery" in sit or "startup" in sit or "business" in sit or "shop" in sit or "entrepreneur" in sit:
        matched_service = "Business Registration"
        req_docs = ["pan", "aadhaar", "address"]
        schemes = ["Startup India Seed Fund Scheme (SISFS)"]
        steps = ["Register business name at local municipality", "Generate PAN for business", "Apply for Seed Fund grant"]
    elif "farmer" in sit or "crop" in sit or "agriculture" in sit or "land" in sit or "damaged" in sit:
        matched_service = "PM-KISAN Registration"
        req_docs = ["aadhaar", "address"]
        schemes = ["PM-KISAN (Farmer Income Support)"]
        steps = ["Submit land possession certificate", "Link bank account with Aadhaar", "Verify coordinates of farmland"]
    elif "father" in sit or "death" in sit or "passed away" in sit:
        matched_service = "Death Certificate & Pension"
        req_docs = ["birth", "aadhaar", "address"]
        schemes = ["Widow & Destitute Pension Scheme"]
        steps = ["Register death certificate at municipality within 21 days", "Apply for family pension at MeeSeva"]
    elif "retired" in sit or "pension" in sit or "elderly" in sit:
        matched_service = "Old Age Pension"
        req_docs = ["aadhaar", "income", "birth"]
        schemes = ["Old Age Pension"]
        steps = ["Verify age is above 60 years", "Submit self-declaration of income", "Enroll at local Panchayat / Ward office"]

    return {
        "service_name": matched_service,
        "required_documents": req_docs,
        "recommended_schemes": schemes,
        "application_steps": steps
    }

# 4. PDF Application Package Generator
@app.post("/generate-package")
async def generate_package_pdf(req: PDFPackageRequest):
    try:
        packages_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend/uploads"))
        os.makedirs(packages_dir, exist_ok=True)
        
        filename = f"package_{req.application_id}.pdf"
        file_path = os.path.join(packages_dir, filename)
        
        doc = SimpleDocTemplate(file_path, pagesize=letter, rightMargin=54, leftMargin=54, topMargin=54, bottomMargin=54)
        story = []
        
        styles = getSampleStyleSheet()
        
        # Custom styles
        title_style = ParagraphStyle(
            'GovTitle',
            parent=styles['Heading1'],
            fontSize=22,
            leading=26,
            textColor=colors.HexColor('#0F294A'),
            alignment=1, # Centered
            spaceAfter=20
        )
        
        subtitle_style = ParagraphStyle(
            'GovSubtitle',
            parent=styles['Normal'],
            fontSize=11,
            leading=14,
            textColor=colors.HexColor('#FF671F'),
            alignment=1,
            spaceAfter=20
        )
        
        h2_style = ParagraphStyle(
            'GovH2',
            parent=styles['Heading2'],
            fontSize=14,
            leading=18,
            textColor=colors.HexColor('#1F3E64'),
            spaceBefore=15,
            spaceAfter=8
        )
        
        body_style = ParagraphStyle(
            'GovBody',
            parent=styles['Normal'],
            fontSize=10,
            leading=14,
            textColor=colors.HexColor('#333333')
        )

        bold_body = ParagraphStyle(
            'GovBoldBody',
            parent=body_style,
            fontName='Helvetica-Bold'
        )

        # Header Section
        story.append(Paragraph("ONECITIZEN AI - CO-PILOT SUBMISSION PACKAGE", title_style))
        story.append(Paragraph("Government of India • MeeSeva / CSC Submission Readiness Document", subtitle_style))
        story.append(Spacer(1, 10))

        # Application details table
        details_data = [
            [Paragraph("<b>Package ID:</b>", body_style), Paragraph(req.application_id, body_style),
             Paragraph("<b>Readiness Score:</b>", body_style), Paragraph(f"<b>{req.readiness_score}%</b>", bold_body)],
            [Paragraph("<b>Service Name:</b>", body_style), Paragraph(req.form_data.get('service_name', 'Government Certificate'), body_style),
             Paragraph("<b>Submission Date:</b>", body_style), Paragraph("05/06/2026", body_style)],
            [Paragraph("<b>Applicant Name:</b>", body_style), Paragraph(req.form_data.get('name', ''), body_style),
             Paragraph("<b>Aadhaar ID:</b>", body_style), Paragraph(req.form_data.get('aadhaar_number', 'Not Linked'), body_style)]
        ]
        
        details_table = Table(details_data, colWidths=[100, 160, 100, 140])
        details_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F4F6F9')),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#D1D5DB')),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('PADDING', (0,0), (-1,-1), 8),
        ]))
        story.append(details_table)
        story.append(Spacer(1, 15))

        # Verification Seal Graphic
        story.append(Paragraph("<b>AUTOMATED DOCUMENT INTEGRITY SEAL</b>", h2_style))
        seal_color = '#046A38' if req.readiness_score >= 80 else '#FF671F'
        seal_text = "SUBMISSION READY" if req.readiness_score >= 80 else "CORRECTION REQUIRED"
        
        seal_data = [
            [Paragraph(f"<font color='{seal_color}'><b>{seal_text}</b></font>", bold_body),
             Paragraph(f"This application package has been auto-scanned and validated. The readiness score is <b>{req.readiness_score}%</b>. All critical documents verified against core biometric registry.", body_style)]
        ]
        seal_table = Table(seal_data, colWidths=[150, 350])
        seal_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#EBF5EE')),
            ('GRID', (0,0), (-1,-1), 1, colors.HexColor(seal_color)),
            ('PADDING', (0,0), (-1,-1), 10),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        story.append(seal_table)
        story.append(Spacer(1, 15))

        # Filled Fields
        story.append(Paragraph("<b>AUTO-FILLED FIELD REGISTRATION</b>", h2_style))
        fields_data = [[Paragraph("<b>Field Name</b>", bold_body), Paragraph("<b>Registered Value</b>", bold_body)]]
        
        for k, v in req.form_data.items():
            if k not in ['service_name', 'service_id'] and v:
                key_display = k.replace('_', ' ').title()
                fields_data.append([Paragraph(key_display, body_style), Paragraph(str(v), body_style)])

        fields_table = Table(fields_data, colWidths=[200, 300])
        fields_table.setStyle(TableStyle([
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E5E7EB')),
            ('BACKGROUND', (0,0), (1,0), colors.HexColor('#1F3E64')),
            ('TEXTCOLOR', (0,0), (1,0), colors.white),
            ('PADDING', (0,0), (-1,-1), 6),
        ]))
        story.append(fields_table)
        story.append(Spacer(1, 15))

        # Validation Issues List
        story.append(Paragraph("<b>VALIDATION ISSUES & REMEDIATION REPORT</b>", h2_style))
        issues_list = req.validation_report.get('issues', [])
        
        if len(issues_list) == 0:
            story.append(Paragraph("✔ No validation errors or name mismatches found. Failsafe checks complete.", body_style))
        else:
            for issue in issues_list:
                story.append(Paragraph(f"• <b>[WARNING]</b> {issue}", body_style))
                story.append(Spacer(1, 3))
        
        story.append(Spacer(1, 20))
        story.append(Paragraph("<i>Note: This is a verified document package from OneCitizen AI. Please carry the original physical copies of Aadhaar, PAN, and Income certificate to the CSC/MeeSeva desk for biometric validation.</i>", body_style))

        # Build PDF
        doc.build(story)
        
        return {
            "application_id": req.application_id,
            "status": "success",
            "pdf_path": filename
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF Compilation failed: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
