/* ============================================================
   OneCitizen Officer Verification Portal — Logic
   ============================================================ */

(function () {
    'use strict';

    // ── DOM References ──
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const els = {
        // Login
        loginScreen: $('#loginScreen'),
        loginForm: $('#loginForm'),
        loginEmail: $('#loginEmail'),
        loginPassword: $('#loginPassword'),
        loginError: $('#loginError'),
        loginBtn: $('#loginBtn'),

        // Dashboard
        dashboard: $('#dashboard'),
        officerAvatar: $('#officerAvatar'),
        officerEmail: $('#officerEmail'),
        logoutBtn: $('#logoutBtn'),
        refreshBtn: $('#refreshBtn'),

        // Stats
        statTotal: $('#statTotal'),
        statPending: $('#statPending'),
        statReview: $('#statReview'),
        statApproved: $('#statApproved'),
        statRejected: $('#statRejected'),

        // Table
        queueBody: $('#queueBody'),
        emptyState: $('#emptyState'),
        loadingState: $('#loadingState'),

        // Detail
        detailOverlay: $('#detailOverlay'),
        detailAppId: $('#detailAppId'),
        detailStatus: $('#detailStatus'),
        detailScore: $('#detailScore'),
        scoreArc: $('#scoreArc'),
        detailBanner: $('#detailBanner'),
        citizenInfo: $('#citizenInfo'),
        formData: $('#formData'),
        documentsSection: $('#documentsSection'),
        actionsSection: $('#actionsSection'),
        closeDetailBtn: $('#closeDetailBtn'),
        officerNotes: $('#officerNotes'),
        rejectReasonGroup: $('#rejectReasonGroup'),
        rejectReason: $('#rejectReason'),
        approveBtn: $('#approveBtn'),
        rejectBtn: $('#rejectBtn'),

        // Confirm
        confirmDialog: $('#confirmDialog'),
        confirmIcon: $('#confirmIcon'),
        confirmTitle: $('#confirmTitle'),
        confirmMessage: $('#confirmMessage'),
        confirmCancel: $('#confirmCancel'),
        confirmOk: $('#confirmOk'),

        // Toast
        toast: $('#toast'),
        toastIcon: $('#toastIcon'),
        toastMessage: $('#toastMessage'),
    };

    // ── State ──
    let currentApplicationId = null;
    let confirmCallback = null;

    // ── Config: Backend API URL (change this when deploying separately) ──
    const API_BASE = 'http://localhost:3000';

    // ── Utility: API request ──
    async function api(method, path, body = null) {
        const token = localStorage.getItem('officer_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(API_BASE + path, opts);

        if (res.status === 401) {
            logout();
            throw new Error('Session expired. Please login again.');
        }

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.message || data.error || `Request failed (${res.status})`);
        }

        return data;
    }

    // ── Toast ──
    let toastTimer = null;
    function showToast(message, type = 'success') {
        clearTimeout(toastTimer);
        els.toast.className = `toast toast-${type}`;
        els.toastIcon.textContent = type === 'success' ? '✓' : '✕';
        els.toastMessage.textContent = message;
        els.toast.hidden = false;
        requestAnimationFrame(() => els.toast.classList.add('show'));
        toastTimer = setTimeout(() => {
            els.toast.classList.remove('show');
            setTimeout(() => { els.toast.hidden = true; }, 300);
        }, 3500);
    }

    // ── Toggle password visibility ──
    window.togglePassword = function () {
        const inp = els.loginPassword;
        inp.type = inp.type === 'password' ? 'text' : 'password';
    };

    // ── LOGIN ──
    els.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = els.loginEmail.value.trim();
        const password = els.loginPassword.value;

        if (!email || !password) {
            els.loginError.textContent = 'Please enter both email and password.';
            return;
        }

        els.loginError.textContent = '';
        setLoginLoading(true);

        try {
            const data = await api('POST', '/api/auth/login', { email, password });
            const token = data.token;

            if (!token) throw new Error('No token received from server.');

            localStorage.setItem('officer_token', token);
            localStorage.setItem('officer_email', email);

            showDashboard(email);
        } catch (err) {
            els.loginError.textContent = err.message || 'Login failed. Please try again.';
        } finally {
            setLoginLoading(false);
        }
    });

    function setLoginLoading(loading) {
        els.loginBtn.disabled = loading;
        els.loginBtn.querySelector('.btn-text').hidden = loading;
        els.loginBtn.querySelector('.btn-loader').hidden = !loading;
    }

    // ── LOGOUT ──
    els.logoutBtn.addEventListener('click', logout);

    function logout() {
        localStorage.removeItem('officer_token');
        localStorage.removeItem('officer_email');
        currentApplicationId = null;

        els.dashboard.hidden = true;
        els.detailOverlay.hidden = true;
        els.confirmDialog.hidden = true;
        els.loginScreen.hidden = false;

        els.loginEmail.value = '';
        els.loginPassword.value = '';
        els.loginError.textContent = '';
    }

    // ── SHOW DASHBOARD ──
    function showDashboard(email) {
        els.loginScreen.hidden = true;
        els.dashboard.hidden = false;

        els.officerEmail.textContent = email;
        els.officerAvatar.textContent = email.charAt(0).toUpperCase();

        loadApplications();
    }

    // ── LOAD APPLICATIONS ──
    async function loadApplications() {
        els.loadingState.hidden = false;
        els.emptyState.hidden = true;
        els.queueBody.innerHTML = '';

        els.refreshBtn.classList.add('refreshing');

        try {
            const data = await api('GET', '/api/admin/applications');
            const apps = data.applications || data.data || data || [];

            const list = Array.isArray(apps) ? apps : [];

            updateStats(list);
            renderTable(list);
        } catch (err) {
            showToast(err.message || 'Failed to load applications.', 'error');
        } finally {
            els.loadingState.hidden = true;
            els.refreshBtn.classList.remove('refreshing');
        }
    }

    els.refreshBtn.addEventListener('click', loadApplications);

    // ── UPDATE STATS ──
    function updateStats(apps) {
        const counts = { total: apps.length, pending: 0, under_review: 0, approved: 0, rejected: 0 };

        apps.forEach((app) => {
            const s = normalizeStatus(app.status);
            if (s === 'applied' || s === 'pending') counts.pending++;
            else if (s === 'under_review') counts.under_review++;
            else if (s === 'approved') counts.approved++;
            else if (s === 'rejected') counts.rejected++;
        });

        animateCounter(els.statTotal, counts.total);
        animateCounter(els.statPending, counts.pending);
        animateCounter(els.statReview, counts.under_review);
        animateCounter(els.statApproved, counts.approved);
        animateCounter(els.statRejected, counts.rejected);
    }

    function animateCounter(el, target) {
        const start = parseInt(el.textContent) || 0;
        const diff = target - start;
        if (diff === 0) { el.textContent = target; return; }

        const duration = 400;
        const startTime = performance.now();

        function tick(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
            el.textContent = Math.round(start + diff * ease);
            if (progress < 1) requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
    }

    // ── RENDER TABLE ──
    function renderTable(apps) {
        els.queueBody.innerHTML = '';

        if (!apps.length) {
            els.emptyState.hidden = false;
            return;
        }

        els.emptyState.hidden = true;

        apps.forEach((app) => {
            const tr = document.createElement('tr');
            const status = normalizeStatus(app.status);
            const score = app.readiness_score ?? app.readinessScore ?? app.score ?? 0;
            const scoreNum = typeof score === 'number' ? score : parseInt(score) || 0;
            const scorePercent = Math.min(scoreNum, 100);
            const scoreColor = scorePercent >= 80 ? '#046A38' : scorePercent >= 50 ? '#f59e0b' : '#ef4444';

            const citizenName = app.citizen_name || app.citizenName || app.name || 'N/A';
            const service = app.service || app.service_name || app.serviceName || 'N/A';
            const date = formatDate(app.created_at || app.createdAt || app.date || app.submitted_at);
            const appId = app.application_id || app.applicationId || app.id || '—';

            tr.innerHTML = `
                <td class="app-id-cell">${escapeHTML(String(appId))}</td>
                <td class="citizen-name-cell">${escapeHTML(citizenName)}</td>
                <td class="service-cell">${escapeHTML(service)}</td>
                <td>
                    <div class="score-cell">
                        <div class="score-bar">
                            <div class="score-bar-fill" style="width:${scorePercent}%;background:${scoreColor}"></div>
                        </div>
                        <span class="score-text" style="color:${scoreColor}">${scorePercent}%</span>
                    </div>
                </td>
                <td><span class="status-badge status-${status}">${formatStatus(status)}</span></td>
                <td class="date-cell">${date}</td>
                <td>
                    <button class="btn-view" data-id="${escapeHTML(String(app.id || appId))}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        View
                    </button>
                </td>
            `;

            els.queueBody.appendChild(tr);
        });

        // Attach view handlers
        els.queueBody.querySelectorAll('.btn-view').forEach((btn) => {
            btn.addEventListener('click', () => openApplication(btn.dataset.id));
        });
    }

    // ── OPEN APPLICATION DETAIL ──
    async function openApplication(id) {
        currentApplicationId = id;
        els.detailOverlay.hidden = false;
        document.body.style.overflow = 'hidden';

        // Reset
        els.citizenInfo.innerHTML = '<p style="color:#9ca3af;font-size:.88rem;">Loading...</p>';
        els.formData.innerHTML = '';
        els.documentsSection.innerHTML = '';
        els.rejectReasonGroup.hidden = true;
        els.rejectReason.value = '';
        els.officerNotes.value = '';

        try {
            // Fetch application details
            const data = await api('GET', `/api/admin/applications/${id}`);
            const app = data.application || data.data || data;

            renderDetail(app);

            // Auto-mark as under_review if currently applied/pending
            const status = normalizeStatus(app.status);
            if (status === 'applied' || status === 'pending') {
                try {
                    await api('PATCH', `/api/admin/applications/${id}/status`, { status: 'under_review' });
                    // Update the badge in the detail panel
                    setDetailStatus('under_review');
                    // Refresh table in background
                    loadApplications();
                } catch (_) { /* silent */ }
            }
        } catch (err) {
            showToast(err.message || 'Failed to load application.', 'error');
            closeDetail();
        }
    }

    function renderDetail(app) {
        const appId = app.application_id || app.applicationId || app.id || '—';
        els.detailAppId.textContent = `#${appId}`;

        // Status
        const status = normalizeStatus(app.status);
        setDetailStatus(status);

        // Score
        const score = app.readiness_score ?? app.readinessScore ?? app.score ?? 0;
        const scoreNum = typeof score === 'number' ? score : parseInt(score) || 0;
        els.detailScore.textContent = `${scoreNum}%`;

        // Animate score arc
        const circumference = 2 * Math.PI * 34; // r=34
        const offset = circumference - (circumference * Math.min(scoreNum, 100)) / 100;
        els.scoreArc.style.transition = 'stroke-dashoffset 0.8s ease';
        requestAnimationFrame(() => {
            els.scoreArc.setAttribute('stroke-dashoffset', offset);
        });

        // Score color
        if (scoreNum >= 80) els.scoreArc.setAttribute('stroke', '#046A38');
        else if (scoreNum >= 50) els.scoreArc.setAttribute('stroke', '#f59e0b');
        else els.scoreArc.setAttribute('stroke', '#ef4444');

        // Citizen info
        const citizen = app.citizen || app.user || app;
        const citizenFields = {
            'Full Name': citizen.name || citizen.full_name || citizen.citizen_name || app.citizen_name || 'N/A',
            'Date of Birth': citizen.dob || citizen.date_of_birth || citizen.dateOfBirth || 'N/A',
            'Gender': citizen.gender || 'N/A',
            'State': citizen.state || 'N/A',
            'District': citizen.district || 'N/A',
            'Occupation': citizen.occupation || 'N/A',
            'Annual Income': citizen.income || citizen.annual_income || citizen.annualIncome || 'N/A',
            'Phone': citizen.phone || citizen.mobile || 'N/A',
        };
        els.citizenInfo.innerHTML = renderInfoGrid(citizenFields);

        // Form data
        const formFields = app.form_data || app.formData || app.form || {};
        if (typeof formFields === 'object' && Object.keys(formFields).length > 0) {
            const formatted = {};
            for (const [key, val] of Object.entries(formFields)) {
                formatted[prettifyKey(key)] = val ?? 'N/A';
            }
            els.formData.innerHTML = renderInfoGrid(formatted);
        } else {
            els.formData.innerHTML = '<p style="color:#9ca3af;font-size:.85rem;padding:10px 14px;">No form data available.</p>';
        }

        // Documents — show both profile docs AND form-uploaded certificate files
        const docs = app.documents || app.attachments || [];
        const formFields = app.form_data || app.formData || app.form || {};
        
        // Extract uploaded file paths from form_data
        const uploadedFiles = [];
        if (typeof formFields === 'object') {
            for (const [key, val] of Object.entries(formFields)) {
                if (typeof val === 'string' && (val.startsWith('uploads/') || val.startsWith('/uploads/'))) {
                    uploadedFiles.push({ name: key, path: val.startsWith('/') ? val : '/' + val });
                }
            }
        }

        let docsHtml = '';
        
        // Show profile-level documents (Aadhaar, PAN, etc.)
        if (Array.isArray(docs) && docs.length > 0) {
            docsHtml += docs.map((doc) => {
                const docType = doc.type || doc.document_type || doc.name || 'Document';
                const docStatus = doc.is_verified ? 'Verified' : (doc.status || doc.verification_status || 'Uploaded');
                const filePath = doc.file_path || '';
                const viewBtn = filePath 
                    ? `<a href="/${filePath}" target="_blank" class="doc-view-btn" style="background:#1E40AF;color:#fff;padding:3px 10px;border-radius:4px;font-size:11px;text-decoration:none;font-weight:600;">View</a>` 
                    : '';

                return `
                    <div class="doc-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;">
                        <div class="doc-info">
                            <span class="doc-type">${escapeHTML(prettifyKey(docType))}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span class="doc-status ${docStatus.toLowerCase()}" style="font-size:11px;">${escapeHTML(docStatus)}</span>
                            ${viewBtn}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Show certificate-specific uploaded files from form_data
        if (uploadedFiles.length > 0) {
            docsHtml += '<div style="margin-top:8px;padding-top:8px;border-top:2px solid #e2e8f0;"><p style="font-size:11px;font-weight:700;color:#475569;margin-bottom:6px;">📎 Certificate Application Uploads</p>';
            docsHtml += uploadedFiles.map(f => {
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                        <span style="font-size:12px;color:#1e293b;font-weight:500;">${escapeHTML(prettifyKey(f.name))}</span>
                        <a href="${f.path}" target="_blank" style="background:#046A38;color:#fff;padding:3px 10px;border-radius:4px;font-size:11px;text-decoration:none;font-weight:600;">View File</a>
                    </div>
                `;
            }).join('');
            docsHtml += '</div>';
        }

        if (docsHtml) {
            els.documentsSection.innerHTML = docsHtml;
        } else {
            els.documentsSection.innerHTML = '<p style="color:#9ca3af;font-size:.85rem;padding:10px 0;">No documents attached.</p>';
        }

        // Show/hide actions based on status
        const isActionable = (status !== 'approved' && status !== 'rejected');
        els.actionsSection.style.display = isActionable ? 'block' : 'none';
    }

    function setDetailStatus(status) {
        els.detailStatus.className = `status-badge status-${status}`;
        els.detailStatus.textContent = formatStatus(status);
    }

    // ── CLOSE DETAIL ──
    els.closeDetailBtn.addEventListener('click', closeDetail);
    els.detailOverlay.addEventListener('click', (e) => {
        if (e.target === els.detailOverlay) closeDetail();
    });

    function closeDetail() {
        els.detailOverlay.hidden = true;
        document.body.style.overflow = '';
        currentApplicationId = null;
        // Reset arc
        els.scoreArc.style.transition = 'none';
        els.scoreArc.setAttribute('stroke-dashoffset', 213.6);
    }

    // ── APPROVE ──
    els.approveBtn.addEventListener('click', () => {
        showConfirm(
            'approve',
            'Approve Application',
            'Are you sure you want to approve this application? This action cannot be undone.',
            async () => {
                try {
                    els.approveBtn.disabled = true;
                    els.rejectBtn.disabled = true;

                    const notes = els.officerNotes.value.trim();
                    await api('PATCH', `/api/admin/applications/${currentApplicationId}/status`, {
                        status: 'approved',
                        officer_notes: notes || undefined,
                    });

                    showToast('Application approved successfully.');
                    closeDetail();
                    loadApplications();
                } catch (err) {
                    showToast(err.message || 'Failed to approve application.', 'error');
                } finally {
                    els.approveBtn.disabled = false;
                    els.rejectBtn.disabled = false;
                }
            }
        );
    });

    // ── REJECT ──
    let rejectMode = false;

    els.rejectBtn.addEventListener('click', () => {
        // First click: show rejection reason textarea
        if (!rejectMode) {
            rejectMode = true;
            els.rejectReasonGroup.hidden = false;
            els.rejectReason.focus();
            els.rejectBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Confirm Rejection
            `;
            return;
        }

        const reason = els.rejectReason.value.trim();
        if (!reason) {
            els.rejectReason.style.borderColor = '#ef4444';
            els.rejectReason.focus();
            return;
        }

        showConfirm(
            'reject',
            'Reject Application',
            'Are you sure you want to reject this application? The citizen will be notified with your reason.',
            async () => {
                try {
                    els.approveBtn.disabled = true;
                    els.rejectBtn.disabled = true;

                    const notes = els.officerNotes.value.trim();
                    await api('PATCH', `/api/admin/applications/${currentApplicationId}/status`, {
                        status: 'rejected',
                        officer_notes: reason + (notes ? `\n\nAdditional notes: ${notes}` : ''),
                    });

                    showToast('Application rejected.');
                    closeDetail();
                    loadApplications();
                } catch (err) {
                    showToast(err.message || 'Failed to reject application.', 'error');
                } finally {
                    els.approveBtn.disabled = false;
                    els.rejectBtn.disabled = false;
                    rejectMode = false;
                }
            }
        );
    });

    // Reset reject mode when reason textarea changes
    els.rejectReason.addEventListener('input', () => {
        els.rejectReason.style.borderColor = '';
    });

    // ── CONFIRMATION DIALOG ──
    function showConfirm(type, title, message, callback) {
        els.confirmIcon.className = `confirm-icon ${type}-icon`;
        els.confirmIcon.textContent = type === 'approve' ? '✓' : '✕';
        els.confirmTitle.textContent = title;
        els.confirmMessage.textContent = message;

        els.confirmOk.className = `btn-confirm-ok ${type}-ok`;
        els.confirmOk.textContent = type === 'approve' ? 'Yes, Approve' : 'Yes, Reject';

        confirmCallback = callback;
        els.confirmDialog.hidden = false;
    }

    els.confirmCancel.addEventListener('click', () => {
        els.confirmDialog.hidden = true;
        confirmCallback = null;
    });

    els.confirmOk.addEventListener('click', () => {
        els.confirmDialog.hidden = true;
        if (confirmCallback) {
            confirmCallback();
            confirmCallback = null;
        }
    });

    // Close confirm on overlay click
    els.confirmDialog.addEventListener('click', (e) => {
        if (e.target === els.confirmDialog) {
            els.confirmDialog.hidden = true;
            confirmCallback = null;
        }
    });

    // ── HELPERS ──
    function normalizeStatus(status) {
        if (!status) return 'pending';
        return String(status).toLowerCase().replace(/[\s-]+/g, '_');
    }

    function formatStatus(status) {
        return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
            });
        } catch {
            return dateStr;
        }
    }

    function prettifyKey(key) {
        return key
            .replace(/[_-]/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function renderInfoGrid(fields) {
        return Object.entries(fields)
            .map(
                ([label, value]) => `
                <div class="info-item">
                    <span class="info-label">${escapeHTML(label)}</span>
                    <span class="info-value">${escapeHTML(String(value))}</span>
                </div>
            `
            )
            .join('');
    }

    // ── KEYBOARD ──
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!els.confirmDialog.hidden) {
                els.confirmDialog.hidden = true;
                confirmCallback = null;
            } else if (!els.detailOverlay.hidden) {
                closeDetail();
            }
        }
    });

    // ── INIT: Check for existing session ──
    function init() {
        const token = localStorage.getItem('officer_token');
        const email = localStorage.getItem('officer_email');

        if (token && email) {
            showDashboard(email);
        }
    }

    init();
})();
