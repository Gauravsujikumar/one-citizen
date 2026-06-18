// app.js - Web Demo Controller linking Phone simulator and Admin console to active APIs
const API_URL = window.location.origin + '/api';
let authToken = localStorage.getItem('citizen_token') || null;
let currentRole = 'citizen';
let activeMap = null;
let activeTileLayer = null;
let activeMarkers = [];

// Deduplicate applications: keep only 1 per service_id (prefer non-rejected, then newest)
function deduplicateApps(apps) {
  var map = {};
  apps.forEach(function(a) {
    var key = a.service_id;
    if (!map[key]) { map[key] = a; return; }
    var ex = map[key];
    if (ex.status === 'rejected' && a.status !== 'rejected') { map[key] = a; }
    else if (a.status === 'rejected' && ex.status !== 'rejected') { /* keep existing */ }
    else {
      var ed = new Date(ex.created_at || 0).getTime();
      var nd = new Date(a.created_at || 0).getTime();
      if (nd > ed) map[key] = a;
    }
  });
  return Object.values(map);
}

// Shared helper: render application card in tracking-page style
function renderAppCard(app) {
  var statusLabel = app.status === 'under_review' ? 'Under Review' : app.status === 'approved' ? 'Approved' : app.status === 'rejected' ? 'Rejected' : 'Applied';
  var statusClass = app.status === 'approved' ? 'status-badge-approved' : app.status === 'rejected' ? 'status-badge-rejected' : app.status === 'under_review' ? 'status-badge-review' : 'status-badge-progress';
  var iconColor = app.status === 'approved' ? '#08573c' : app.status === 'rejected' ? '#EF4444' : app.status === 'under_review' ? '#D97706' : '#3B82F6';
  var bgClass = app.status === 'approved' ? 'bg-green-light' : app.status === 'rejected' ? 'bg-red-light' : app.status === 'under_review' ? 'bg-orange-light' : 'bg-blue-light';
  var dateStr = app.created_at ? new Date(app.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  var html = '<div class="recent-app-row app-clickable" data-id="' + (app.id || '') + '" data-service-name="' + (app.service_name || '').replace(/"/g, '&quot;') + '" data-status="' + (app.status || '') + '" data-date="' + dateStr + '" data-notes="' + (app.officer_notes || '').replace(/"/g, '&quot;') + '" style="position:relative;cursor:pointer;">';
  html += '<div class="recent-app-icon-wrap ' + bgClass + '"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="' + iconColor + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></div>';
  html += '<div class="recent-app-details"><h5>' + (app.service_name || 'Government Application') + '</h5><p>' + (app.id ? app.id + ' • ' : '') + dateStr + '</p></div>';
  html += '<div class="recent-app-status"><span class="' + statusClass + '">' + statusLabel + '</span></div>';
  html += '</div>';
  return html;
}

function renderAppsList(apps) {
  if (apps.length === 0) {
    return '<div style="text-align:center;padding:30px 10px;color:#6B7280"><svg width="40" height="40" fill="none" stroke="#CBD5E1" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 10px;display:block"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p style="font-size:13px;font-weight:600">No applications yet</p><p style="font-size:11px;margin-top:4px">Apply for services to see them here</p></div>';
  }
  return apps.map(renderAppCard).join('');
}

// Wire up ✕ delete buttons on application cards within a container
function wireRemoveAppButtons(container) {
  container.querySelectorAll('.btn-remove-app').forEach(function(btn) {
    btn.addEventListener('mouseenter', function() { this.style.background = 'rgba(239,68,68,0.15)'; this.style.color = '#EF4444'; });
    btn.addEventListener('mouseleave', function() { this.style.background = 'rgba(100,116,139,0.1)'; this.style.color = '#94A3B8'; });
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var appId = this.getAttribute('data-app-id');
      var row = this.closest('.recent-app-row');
      if (!appId) return;

      // Hide from recents only (store dismissed IDs in localStorage, don't delete from DB)
      var dismissed = JSON.parse(localStorage.getItem('one_citizen_dismissed_recents') || '[]');
      if (!dismissed.includes(appId)) dismissed.push(appId);
      localStorage.setItem('one_citizen_dismissed_recents', JSON.stringify(dismissed));

      // Animate out
      if (row) {
        row.style.transition = 'opacity 0.25s ease, height 0.25s ease, margin 0.25s ease, padding 0.25s ease';
        row.style.opacity = '0';
        setTimeout(function() {
          row.style.height = '0'; row.style.overflow = 'hidden'; row.style.margin = '0'; row.style.padding = '0';
          setTimeout(function() { row.remove(); }, 200);
        }, 200);
      }
      showToast('Removed from recents');
    });
  });
}

// Show a status card bottom sheet for an application
async function showAppStatusCard(appId, serviceName, status, dateStr, officerNotes) {
  // Pull applicant name from profile
  var applicantName = '';
  try {
    var profile = await apiCall('/auth/profile');
    applicantName = profile.full_name || profile.name || '';
  } catch(e) {}

  // Pull district from Aadhaar card
  var district = '';
  try {
    var docs = await apiCall('/documents');
    var aadhaar = docs.find(function(d) { return d.document_type === 'aadhaar' && d.is_verified === 1; });
    if (aadhaar) {
      var ed = typeof aadhaar.extracted_data === 'string' ? JSON.parse(aadhaar.extracted_data) : (aadhaar.extracted_data || {});
      var addr = ed.address || '';
      var knownDistricts = ['Hyderabad','Ranga Reddy','Rangareddy','Medchal','Sangareddy','Warangal','Karimnagar','Nizamabad','Khammam','Nalgonda','Mahabubnagar','Adilabad','Siddipet'];
      for (var k = 0; k < knownDistricts.length; k++) {
        if (addr.toLowerCase().indexOf(knownDistricts[k].toLowerCase()) !== -1) {
          district = knownDistricts[k].toUpperCase();
          break;
        }
      }
    }
  } catch(e) {}

  var receiptData = {
    application_id: appId,
    service_name: serviceName,
    status: status,
    date_of_payment: dateStr || '',
    applicant_name: applicantName,
    district: district,
    payment_mode: 'Online',
    created_at: dateStr,
    officer_notes: officerNotes || ''
  };

  if (status === 'approved') {
    showApprovedOptions(receiptData);
  } else if (status === 'rejected') {
    showRejectedOptions(receiptData);
  } else {
    showApplicationReceipt(receiptData);
  }
}

// Wire click handlers on app rows to open status card
function wireAppClickHandlers(container) {
  container.querySelectorAll('.recent-app-row.app-clickable').forEach(function(row) {
    row.addEventListener('click', function(e) {
      // Don't trigger if the delete button was clicked
      if (e.target.closest('.btn-remove-app')) return;
      var appId = row.getAttribute('data-id');
      var serviceName = row.getAttribute('data-service-name');
      var status = row.getAttribute('data-status');
      var dateStr = row.getAttribute('data-date');
      var notes = row.getAttribute('data-notes');
      showAppStatusCard(appId, serviceName, status, dateStr, notes);
    });
  });
}

// Global Mobile GPS Geolocation State
let userLatitude = 0;
let userLongitude = 0;
let userLocationName = "";
let currentLanguage = 'en';

const MEESEVA_PIN_SVG = `
<div class="marker-pin-wrapper">
  <svg class="marker-pin-svg" viewBox="0 0 32 38" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 0C7.16 0 0 7.16 0 16C0 26.24 14.24 36.8 14.88 37.28C15.2 37.52 15.6 37.68 16 37.68C16.4 37.68 16.8 37.52 17.12 37.28C17.76 36.8 32 26.24 32 16C32 7.16 24.84 0 16 0Z" fill="url(#pin-gradient)"/>
    <circle cx="16" cy="15" r="5" fill="#FFFFFF"/>
    <defs>
      <linearGradient id="pin-gradient" x1="16" y1="0" x2="16" y2="37.68" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FF8A00"/>
        <stop offset="100%" stop-color="#FF3D00"/>
      </linearGradient>
    </defs>
  </svg>
</div>
`;

document.addEventListener('DOMContentLoaded', () => {
  // 1. Clock timer
  updateClock();
  setInterval(updateClock, 1000);

  // 2. Initial Setup
  setupNavigation();
  setupAuthHandlers();
  setupProfileForm();
  setupVaultUploader();
  setupCopilot();
  setupCarousel();
  setupAccessibility();
  setupOnboarding();
  setupGoogleLogin();

  // Run Startup Transition Sequence:
  // Phase 1 (OneCitizen logo) is active by default.
  // Wait 1000ms, then transition to Phase 2 (Government of Telangana emblem)
  setTimeout(() => {
    const p1 = document.getElementById('splash-phase1');
    const p2 = document.getElementById('splash-phase2');
    if (p1 && p2) {
      p1.classList.remove('active');
      p2.classList.add('active');
    }

    // Wait another 800ms, then transition to the Login Screen (or check token and load dashboard)
    setTimeout(() => {
      // Defer user location request until after splash screen completes
      requestUserLocation();
      if (authToken) {
        checkTokenAndLoad();
      } else {
        switchScreen('screen-login');
      }
    }, 800);
  }, 1000);

  // Floating Help Button click handler
  const btnHelp = document.getElementById('btn-floating-help');
  if (btnHelp) {
    btnHelp.addEventListener('click', () => {
      switchScreen('screen-copilot');
      const chatInput = document.getElementById('copilot-chat-input');
      if (chatInput) {
        setTimeout(() => chatInput.focus(), 150);
      }
    });
  }
});

function updateClock() {
  const clock = document.getElementById('status-clock');
  if (!clock) return;
  const now = new Date();
  let hrs = now.getHours().toString().padStart(2, '0');
  let mins = now.getMinutes().toString().padStart(2, '0');
  clock.innerText = `${hrs}:${mins}`;
}

// // 3. Screen Switching Engine
function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(scr => {
    scr.classList.remove('active');
  });
  const activeScr = document.getElementById(screenId);
  if (activeScr) {
    activeScr.classList.add('active');
  }

  // Control floating help button visibility
  const floatingHelp = document.getElementById('btn-floating-help');
  if (floatingHelp) {
    if (screenId === 'screen-splash' || screenId === 'screen-login' || screenId === 'screen-onboarding' || screenId === 'screen-copilot') {
      floatingHelp.style.display = 'none';
    } else {
      floatingHelp.style.display = 'flex';
    }
  }

  // Handle bottom navigation bar visibility
  const nav = document.getElementById('bottom-nav');
  if (nav) {
    if (screenId === 'screen-splash' || screenId === 'screen-login' || screenId === 'screen-onboarding') {
      nav.style.display = 'none';
    } else {
      nav.style.display = 'flex';
      // Match active nav icon
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        const target = item.getAttribute('data-target');
        if (target === screenId) {
          item.classList.add('active');
        } else if (target === 'screen-profile' && (screenId === 'screen-digital-twin' || screenId === 'screen-profile-edit' || screenId === 'screen-copilot')) {
          item.classList.add('active');
        }
      });
    }
  }

  // Trigger contextual actions based on screen loaded
  if (screenId === 'screen-dashboard') {
    if (window.triggerOnboardingAutoplay) window.triggerOnboardingAutoplay();
    loadDashboardData();
    // badge preloaded inside loadDashboardData
    startStatusPolling();
    startRenewalReminders();
  } else if (screenId === 'screen-onboarding') {
    if (window.triggerOnboardingAutoplay) window.triggerOnboardingAutoplay();
  } else {
    if (window.stopOnboardingAutoplay) window.stopOnboardingAutoplay();
  }

  if (screenId === 'screen-vault') {
    loadVaultItems();
  } else if (screenId === 'screen-services') {
    loadServicesCatalog();
  } else if (screenId === 'screen-schemes') {
    loadSchemesRecommendations();
  } else if (screenId === 'screen-notifications') {
    loadNotifications();
    // Mark current count as seen — clear badge
    updateBellBadge(0);
  } else if (screenId === 'screen-digital-twin') {
    loadDigitalTwinScreen();
  }
}

function setupNavigation() {
  // Bottom navbar navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-target');
      switchScreen(target);
    });
  });

  // Home Screen New Interactive Redesign Handlers
  const inputHome = document.getElementById('copilot-search-input-home');
  if (inputHome) {
    inputHome.addEventListener('focus', () => {
      switchScreen('screen-copilot');
      document.getElementById('copilot-chat-input')?.focus();
    });
  }

  const btnMicHome = document.getElementById('btn-mic-home');
  if (btnMicHome) {
    btnMicHome.addEventListener('click', () => {
      switchScreen('screen-copilot');
      setTimeout(() => startCopilotVoiceInput(), 300);
    });
  }

  // Copilot mic button — Web Speech API
  const btnCopilotMic = document.getElementById('btn-copilot-mic');
  if (btnCopilotMic) {
    btnCopilotMic.addEventListener('click', () => startCopilotVoiceInput());
  }

  // Chips click to run query
  document.querySelectorAll('.copilot-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-query') || chip.innerText.trim();
      if (q) {
        switchScreen('screen-copilot');
        const chatInput = document.getElementById('copilot-chat-input');
        if (chatInput) {
          chatInput.value = q;
          // Trigger the send message button in Copilot
          document.getElementById('btn-copilot-send')?.click();
        }
      }
    });
  });

  const btnCopilotMore = document.getElementById('btn-copilot-more');
  if (btnCopilotMore) {
    btnCopilotMore.addEventListener('click', () => {
      switchScreen('screen-copilot');
    });
  }

  const btnCompleteProfileLink = document.getElementById('btn-complete-profile-link');
  if (btnCompleteProfileLink) {
    btnCompleteProfileLink.addEventListener('click', () => {
      switchScreen('screen-digital-twin');
    });
  }

  const btnAskCopilotHome = document.getElementById('btn-ask-copilot-home');
  if (btnAskCopilotHome) {
    btnAskCopilotHome.addEventListener('click', () => {
      const q = document.getElementById('copilot-search-input-home')?.value?.trim();
      switchScreen('screen-copilot');
      if (q) {
        const chatInput = document.getElementById('copilot-chat-input');
        if (chatInput) {
          chatInput.value = q;
          document.getElementById('btn-copilot-send')?.click();
        }
      } else {
        document.getElementById('copilot-chat-input')?.focus();
      }
    });
  }

  const btnRecIncome = document.getElementById('btn-rec-income');
  if (btnRecIncome) {
    btnRecIncome.addEventListener('click', async function(e) {
      e.stopPropagation();
      await openServiceFormByName('Income Certificate');
    });
  }

  const btnRecScholarship = document.getElementById('btn-rec-scholarship');
  if (btnRecScholarship) {
    btnRecScholarship.addEventListener('click', async function(e) {
      e.stopPropagation();
      await openServiceFormByName('Post-Matric Scholarship Scheme');
    });
  }

  const btnRecsAll = document.getElementById('btn-recommendations-all');
  if (btnRecsAll) {
    btnRecsAll.addEventListener('click', () => {
      switchScreen('screen-services');
    });
  }

  const btnAppsAll = document.getElementById('btn-applications-all');
  if (btnAppsAll) {
    btnAppsAll.addEventListener('click', async () => {
      try {
        const data = await apiCall('/services/user-applications');
        const apps = deduplicateApps(Array.isArray(data) ? data : (data.applications || []));
        openBottomSheet('All Applications', renderAppsList(apps));
        const sheetBody = document.getElementById('sheet-body-content');
        if (sheetBody) { wireRemoveAppButtons(sheetBody); wireAppClickHandlers(sheetBody); }
      } catch(e) {
        openBottomSheet('All Applications', renderAppsList([]));
      }
    });
  }

  // Activity cards navigation
  const actDocs = document.getElementById('act-docs');
  if (actDocs) actDocs.addEventListener('click', () => switchScreen('screen-vault'));
  const actApps = document.getElementById('act-apps');
  if (actApps) actApps.addEventListener('click', async () => {
    try {
      const data = await apiCall('/services/user-applications');
      const apps = deduplicateApps(Array.isArray(data) ? data : (data.applications || []));
      openBottomSheet('Active Applications', renderAppsList(apps));
      // Wire delete buttons inside the bottom sheet
      const sheetBody = document.getElementById('sheet-body-content');
      if (sheetBody) {
        wireRemoveAppButtons(sheetBody);
        wireAppClickHandlers(sheetBody);
      }
    } catch(e) {
      openBottomSheet('Active Applications', renderAppsList([]));
    }
  });
  const actSchemes = document.getElementById('act-schemes');
  if (actSchemes) actSchemes.addEventListener('click', () => switchScreen('screen-schemes'));
  const actApproved = document.getElementById('act-approved');
  if (actApproved) actApproved.addEventListener('click', async () => {
    try {
      const data = await apiCall('/services/user-applications');
      const allApps = deduplicateApps(Array.isArray(data) ? data : (data.applications || []));
      const approved = allApps.filter(a => a.status === 'approved');
      openBottomSheet('Approved Services', renderAppsList(approved));
      const sheetBody = document.getElementById('sheet-body-content');
      if (sheetBody) { wireRemoveAppButtons(sheetBody); wireAppClickHandlers(sheetBody); }
    } catch(e) {
      openBottomSheet('Approved Services', renderAppsList([]));
    }
  });

  // AI Find Schemes banner card
  const aiFindSchemes = document.getElementById('btn-ai-find-schemes');
  if (aiFindSchemes) aiFindSchemes.addEventListener('click', () => switchScreen('screen-schemes'));

  // Recommended cards clicks
  document.querySelectorAll('.recommend-card-modern').forEach(card => {
    card.addEventListener('click', async function() {
      const svcName = card.getAttribute('data-service');
      await openServiceFormByName(svcName);
    });
  });

  // Recent apps list rows clicks
  document.querySelectorAll('.recent-app-row').forEach(row => {
    row.addEventListener('click', () => {
      switchScreen('screen-digital-twin');
    });
  });

  // Globe Nav click -> open language selector in profile
  const globeNav = document.getElementById('globe-nav');
  if (globeNav) {
    globeNav.addEventListener('click', () => {
      switchScreen('screen-profile');
      setTimeout(() => {
        document.getElementById('btn-language-select-row')?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    });
  }

  // Avatar button in Home Screen header
  const btnAvatar = document.getElementById('btn-header-avatar');
  if (btnAvatar) btnAvatar.addEventListener('click', () => switchScreen('screen-profile'));

  // Header Bell navigation
  const bellNav = document.getElementById('bell-nav');
  if (bellNav) bellNav.addEventListener('click', () => switchScreen('screen-notifications'));

  // Clear All Notifications button
  const clearAllBtn = document.getElementById('btn-clear-all-notifs');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      const container = document.getElementById('notifications-items-container');
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:50px 20px;color:#94A3B8;"><div style="font-size:14px;font-weight:600;">No Notifications</div></div>';
      }
      localStorage.setItem('oc_notif_seen_count', '9999');
      updateBellBadge(0);
      showToast('All notifications cleared', 'success');
    });
  }

  // Back arrow clicks
  document.getElementById('vault-back')?.addEventListener('click', () => switchScreen('screen-dashboard'));
  document.getElementById('services-back')?.addEventListener('click', () => switchScreen('screen-dashboard'));
  document.getElementById('schemes-back')?.addEventListener('click', () => switchScreen('screen-dashboard'));
  // locator-back removed (MeeSeva removed)
  document.getElementById('notifications-back')?.addEventListener('click', () => switchScreen('screen-dashboard'));
  
  const copilotBack = document.getElementById('copilot-back');
  if (copilotBack) copilotBack.addEventListener('click', () => switchScreen('screen-dashboard'));
  
  const twinBack = document.getElementById('digital-twin-back');
  if (twinBack) twinBack.addEventListener('click', () => switchScreen('screen-profile'));

  const btnTwinEdit = document.getElementById('btn-digital-twin-edit');
  if (btnTwinEdit) btnTwinEdit.addEventListener('click', () => switchScreen('screen-profile-edit'));

  const profileEditBack = document.getElementById('profile-edit-back');
  if (profileEditBack) profileEditBack.addEventListener('click', () => switchScreen('screen-profile'));

  // Profile Screen Settings List Items Click Handler
  const btnPersonalInfo = document.getElementById('btn-personal-info');
  if (btnPersonalInfo) btnPersonalInfo.addEventListener('click', () => switchScreen('screen-profile-edit'));

  const btnTwinParams = document.getElementById('btn-twin-parameters');
  if (btnTwinParams) btnTwinParams.addEventListener('click', () => switchScreen('screen-digital-twin'));

  // Edit button on profile card
  const btnEditTop = document.getElementById('btn-edit-profile-top');
  if (btnEditTop) btnEditTop.addEventListener('click', () => switchScreen('screen-profile-edit'));

  // My Applications
  const btnMyApps = document.getElementById('btn-my-applications');
  if (btnMyApps) btnMyApps.addEventListener('click', async () => {
    try {
      const data = await apiCall('/services/user-applications');
      const apps = deduplicateApps(Array.isArray(data) ? data : (data.applications || []));
      openBottomSheet('My Applications', renderAppsList(apps));
    } catch(e) {
      openBottomSheet('My Applications', renderAppsList([]));
    }
  });

  // My Documents
  const btnMyDocs = document.getElementById('btn-my-documents');
  if (btnMyDocs) btnMyDocs.addEventListener('click', () => switchScreen('screen-vault'));

  // Notification Preferences
  const btnNotifPrefs = document.getElementById('btn-notification-prefs');
  if (btnNotifPrefs) btnNotifPrefs.addEventListener('click', () => {
    var smsOn = localStorage.getItem('pref_sms') !== 'off';
    var emailOn = localStorage.getItem('pref_email') !== 'off';
    var pushOn = localStorage.getItem('pref_push') !== 'off';
    var schemeOn = localStorage.getItem('pref_scheme') !== 'off';
    function togStyle(on) { return 'display:inline-block;width:40px;height:22px;border-radius:11px;position:relative;cursor:pointer;background:' + (on ? '#046A38' : '#D1D5DB') + ';transition:background 0.2s'; }
    function dotStyle(on) { return 'position:absolute;top:2px;' + (on ? 'right:2px' : 'left:2px') + ';width:18px;height:18px;border-radius:50%;background:#fff;transition:all 0.2s'; }
    var html = '<div style="padding:5px 0">';
    var items = [
      { id: 'tog-sms', label: 'SMS Notifications', desc: 'OTP and status updates via SMS', on: smsOn, key: 'pref_sms' },
      { id: 'tog-email', label: 'Email Notifications', desc: 'Application updates via email', on: emailOn, key: 'pref_email' },
      { id: 'tog-push', label: 'Push Notifications', desc: 'Real-time alerts on your device', on: pushOn, key: 'pref_push' },
      { id: 'tog-scheme', label: 'Scheme Alerts', desc: 'New eligible schemes notifications', on: schemeOn, key: 'pref_scheme' },
    ];
    items.forEach(function(it) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 12px;border-bottom:1px solid #F1F5F9">';
      html += '<div><div style="font-size:13px;font-weight:600">' + it.label + '</div><div style="font-size:10px;color:#6B7280;margin-top:2px">' + it.desc + '</div></div>';
      html += '<div id="' + it.id + '" data-key="' + it.key + '" data-on="' + (it.on ? '1' : '0') + '" style="' + togStyle(it.on) + '"><div style="' + dotStyle(it.on) + '"></div></div>';
      html += '</div>';
    });
    html += '</div>';
    openBottomSheet('Notification Preferences', html);
    // Bind toggles
    items.forEach(function(it) {
      document.getElementById(it.id).addEventListener('click', function() {
        var on = this.getAttribute('data-on') === '1';
        var newOn = !on;
        this.setAttribute('data-on', newOn ? '1' : '0');
        this.style.background = newOn ? '#046A38' : '#D1D5DB';
        this.firstChild.style.left = newOn ? 'auto' : '2px';
        this.firstChild.style.right = newOn ? '2px' : 'auto';
        localStorage.setItem(this.getAttribute('data-key'), newOn ? 'on' : 'off');
        showToast(it.label + ' ' + (newOn ? 'enabled' : 'disabled'));
      });
    });
  });

  // Language selector
  const btnLangRow = document.getElementById('btn-language-select-row');
  if (btnLangRow) btnLangRow.addEventListener('click', () => {
    var langs = [
      { code: 'en', label: 'English' },
      { code: 'te', label: 'Telugu' },
      { code: 'hi', label: 'Hindi' },
    ];
    var html = '<div style="padding:5px 0">';
    langs.forEach(function(l) {
      var active = currentLanguage === l.code;
      html += '<div class="lang-pick-item" data-lang="' + l.code + '" style="display:flex;align-items:center;justify-content:space-between;padding:14px 12px;border-bottom:1px solid #F1F5F9;cursor:pointer;background:' + (active ? '#F0FDF4' : '#fff') + '">';
      html += '<span style="font-size:14px;font-weight:' + (active ? '700' : '500') + '">' + l.label + '</span>';
      if (active) html += '<span style="color:#046A38;font-weight:700">&#10003;</span>';
      html += '</div>';
    });
    html += '</div>';
    openBottomSheet('Select Language', html);
    document.querySelectorAll('.lang-pick-item').forEach(function(el) {
      el.addEventListener('click', function() {
        var lang = this.getAttribute('data-lang');
        currentLanguage = lang;
        localStorage.setItem('app_language', lang);
        var lbl = document.getElementById('profile-lang-display');
        if (lbl) lbl.textContent = langs.find(function(l){return l.code===lang}).label + ' \u203A';
        closeBottomSheet();
        showToast('Language changed to ' + langs.find(function(l){return l.code===lang}).label);
        switchLanguage(lang);
      });
    });
  });

  // Dark Mode toggle
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) btnTheme.addEventListener('click', () => {
    var status = document.getElementById('theme-toggle-status');
    showToast('Dark mode coming soon!', 'warning');
  });

  // Help & Support
  const btnHelp = document.getElementById('btn-help-support');
  if (btnHelp) btnHelp.addEventListener('click', () => {
    var html = '<div style="padding:5px 0">';
    html += '<div style="padding:14px 12px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:12px"><div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#EFF6FF,#DBEAFE);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div><div><div style="font-size:13px;font-weight:700;margin-bottom:2px">Phone Support</div><div style="font-size:12px;color:#1E40AF;font-weight:600">8498984499</div><div style="font-size:10px;color:#6B7280;margin-top:2px">Available Mon-Sat, 9:00 AM - 6:00 PM</div></div></div>';
    html += '<div style="padding:14px 12px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:12px"><div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#F0FDF4,#DCFCE7);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div><div><div style="font-size:13px;font-weight:700;margin-bottom:2px">Email Support</div><div style="font-size:12px;color:#1E40AF;font-weight:600">gauravsujikumar@gmail.com</div><div style="font-size:10px;color:#6B7280;margin-top:2px">Response within 24 hours</div></div></div>';
    html += '<div style="padding:14px 12px"><div style="font-size:13px;font-weight:700;margin-bottom:4px">FAQs</div><div style="font-size:11px;color:#6B7280;line-height:1.6"><b>Q: How to apply for a certificate?</b><br>A: Use the AI Copilot or Services tab.<br><br><b>Q: How long does verification take?</b><br>A: Usually 3-7 working days.<br><br><b>Q: Is my data safe?</b><br>A: Yes, all data is encrypted and used only for government services.</div></div>';
    html += '</div>';
    openBottomSheet('Help & Support', html);
  });

  // Privacy Policy
  const btnPrivacy = document.getElementById('btn-privacy-policy');
  if (btnPrivacy) btnPrivacy.addEventListener('click', () => {
    var html = '<div style="padding:10px 4px;font-size:12px;color:#374151;line-height:1.7">';
    html += '<h4 style="font-size:14px;margin-bottom:10px">Privacy Policy</h4>';
    html += '<p><b>Data Collection:</b> We collect only information necessary for government service delivery - your name, Aadhaar details, documents, and application data.</p>';
    html += '<p style="margin-top:8px"><b>Data Usage:</b> Your data is used exclusively for processing government applications and providing personalized service recommendations.</p>';
    html += '<p style="margin-top:8px"><b>Data Storage:</b> All data is encrypted at rest and in transit using AES-256 and TLS 1.3 protocols.</p>';
    html += '<p style="margin-top:8px"><b>Data Sharing:</b> We do not share your data with third parties. Document verification is done through official government channels only.</p>';
    html += '<p style="margin-top:8px"><b>Your Rights:</b> You can request data deletion, export, or modification at any time through this app or by contacting support.</p>';
    html += '<p style="margin-top:8px;color:#6B7280;font-size:10px">Last updated: June 2026 | Governed by IT Act 2000 & Digital Personal Data Protection Act 2023</p>';
    html += '</div>';
    openBottomSheet('Privacy Policy', html);
  });

  // About App
  const btnAbout = document.getElementById('btn-about-app');
  if (btnAbout) btnAbout.addEventListener('click', () => {
    var html = '<div style="text-align:center;padding:20px 10px">';
    html += '<div style="width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#046A38,#0D8B4E);margin:0 auto 12px;display:flex;align-items:center;justify-content:center"><span style="font-size:28px;color:#fff;font-weight:800">OC</span></div>';
    html += '<div style="font-size:18px;font-weight:800;color:#1E293B">OneCitizen</div>';
    html += '<div style="font-size:12px;color:#6B7280;margin-top:4px">Version 1.0.0</div>';
    html += '<div style="font-size:11px;color:#6B7280;margin-top:16px;line-height:1.7;text-align:left">';
    html += '<p>OneCitizen is a unified government services platform that empowers citizens with AI-assisted service delivery, digital document management, and real-time application tracking.</p>';
    html += '<p style="margin-top:8px"><b>Key Features:</b></p>';
    html += '<ul style="padding-left:16px;margin-top:4px"><li>AI Copilot for service guidance</li><li>Digital Document Vault with OCR</li><li>Auto-filled application forms</li><li>Real-time eligibility matching</li></ul>';
    html += '</div>';
    html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #E2E8F0;font-size:10px;color:#9CA3AF">Built for the Citizens of India</div>';
    html += '</div>';
    openBottomSheet('About OneCitizen', html);
  });

  // Dotted Recommended Cards on Dashboard Screen
  document.querySelectorAll('.recommend-card').forEach(card => {
    card.addEventListener('click', () => {
      const svcName = card.getAttribute('data-service');
      switchScreen('screen-services');
      const searchBox = document.getElementById('services-search');
      if (searchBox) {
        searchBox.value = svcName;
        loadServicesCatalog(); // Filter immediately
      }
    });
  });

  // Close Bottom Sheet
  document.getElementById('btn-close-sheet')?.addEventListener('click', closeBottomSheet);

  // Language Dropdown change
  document.getElementById('lang-selector')?.addEventListener('change', (e) => {
    switchLanguage(e.target.value);
  });

  // Login Language Footer Links click
  document.querySelectorAll('.login-lang-footer span').forEach(span => {
    span.addEventListener('click', () => {
      const lang = span.getAttribute('data-lang');
      if (lang) switchLanguage(lang);
    });
  });

  // Dark Theme Toggle
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const chassis = document.querySelector('.phone-chassis');
    chassis.classList.toggle('dark-theme');
    updateMapTiles();
  });

  // Microphone Voice Assistant simulation
  document.getElementById('btn-voice-mic')?.addEventListener('click', simulateVoiceAssistant);

  // Logout Handlers
  const handleLogoutClick = () => {
    const title = "Confirm Sign Out";
    const html = `
      <div style="text-align: center; padding: 10px 0;">
        <p style="font-size: 13px; color: #64748B; margin-bottom: 20px; line-height: 1.4;">
          Are you sure you want to log out of your OneCitizen AI account?
        </p>
        <div style="display: flex; gap: 12px;">
          <button class="btn btn-primary" id="btn-confirm-logout-yes" style="flex: 1; font-weight: 700; font-size: 12px; padding: 10px; background: #EF4444 !important; border: none !important;">Yes, Logout</button>
          <button class="btn btn-accent" id="btn-confirm-logout-no" style="flex: 1; font-weight: 700; font-size: 12px; padding: 10px; background: #E2E8F0 !important; color: #1E293B !important; box-shadow: none !important;">Cancel</button>
        </div>
      </div>
    `;
    openBottomSheet(title, html);

    document.getElementById('btn-confirm-logout-yes').addEventListener('click', () => {
      closeBottomSheet();
      executeLogout();
    });

    document.getElementById('btn-confirm-logout-no').addEventListener('click', () => {
      closeBottomSheet();
    });
  };

  const executeLogout = () => {
    authToken = null;
    localStorage.removeItem('citizen_token');
    localStorage.removeItem('onboarding_completed'); // Reset onboarding flag so they can test it again
    
    // Clear status polling
    stopStatusPolling();
    if (_renewalReminderTimer) {
      clearInterval(_renewalReminderTimer);
      _renewalReminderTimer = null;
    }
    _lastAppStatuses = {};

    // Clear all login form fields
    const fieldsToClear = ['login-email', 'login-password', 'login-confirm-password', 'login-mobile'];
    fieldsToClear.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    // Reset signup mode
    window._isSignupMode = false;
    const confirmGroup = document.getElementById('confirm-password-group');
    if (confirmGroup) confirmGroup.style.display = 'none';
    const btnText = document.getElementById('email-login-btn-text');
    if (btnText) btnText.textContent = 'Login';
    const entryBtns = document.getElementById('login-entry-buttons');
    if (entryBtns) entryBtns.style.display = '';
    const optionsPanel = document.getElementById('login-options-panel');
    if (optionsPanel) optionsPanel.style.display = 'none';
    
    switchScreen('screen-login');
    showToast('Logged out successfully');
  };

  const logoutBtnProfileNew = document.getElementById('btn-logout-profile-new');
  if (logoutBtnProfileNew) logoutBtnProfileNew.addEventListener('click', handleLogoutClick);
}

// 4. API Request Helpers
async function apiCall(endpoint, method = 'GET', body = null, isMultipart = false) {
  const headers = {};
  if (!isMultipart) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = isMultipart ? body : JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, options);
  } catch (netErr) {
    throw new Error('Connection failed. Please check if the server is running.');
  }

  if (!response.ok) {
    let err;
    try {
      err = await response.json();
    } catch (e) {
      throw new Error(`Server error (${response.status}). Please try again later.`);
    }
    const error = new Error(err.error || 'Request failed');
    if (err.mismatches) error.mismatches = err.mismatches;
    if (err.typeMismatch) error.typeMismatch = err.typeMismatch;
    throw error;
  }

  try {
    return await response.json();
  } catch (e) {
    throw new Error('Failed to parse response from server.');
  }
}

// 5. Auth Handlers  Firebase Phone Auth
function setupAuthHandlers() {
  let countdownInterval = null;
  let confirmationResult = null; // Firebase confirmation object
  let recaptchaVerifier = null;

  // -- Firebase init --------------------------------------
  // Check if config has been filled in
  const firebaseReady = typeof FIREBASE_CONFIG !== 'undefined' &&
    FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('PASTE');

  if (firebaseReady) {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
  } else {
    console.warn('[Firebase] Config not set in firebase-config.js  using demo mode');
  }

  function initRecaptcha() {
    if (!firebaseReady) return;
    const container = document.getElementById('recaptcha-container');
    if (!container) return;
    // Destroy old verifier if any (needed on resend)
    if (recaptchaVerifier) {
      recaptchaVerifier.clear();
      container.innerHTML = '';
    }
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
      size: 'invisible',
      callback: () => {}
    });
    recaptchaVerifier.render();
  }

  // Initialise reCAPTCHA once DOM ready
  initRecaptcha();

  // -- OTP box auto-advance -------------------------------
  const otpBoxes = document.querySelectorAll('.otp-box');
  otpBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/, '');
      if (box.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) otpBoxes[i - 1].focus();
    });
  });

  function getEnteredOtp() {
    return Array.from(otpBoxes).map(b => b.value).join('');
  }

  function fillOtpBoxes(otp) {
    otp.split('').forEach((d, i) => { if (otpBoxes[i]) otpBoxes[i].value = d; });
  }

  function showVerifyStep(mobile) {
    document.getElementById('otp-mobile-display').textContent = '+91 ' + mobile;
    document.getElementById('otp-step-mobile').style.display = 'none';
    document.getElementById('otp-step-verify').style.display = 'block';
    otpBoxes.forEach(b => b.value = '');
    otpBoxes[0].focus();
    startCountdown();
  }

  function startCountdown() {
    let secs = 30;
    document.getElementById('otp-countdown').textContent = secs;
    document.getElementById('otp-timer').style.display = 'inline';
    document.getElementById('btn-resend-otp').style.display = 'none';
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      secs--;
      document.getElementById('otp-countdown').textContent = secs;
      if (secs <= 0) {
        clearInterval(countdownInterval);
        document.getElementById('otp-timer').style.display = 'none';
        document.getElementById('btn-resend-otp').style.display = 'inline';
      }
    }, 1000);
  }

  function setSendBtnLoading(loading) {
    const btn = document.getElementById('btn-send-otp');
    if (!btn) return;
    const textSpan = btn.querySelector('.btn-text');
    const spinnerSpan = btn.querySelector('.spinner-inline');
    btn.disabled = loading;
    if (textSpan && spinnerSpan) {
      textSpan.textContent = loading ? 'Sending...' : 'Send OTP';
      spinnerSpan.style.display = loading ? 'inline-block' : 'none';
    } else {
      btn.textContent = loading ? 'Sending...' : 'Send OTP';
    }
  }

  // -- Send OTP via Firebase ------------------------------
  async function requestOtp(mobile) {
    setSendBtnLoading(true);
    const phoneNumber = '+91' + mobile;

    if (!firebaseReady) {
      // -- DEMO MODE: no Firebase config yet --
      console.log('[Demo] Firebase not configured. Showing simulated OTP verification.');
      setTimeout(() => {
        showVerifyStep(mobile);
        setSendBtnLoading(false);
      }, 500);
      return;
    }

    try {
      confirmationResult = await firebase.auth().signInWithPhoneNumber(phoneNumber, recaptchaVerifier);
      showVerifyStep(mobile);
    } catch (err) {
      console.error('[Firebase OTP error]', err);
      console.warn('Firebase Phone Auth error. Falling back to simulated OTP mode.');
      alert(`Firebase Auth restriction/error: ${err.message || err}\n\nFalling back to simulated OTP mode (use any 6-digit OTP code to continue).`);
      confirmationResult = null; // Mark that we are falling back to simulation
      showVerifyStep(mobile);
    } finally {
      setSendBtnLoading(false);
    }
  }

  // -- After Firebase OTP verified <-’ exchange for app JWT -
  async function onFirebaseVerified(firebaseUser, mobile) {
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/auth/firebase-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, mobile })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      authToken = data.token;
      localStorage.setItem('citizen_token', authToken);
      currentRole = data.user.role;
      clearInterval(countdownInterval);
      if (!localStorage.getItem('onboarding_completed')) {
        switchScreen('screen-onboarding');
      } else {
        switchScreen('screen-dashboard');
      }
      if (currentRole === 'admin') loadAdminDashboard();
    } catch (err) {
      alert(`Login error: ${err.message}`);
    }
  }

  // -- Event: Login button → reveal login options -----------
  document.getElementById('btn-show-login-options')?.addEventListener('click', () => {
    document.getElementById('login-entry-buttons').style.display = 'none';
    const panel = document.getElementById('login-options-panel');
    panel.style.display = 'block';
    panel.style.animation = 'fadeInUp 0.3s ease';
  });

  // -- Event: Back button → return to entry -----------------
  document.getElementById('btn-back-to-entry')?.addEventListener('click', () => {
    document.getElementById('login-options-panel').style.display = 'none';
    document.getElementById('login-entry-buttons').style.display = 'block';
    // Reset OTP steps
    var otpMobile = document.getElementById('otp-step-mobile');
    var otpVerify = document.getElementById('otp-step-verify');
    if (otpMobile) otpMobile.style.display = 'block';
    if (otpVerify) otpVerify.style.display = 'none';

    // Reset signup mode and form fields
    window._isSignupMode = false;
    const confirmPass = document.getElementById('confirm-password-group');
    if (confirmPass) confirmPass.style.display = 'none';
    const loginBtnText = document.getElementById('email-login-btn-text');
    if (loginBtnText) loginBtnText.textContent = 'Login';
  });

  // -- Event: Create Account (same flow as login) -----------
  document.getElementById('btn-show-signup')?.addEventListener('click', () => {
    document.getElementById('login-entry-buttons').style.display = 'none';
    const panel = document.getElementById('login-options-panel');
    if (panel) {
      panel.style.display = 'block';
      panel.style.animation = 'fadeInUp 0.3s ease';
    }

    // Set signup mode and form fields
    window._isSignupMode = true;
    const confirmPass = document.getElementById('confirm-password-group');
    if (confirmPass) confirmPass.style.display = 'block';
    const loginBtnText = document.getElementById('email-login-btn-text');
    if (loginBtnText) loginBtnText.textContent = 'Create Account';
  });

  // -- Event: Send OTP button -----------------------------
  document.getElementById('btn-send-otp')?.addEventListener('click', async () => {
    const mobile = document.getElementById('login-mobile').value.trim() || '9000000001';
    
    const btn = document.getElementById('btn-send-otp');
    const textSpan = btn?.querySelector('.btn-text');
    const spinnerSpan = btn?.querySelector('.spinner-inline');
    
    if (btn) {
      btn.disabled = true;
      if (textSpan && spinnerSpan) {
        textSpan.textContent = 'Connecting...';
        spinnerSpan.style.display = 'inline-block';
      }
    }

    try {
      // Directly call local API to simulate authentication and get citizen JWT token
      const res = await fetch('/api/auth/firebase-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'demo_mock_token', mobile })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      authToken = data.token;
      localStorage.setItem('citizen_token', authToken);
      currentRole = data.user.role;
      
      // Go to onboarding if not done, otherwise dashboard
      if (!localStorage.getItem('onboarding_completed')) {
        switchScreen('screen-onboarding');
      } else {
        switchScreen('screen-dashboard');
      }
      if (currentRole === 'admin') loadAdminDashboard();
    } catch (err) {
      alert(`Login failed: ${err.message}`);
      if (btn) {
        btn.disabled = false;
        if (textSpan && spinnerSpan) {
          textSpan.textContent = 'Send OTP';
          spinnerSpan.style.display = 'none';
        }
      }
    }
  });

  // -- Event: Resend OTP ----------------------------------
  document.getElementById('btn-resend-otp')?.addEventListener('click', () => {
    const mobile = document.getElementById('login-mobile').value.trim();
    initRecaptcha(); // must re-init for resend
    requestOtp(mobile);
  });

  // -- Event: Change number -------------------------------
  document.getElementById('btn-change-mobile')?.addEventListener('click', () => {
    clearInterval(countdownInterval);
    confirmationResult = null;
    document.getElementById('otp-step-verify').style.display = 'none';
    document.getElementById('otp-step-mobile').style.display = 'block';
    
    // Reset verify button and loading status
    const btn = document.getElementById('btn-verify-otp');
    const loadingStatus = document.getElementById('otp-loading-status');
    if (loadingStatus) loadingStatus.style.display = 'none';
    if (btn) {
      btn.style.display = 'inline-block';
      btn.disabled = false;
      btn.textContent = 'Verify & Login';
    }
    
    document.getElementById('login-mobile').focus();
  });

  // -- Event: Verify OTP ---------------------------------
  document.getElementById('btn-verify-otp')?.addEventListener('click', async () => {
    const entered = getEnteredOtp();
    if (entered.length < 6) { alert('Please enter the 6-digit OTP.'); return; }

    const btn = document.getElementById('btn-verify-otp');
    const textSpan = btn?.querySelector('.btn-text');
    const spinnerSpan = btn?.querySelector('.spinner-inline');
    
    if (btn) {
      btn.disabled = true;
      if (textSpan && spinnerSpan) {
        textSpan.textContent = 'Verifying...';
        spinnerSpan.style.display = 'inline-block';
      }
    }

    try {
      const mobile = document.getElementById('login-mobile').value.trim();
      if (!firebaseReady || !confirmationResult) {
        // -- DEMO MODE: Call the firebase-login endpoint with dummy token to get JWT --
        const res = await fetch('/api/auth/firebase-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: 'demo_mock_token', mobile })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        authToken = data.token;
        localStorage.setItem('citizen_token', authToken);
        currentRole = data.user.role;
        clearInterval(countdownInterval);
        if (!localStorage.getItem('onboarding_completed')) {
          switchScreen('screen-onboarding');
        } else {
          switchScreen('screen-dashboard');
        }
        if (currentRole === 'admin') loadAdminDashboard();
      } else {
        const result = await confirmationResult.confirm(entered);
        await onFirebaseVerified(result.user, mobile);
      }
    } catch (err) {
      const msg = err.code === 'auth/invalid-verification-code'
        ? 'Incorrect OTP. Please try again.'
        : err.message;
      alert(msg);
      if (btn) {
        btn.disabled = false;
        if (textSpan && spinnerSpan) {
          textSpan.textContent = 'Verify & Login';
          spinnerSpan.style.display = 'none';
        }
      }
    }
  });

  // -- Demo shortcuts -------------------------------------
  const shortcutCitizen = document.getElementById('shortcut-citizen');
  if (shortcutCitizen) {
    shortcutCitizen.addEventListener('click', () => {
      document.getElementById('login-mobile').value = '9000000001';
      document.getElementById('otp-step-mobile').style.display = 'block';
      document.getElementById('otp-step-verify').style.display = 'none';
      requestOtp('9000000001');
    });
  }

  const shortcutAdmin = document.getElementById('shortcut-admin');
  if (shortcutAdmin) {
    shortcutAdmin.addEventListener('click', () => {
      document.getElementById('login-mobile').value = '9000000002';
      document.getElementById('otp-step-mobile').style.display = 'block';
      document.getElementById('otp-step-verify').style.display = 'none';
      requestOtp('9000000002');
    });
  }
}

async function checkTokenAndLoad() {
  try {
    const profile = await apiCall('/auth/profile');
    switchScreen('screen-dashboard');
    if (currentRole === 'admin') loadAdminDashboard();
  } catch (e) {
    // Session expired
    authToken = null;
    localStorage.removeItem('citizen_token');
    switchScreen('screen-login');
  }
}

// Google Sign-In Handler - Proper auth with password
function setupGoogleLogin() {
  const btnGoogle = document.getElementById('btn-google-login');
  if (!btnGoogle) return;

  btnGoogle.addEventListener('click', () => {
    // Step 1: Enter email
    const html = `
      <div style="padding: 10px 0;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
          <svg width="28" height="28" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          <div>
            <div style="font-size: 14px; font-weight: 700; color: #1E293B;">Sign in with Email</div>
            <div style="font-size: 11px; color: #64748B;">Your data is saved separately for each account</div>
          </div>
        </div>
        <div class="form-group" style="margin-bottom: 14px;">
          <label style="font-size: 10px; font-weight: 700; color: #0F294A; text-transform: uppercase;">Email Address</label>
          <input type="email" id="google-email-input" placeholder="yourname@gmail.com" style="width: 100%; height: 40px; border-radius: 8px; border: 1.5px solid #D1D5DB; padding: 0 12px; font-size: 13px; font-weight: 500; margin-top: 5px; box-sizing: border-box;" />
        </div>
        <button id="btn-google-check-email" style="width: 100%; padding: 13px; border: none; border-radius: 10px; background: linear-gradient(135deg, #4285F4, #1a73e8); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;">
          Continue
        </button>
      </div>
    `;
    openBottomSheet('Email Sign-In', html);
    setTimeout(() => { const inp = document.getElementById('google-email-input'); if (inp) inp.focus(); }, 200);

    document.getElementById('btn-google-check-email').addEventListener('click', async () => {
      const email = (document.getElementById('google-email-input')?.value || '').trim();
      if (!email || !email.includes('@')) { showToast('Please enter a valid email'); return; }

      const btn = document.getElementById('btn-google-check-email');
      btn.disabled = true; btn.textContent = 'Checking...';

      try {
        const res = await fetch('/api/auth/google-check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        closeBottomSheet();

        if (data.status === 'new') {
          showGoogleSignupSheet(email);
        } else {
          showGoogleLoginSheet(email);
        }
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false; btn.textContent = 'Continue';
      }
    });
  });
}

// Password visibility toggle — custom SVG eye icon (consistent across desktop & mobile)
function setupPasswordToggles() {
  document.querySelectorAll('.pw-eye-toggle').forEach(toggle => {
    toggle.addEventListener('click', function() {
      const targetId = this.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      // Swap icon: eye-open ↔ eye-off
      this.innerHTML = isPassword
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      this.style.color = isPassword ? '#4285F4' : '#94A3B8';
    });
  });
}

// Step 2a: New user - create account with password
function showGoogleSignupSheet(email) {
  const html = `
    <div style="padding: 10px 0;">
      <div style="background: #EFF6FF; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; border: 1px solid #BFDBFE;">
        <p style="font-size: 11px; color: #1E40AF; margin: 0; font-weight: 600;">🆕 New Account</p>
        <p style="font-size: 12px; color: #1E293B; margin: 4px 0 0; font-weight: 500;">${escapeHTML(email)}</p>
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="font-size: 10px; font-weight: 700; color: #0F294A; text-transform: uppercase;">Create Password</label>
        <div style="position: relative; margin-top: 5px;">
          <input type="password" id="google-password-input" placeholder="Min 4 characters" style="width: 100%; height: 40px; border-radius: 8px; border: 1.5px solid #D1D5DB; padding: 0 40px 0 12px; font-size: 13px; box-sizing: border-box;" />
          <span class="pw-eye-toggle" data-target="google-password-input" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; color: #94A3B8; display: flex; align-items: center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </span>
        </div>
      </div>
      <div class="form-group" style="margin-bottom: 14px;">
        <label style="font-size: 10px; font-weight: 700; color: #0F294A; text-transform: uppercase;">Confirm Password</label>
        <div style="position: relative; margin-top: 5px;">
          <input type="password" id="google-password-confirm" placeholder="Re-enter password" style="width: 100%; height: 40px; border-radius: 8px; border: 1.5px solid #D1D5DB; padding: 0 40px 0 12px; font-size: 13px; box-sizing: border-box;" />
          <span class="pw-eye-toggle" data-target="google-password-confirm" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; color: #94A3B8; display: flex; align-items: center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </span>
        </div>
      </div>
      <button id="btn-google-create-account" style="width: 100%; padding: 13px; border: none; border-radius: 10px; background: linear-gradient(135deg, #046A38, #0D8B4E); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;">
        Create Account & Login
      </button>
      <p style="text-align: center; margin-top: 10px;"><span id="btn-google-back-to-email" style="font-size: 11px; color: #4285F4; cursor: pointer; font-weight: 600;">← Change email</span></p>
    </div>
  `;
  openBottomSheet('Create Account', html);
  setTimeout(() => {
    setupPasswordToggles();
    const inp = document.getElementById('google-password-input'); if (inp) inp.focus();
  }, 200);

  document.getElementById('btn-google-back-to-email')?.addEventListener('click', () => { closeBottomSheet(); document.getElementById('btn-google-login')?.click(); });

  document.getElementById('btn-google-create-account').addEventListener('click', async () => {
    const pw = (document.getElementById('google-password-input')?.value || '');
    const pw2 = (document.getElementById('google-password-confirm')?.value || '');
    if (pw.length < 4) { showToast('Password must be at least 4 characters'); return; }
    if (pw !== pw2) { showToast('Passwords do not match'); return; }

    const btn = document.getElementById('btn-google-create-account');
    btn.disabled = true; btn.textContent = 'Creating account...';

    try {
      const res = await fetch('/api/auth/google-signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pw, displayName: '' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      authToken = data.token;
      localStorage.setItem('citizen_token', authToken);
      currentRole = data.user.role;
      closeBottomSheet();
      if (!localStorage.getItem('onboarding_completed')) { switchScreen('screen-onboarding'); } else { switchScreen('screen-dashboard'); }
      if (currentRole === 'admin') loadAdminDashboard();
      showToast('Account created successfully!');
    } catch (err) {
      showToast(err.message);
      btn.disabled = false; btn.textContent = 'Create Account & Login';
    }
  });
}

// Step 2b: Existing user - verify password
function showGoogleLoginSheet(email) {
  const html = `
    <div style="padding: 10px 0;">
      <div style="background: #F0FDF4; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; border: 1px solid #BBF7D0;">
        <p style="font-size: 11px; color: #16A34A; margin: 0; font-weight: 600;">✅ Account Found</p>
        <p style="font-size: 12px; color: #1E293B; margin: 4px 0 0; font-weight: 500;">${escapeHTML(email)}</p>
      </div>
      <div class="form-group" style="margin-bottom: 14px;">
        <label style="font-size: 10px; font-weight: 700; color: #0F294A; text-transform: uppercase;">Enter Password</label>
        <div style="position: relative; margin-top: 5px;">
          <input type="password" id="google-password-input" placeholder="Enter your password" style="width: 100%; height: 40px; border-radius: 8px; border: 1.5px solid #D1D5DB; padding: 0 40px 0 12px; font-size: 13px; box-sizing: border-box;" />
          <span class="pw-eye-toggle" data-target="google-password-input" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; color: #94A3B8; display: flex; align-items: center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </span>
        </div>
      </div>
      <button id="btn-google-verify-password" style="width: 100%; padding: 13px; border: none; border-radius: 10px; background: linear-gradient(135deg, #4285F4, #1a73e8); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;">
        Login
      </button>
      <p style="text-align: center; margin-top: 10px;"><span id="btn-google-back-to-email" style="font-size: 11px; color: #4285F4; cursor: pointer; font-weight: 600;">← Change email</span></p>
    </div>
  `;
  openBottomSheet('Login', html);
  setTimeout(() => {
    setupPasswordToggles();
    const inp = document.getElementById('google-password-input'); if (inp) inp.focus();
  }, 200);

  document.getElementById('btn-google-back-to-email')?.addEventListener('click', () => { closeBottomSheet(); document.getElementById('btn-google-login')?.click(); });

  document.getElementById('btn-google-verify-password').addEventListener('click', async () => {
    const pw = (document.getElementById('google-password-input')?.value || '');
    if (!pw) { showToast('Please enter your password'); return; }

    const btn = document.getElementById('btn-google-verify-password');
    btn.disabled = true; btn.textContent = 'Verifying...';

    try {
      const res = await fetch('/api/auth/google-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      authToken = data.token;
      localStorage.setItem('citizen_token', authToken);
      currentRole = data.user.role;
      closeBottomSheet();
      if (!localStorage.getItem('onboarding_completed')) { switchScreen('screen-onboarding'); } else { switchScreen('screen-dashboard'); }
      if (currentRole === 'admin') loadAdminDashboard();
      showToast('Welcome back!');
    } catch (err) {
      showToast(err.message);
      btn.disabled = false; btn.textContent = 'Login';
    }
  });
}


// 6. Citizen Dashboard Loader
async function loadDashboardData() {
  try {
    // Parallelize core data fetching using Promise.allSettled
    const results = await Promise.allSettled([
      apiCall('/auth/profile'),
      apiCall('/documents'),
      apiCall('/services/user-applications'),
      apiCall('/services/recommendations/list'),
      (allServices.length === 0 ? apiCall('/services') : Promise.resolve(allServices))
    ]);

    const profile = results[0].status === 'fulfilled' ? results[0].value : null;
    const docs = results[1].status === 'fulfilled' ? results[1].value : [];
    let applications = results[2].status === 'fulfilled' ? results[2].value : [];
    let recommendations = results[3].status === 'fulfilled' ? results[3].value : [];
    if (results[4].status === 'fulfilled') {
      allServices = results[4].value;
    }

    if (!profile) {
      throw new Error('Failed to load user profile data');
    }

    // Deduplicate: keep only the latest application per service_id
    // If both rejected and non-rejected exist, prefer the non-rejected one
    var appMap = {};
    applications.forEach(function(a) {
      var key = a.service_id;
      if (!appMap[key]) {
        appMap[key] = a;
      } else {
        var existing = appMap[key];
        // Prefer non-rejected over rejected
        if (existing.status === 'rejected' && a.status !== 'rejected') {
          appMap[key] = a;
        } else if (a.status === 'rejected' && existing.status !== 'rejected') {
          // keep existing (non-rejected)
        } else {
          // Both same priority — keep the newer one
          var existDate = new Date(existing.created_at || 0).getTime();
          var newDate = new Date(a.created_at || 0).getTime();
          if (newDate > existDate) appMap[key] = a;
        }
      }
    });
    applications = Object.values(appMap);

    
    // Only count the 6 core profile documents for citizen profile completeness
    const PROFILE_DOC_TYPES = ['aadhaar', 'pan', 'voter', 'driving', 'ration', 'passport'];
    const verifiedDocs = docs.filter(d => d.is_verified === 1 && PROFILE_DOC_TYPES.includes(d.document_type));
    const verifiedCount = verifiedDocs.length;
    const isFullyVerified = verifiedCount >= 6;

    // Dynamically render Recommended Services (filter out already-applied services)
    const recContainer = document.getElementById('recommended-services-container');
    if (recContainer) {
      try {
        // Fetch all available services
        if (allServices.length === 0) {
          try { allServices = await apiCall('/services'); } catch(e) {}
        }
        // Get service IDs with active (non-rejected) applications
        const activeAppServiceIds = applications
          .filter(a => a.status !== 'rejected')
          .map(a => a.service_id);
        // Filter to services not yet applied for
        const availableServices = allServices.filter(s => !activeAppServiceIds.includes(s.id));
        
        const recColorThemes = [
          { cardClass: 'green-rec-card', stroke: '#08573c', badge: 'Recommended' },
          { cardClass: 'orange-rec-card', stroke: '#EA580C', badge: 'Popular' },
          { cardClass: 'blue-rec-card', stroke: '#1A73E8', badge: 'Quick Process' },
          { cardClass: 'purple-rec-card', stroke: '#7C3AED', badge: 'New' }
        ];

        if (availableServices.length > 0) {
          // Show up to 2 recommended cards
          const showServices = availableServices.slice(0, 2);
          let recHtml = '';
          showServices.forEach(function(svc, idx) {
            const theme = recColorThemes[idx % recColorThemes.length];
            const feeText = svc.fees > 0 ? '₹' + svc.fees : 'Free';
            // Check if user already applied for this service
            const existingApp = applications.find(a => a.service_id === svc.id);
            let ctaBtnHtml = '<button class="btn-rec-cta">Apply Now</button>';
            if (existingApp) {
              if (existingApp.status === 'approved') {
                ctaBtnHtml = '<button class="btn-rec-cta" style="background:#F0FDF4 !important;color:#046A38 !important;border:1px solid #046A38;cursor:default;pointer-events:none;">✓ Applied</button>';
              } else if (existingApp.status === 'under_review' || existingApp.status === 'pending') {
                ctaBtnHtml = '<button class="btn-rec-cta" style="background:#FFFBEB !important;color:#D97706 !important;border:1px solid #D97706;cursor:default;pointer-events:none;">⏳ Under Review</button>';
              } else if (existingApp.status === 'rejected') {
                ctaBtnHtml = '<button class="btn-rec-cta" style="background:#FEF2F2 !important;color:#DC2626 !important;border:1px solid #DC2626;">↻ Apply Again</button>';
              }
            }
            recHtml += '<div class="recommend-card-modern ' + theme.cardClass + '" data-service="' + svc.name + '" style="cursor:pointer;">' +
              '<div class="rec-card-header-row">' +
              '<div class="rec-card-icon-wrap-lucide">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + theme.stroke + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>' +
              '<polyline points="14 2 14 8 20 8"></polyline>' +
              '<line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></div>' +
              '<div class="rec-card-title-wrap"><h5>' + svc.name + '</h5>' +
              '<div class="rec-card-badge">' + theme.badge + '</div></div></div>' +
              '<div class="rec-card-meta">' +
              '<span class="meta-time">⏱ ' + (svc.processing_time || 'N/A') + '</span>' +
              '<span class="meta-dot">•</span>' +
              '<span class="meta-fee">' + feeText + '</span></div>' +
              ctaBtnHtml + '</div>';
          });
          recContainer.innerHTML = recHtml;

          // Wire click handlers on the new dynamic cards
          recContainer.querySelectorAll('.recommend-card-modern').forEach(function(card) {
            card.addEventListener('click', async function() {
              const svcName = card.getAttribute('data-service');
              await openServiceFormByName(svcName);
            });
          });
        } else {
          recContainer.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#64748B;">' +
            '<div style="font-size:20px;margin-bottom:6px;">🎉</div>' +
            '<p style="font-size:12px;font-weight:600;color:#1E293B;">All Services Applied!</p>' +
            '<p style="font-size:11px;color:#94A3B8;">You have applied for all available services.</p></div>';
        }
      } catch(e) {
        console.warn('Failed to render recommended services:', e.message);
      }
    }

    // Use initials avatar for named users, silhouette for new users
    const hasName = profile.name && profile.name.trim();
    const userSilhouetteSVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="white" style="display:block;margin:auto;"><circle cx="12" cy="8" r="4"/><path d="M12 14c-6.1 0-8 4-8 4v2h16v-2s-1.9-4-8-4z"/></svg>`;

    // Toggle avatars
    const initialAvatar = document.querySelector('.profile-initials-avatar');
    if (initialAvatar) {
      if (hasName) {
        initialAvatar.innerHTML = profile.name.trim().charAt(0).toUpperCase();
      } else {
        initialAvatar.innerHTML = userSilhouetteSVG;
      }
    }

    const initial = hasName ? profile.name.trim().charAt(0).toUpperCase() : 'C';
    const avatarSrc = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%23046A38'/%3E%3Ctext x='20' y='25' font-size='18' fill='white' text-anchor='middle' font-weight='bold'%3E${initial}%3C/text%3E%3C/svg%3E`;
    const summaryAvatar = document.querySelector('.summary-avatar');
    if (summaryAvatar) summaryAvatar.src = avatarSrc;
    
    // Greeting — time of day on top line, name on bottom
    const displayName = hasName ? profile.name.trim() : 'Citizen';
    document.getElementById('dash-greeting-name').innerHTML = `${displayName} 👋`;
    
    // Update profile page card
    const profileCardName = document.getElementById('profile-card-name');
    if (profileCardName) profileCardName.textContent = displayName;
    const profileCardPhone = document.getElementById('profile-card-phone');
    if (profileCardPhone) {
      var storedMobile = document.getElementById('login-mobile')?.value || '';
      profileCardPhone.textContent = storedMobile ? '+91 ' + storedMobile : '+91 XXXXXXXXXX';
    }
    const profileAvatarInit = document.getElementById('profile-avatar-initial');
    if (profileAvatarInit) profileAvatarInit.textContent = displayName.charAt(0).toUpperCase();
    
    // Dynamic greeting based on time of day
    const hour = new Date().getHours();
    const dict = TRANSLATIONS[currentLanguage] || TRANSLATIONS['en'];
    let timeKey = 'morning';
    if (hour >= 12 && hour < 17) {
      timeKey = 'afternoon';
    } else if (hour >= 17) {
      timeKey = 'evening';
    }
    const lblNamaste = document.getElementById('lbl-namaste');
    if (lblNamaste) lblNamaste.innerText = dict[timeKey] || dict.namaste;
    
    const copilotGreeting = document.getElementById('copilot-greeting-title');
    if (copilotGreeting) {
      copilotGreeting.innerText = hasName ? `Hello ${displayName}! ` : 'Hello Citizen! ';
    }
    
    // Update documents warning banner (for old templates if any)
    const warnRow = document.querySelector('.twin-warn-row');
    if (warnRow) {
      if (isFullyVerified) {
        warnRow.innerHTML = `
          <span class="warn-icon" style="color:var(--success-emerald); display: inline-flex; align-items: center;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <span class="warn-text" style="color:var(--success-emerald)">All Documents Linked</span>
        `;
      } else {
        warnRow.innerHTML = `
          <span class="warn-icon" style="display: inline-flex; align-items: center;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </span>
          <span class="warn-text">${6 - verifiedCount} Documents Needed</span>
        `;
      }
    }

    // Progress calculation based on seeded parameters
    let filled = 0;
    const fields = ['name', 'dob', 'gender', 'occupation', 'income_amount', 'state', 'district', 'caste'];
    fields.forEach(f => {
      if (profile[f] !== null && profile[f] !== '' && profile[f] !== 0) filled++;
    });
    const pct = isFullyVerified ? Math.round((filled / fields.length) * 100) : Math.round((verifiedCount / 6) * 100);
    
    // Update old dashboard progress components (Radial Circle & Text percentage)
    const radialText = document.getElementById('dash-profile-pct-text');
    if (radialText) radialText.innerText = `${pct}%`;
    const radialFill = document.getElementById('radial-progress-fill');
    if (radialFill) radialFill.setAttribute('stroke-dasharray', `${pct}, 100`);

    // Update new dashboard progress components on Digital Twin Profile card
    const dtCompletenessVal = document.getElementById('dt-completeness-value');
    if (dtCompletenessVal) dtCompletenessVal.innerText = `Citizen Profile: ${verifiedCount}/6 Documents Verified`;
    
    const dtDocsRatio = document.getElementById('dt-docs-ratio');
    if (dtDocsRatio) dtDocsRatio.innerText = `${verifiedCount} / 6`;
    
    const dtNextStep = document.getElementById('dt-next-step');
    if (dtNextStep) {
      if (verifiedCount === 0) {
        dtNextStep.innerText = 'Upload Aadhaar Card';
      } else if (verifiedCount === 1) {
        dtNextStep.innerText = 'Upload PAN Card';
      } else if (verifiedCount === 2) {
        dtNextStep.innerText = 'Upload Voter ID';
      } else if (verifiedCount === 3) {
        dtNextStep.innerText = 'Upload Driving License';
      } else if (verifiedCount === 4) {
        dtNextStep.innerText = 'Upload Ration Card';
      } else if (verifiedCount === 5) {
        dtNextStep.innerText = 'Upload Passport';
      } else {
        dtNextStep.innerText = 'All documents verified!';
      }
    }

    const dtProgressBarFill = document.getElementById('dt-progress-bar-fill');
    if (dtProgressBarFill) dtProgressBarFill.style.width = `${pct}%`;

    // Update Activity stats numbers
    const actDocsCount = document.getElementById('activity-docs-count');
    if (actDocsCount) actDocsCount.innerText = verifiedCount;

    const actAppsCount = document.getElementById('activity-apps-count');
    if (actAppsCount) {
      actAppsCount.innerText = applications.length;
    }

    const actSchemesCount = document.getElementById('activity-schemes-count');
    if (actSchemesCount) {
      const hasAadhaar = docs.some(d => d.document_type === 'aadhaar' && d.is_verified === 1);
      const eligibleCount = hasAadhaar ? recommendations.filter(r => r.is_eligible).length : 0;
      actSchemesCount.innerText = eligibleCount;
    }

    const actApprovedCount = document.getElementById('activity-approved-count');
    if (actApprovedCount) {
      const approvedCount = applications.filter(a => a.status === 'approved').length;
      actApprovedCount.innerText = approvedCount;
    }

    // Update Account Status dynamically
    const hasAadhaar = docs.some(d => d.document_type === 'aadhaar' && d.is_verified === 1);
    const hasPan = docs.some(d => d.document_type === 'pan' && d.is_verified === 1);
    const hasIncome = docs.some(d => d.document_type === 'income' && d.is_verified === 1);

    const statusDot = document.getElementById('account-status-dot');
    const statusText = document.getElementById('account-status-text');

    if (statusDot && statusText) {
      if (!hasAadhaar) {
        statusText.innerText = 'Action Required (Verification Pending)';
        statusText.className = 'status-red';
        statusDot.style.backgroundColor = '#EF4444';
        statusDot.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.6)';
      } else if (!hasPan || !hasIncome) {
        statusText.innerText = 'Documentation Pending';
        statusText.className = 'status-orange';
        statusDot.style.backgroundColor = '#F59E0B';
        statusDot.style.boxShadow = '0 0 8px rgba(245, 158, 11, 0.6)';
      } else {
        statusText.innerText = 'Good Standing';
        statusText.className = 'status-green';
        statusDot.style.backgroundColor = '#10B981';
        statusDot.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.6)';
      }
    }

    // Update AI Assistant Recommendation Card dynamically
    const aiInsightText = document.getElementById('ai-insight-text');
    if (aiInsightText) {
      if (!hasAadhaar) {
        aiInsightText.innerText = 'Please upload your Aadhaar Card to activate your Citizen Digital Twin and discover welfare schemes.';
      } else if (!hasPan) {
        aiInsightText.innerText = 'Aadhaar verified! Upload your PAN Card to unlock financial services and tax-related applications.';
      } else {
        aiInsightText.innerText = 'Key documents verified! Upload Voter ID and Driving License to complete your Digital Twin profile.';
      }
    }

    // Update Digital Twin Profile verification checklist state
    const updateVerifItem = (elementId, docType, labelName) => {
      const el = document.getElementById(elementId);
      if (!el) return;
      const doc = docs.find(d => d.document_type === docType);
      const iconEl = el.querySelector('.verif-icon');
      const labelEl = el.querySelector('.verif-label');
      
      if (doc && doc.is_verified === 1) {
        el.className = 'dt-verif-item verified';
        if (iconEl) iconEl.innerText = '';
        if (labelEl) labelEl.innerText = `${labelName} Verified`;
      } else if (doc) {
        el.className = 'dt-verif-item pending';
        if (iconEl) iconEl.innerText = '...';
        if (labelEl) labelEl.innerText = `${labelName} Pending Verification`;
      } else {
        el.className = 'dt-verif-item pending';
        if (iconEl) iconEl.innerText = '...';
        if (labelEl) labelEl.innerText = `${labelName} Pending`;
      }
    };

    updateVerifItem('dt-verif-aadhaar', 'aadhaar', 'Aadhaar');
    updateVerifItem('dt-verif-pan', 'pan', 'PAN');
    updateVerifItem('dt-verif-voter', 'voter', 'Voter ID');
    updateVerifItem('dt-verif-driving', 'driving', 'Driving License');
    updateVerifItem('dt-verif-ration', 'ration', 'Ration Card');
    updateVerifItem('dt-verif-passport', 'passport', 'Passport');

    // Helper for formatting date strings
    const formatDate = (dateStr) => {
      try {
        const d = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `Applied on ${d.getDate().toString().padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
      } catch(e) {
        return 'Applied recently';
      }
    };

    // Update Recent Applications List dynamically
    const recentAppsContainer = document.getElementById('recent-apps-container');
    const clearRecentBtn = document.getElementById('btn-clear-recent');
    if (recentAppsContainer) {
      // Show/hide Clear All button
      const hasDrafts = Object.keys(JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}')).length > 0;
      const hasApps = applications.length > 0;
      // Update activity count
      const actAppsCount = document.getElementById('activity-apps-count');
      if (actAppsCount) actAppsCount.innerText = applications.length.toString();
      if (clearRecentBtn) {
        clearRecentBtn.style.display = (hasDrafts || hasApps) ? 'inline' : 'none';
        clearRecentBtn.onclick = () => {
          const confirmHtml = `
            <div style="padding: 10px 0;">
              <p style="font-size: 13px; color: #1E293B; margin-bottom: 18px; line-height: 1.5;">
                Are you sure you want to clear all recent applications?
              </p>
              <div style="display: flex; gap: 12px;">
                <button class="btn btn-primary" id="btn-clear-confirm" style="flex: 1; font-weight: 700; font-size: 12px; padding: 10px; background: #DC2626 !important; border: none !important;">Clear All</button>
                <button class="btn btn-accent" id="btn-clear-cancel" style="flex: 1; font-weight: 700; font-size: 12px; padding: 10px; background: #E2E8F0 !important; color: #1E293B !important; box-shadow: none !important;">Cancel</button>
              </div>
            </div>
          `;
          openBottomSheet('Clear Applications', confirmHtml);
          document.getElementById('btn-clear-confirm').addEventListener('click', async () => {
            closeBottomSheet();
            // Clear localStorage drafts
            localStorage.removeItem('one_citizen_drafts');
            // Immediately show empty state
            recentAppsContainer.innerHTML = `
              <div class="empty-state" style="text-align: center; padding: 24px; color: #64748B; width: 100%;">
                <div style="font-size: 24px; margin-bottom: 8px;"></div>
                <h5 style="margin-bottom: 4px; font-weight: 600; color: #1E293B; font-size: 13px;">No Recent Applications</h5>
                <p style="font-size: 11px; margin: 0; color: #64748B;">Start an application under services or ask AI Copilot.</p>
              </div>
            `;
            clearRecentBtn.style.display = 'none';
            // Update metric counts
            const actAppsCount = document.getElementById('activity-apps-count');
            if (actAppsCount) actAppsCount.innerText = '0';
            // Clear server-side applications
            try {
              await apiCall('/services/clear-applications', 'DELETE');
            } catch (e) { /* ignore if endpoint doesn't exist */ }
            showToast('Recent applications cleared');
          });
          document.getElementById('btn-clear-cancel').addEventListener('click', () => {
            closeBottomSheet();
          });
        };
      }

      // Build combined list: submitted applications + remaining drafts
      let recentHtml = '';

      // 1. Render submitted applications (sorted newest first)
      if (applications.length > 0) {
        const sortedApps = [...applications].sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        recentHtml += sortedApps.map(renderAppCard).join('');
      }

      // 2. Retrieve drafts from localStorage, filtering out any that already have a submitted application
      const allDrafts = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
      const submittedServiceIds = applications.map(a => a.service_id || '');
      const remainingDrafts = Object.values(allDrafts).filter(draft => {
        return draft.service && !submittedServiceIds.includes(draft.service.id);
      });

      // Auto-clean drafts that have been submitted (remove stale drafts from localStorage)
      if (Object.keys(allDrafts).length !== remainingDrafts.length) {
        const cleanedDrafts = {};
        remainingDrafts.forEach(d => { if (d.service) cleanedDrafts[d.service.id] = d; });
        localStorage.setItem('one_citizen_drafts', JSON.stringify(cleanedDrafts));
      }

      if (remainingDrafts.length > 0) {
        const sortedDrafts = remainingDrafts.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        recentHtml += sortedDrafts.map(draft => {
          const s = draft.service;
          const dateStr = formatDate(draft.timestamp);
          return `
            <div class="recent-app-row draft-row" data-service-id="${s.id}" style="cursor: pointer;">
              <div class="recent-app-icon-wrap" style="background: #F1F5F9;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="15" y1="11" x2="9" y2="17"></line>
                  <line x1="9" y1="11" x2="15" y2="17"></line>
                </svg>
              </div>
              <div class="recent-app-details">
                <h5>Complete your ${s.name}</h5>
                <p>Draft saved on ${dateStr.replace('Applied on ', '')}</p>
              </div>
              <div class="recent-app-status">
                <span class="status-badge-draft">Draft</span>
                <span class="chevron-right-arrow">></span>
              </div>
            </div>
          `;
        }).join('');
      }

      if (recentHtml) {
        recentAppsContainer.innerHTML = recentHtml;

        // Wire up click event for drafts to open the details form
        recentAppsContainer.querySelectorAll('.recent-app-row.draft-row').forEach(row => {
          const serviceId = row.getAttribute('data-service-id');
          row.addEventListener('click', () => {
            const drafts = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
            const draft = drafts[serviceId];
            if (draft && draft.service) {
              showServiceDetails(draft.service);
            }
          });
        });

        // Wire up delete buttons on application cards
        wireRemoveAppButtons(recentAppsContainer);
        wireAppClickHandlers(recentAppsContainer);
      } else {
        recentAppsContainer.innerHTML = `
          <div class="empty-state" style="text-align: center; padding: 24px; color: #64748B; width: 100%;">
            <div style="font-size: 24px; margin-bottom: 8px;"></div>
            <h5 style="margin-bottom: 4px; font-weight: 600; color: #1E293B; font-size: 13px;">No Recent Applications</h5>
            <p style="font-size: 11px; margin: 0; color: #64748B;">Start an application under services or ask AI Copilot.</p>
          </div>
        `;
      }
    }

    // ── Preload notification badge count ──
    let notifCount = 0;
    // 1. Each application = 1 notification
    if (applications && applications.length > 0) notifCount += applications.length;
    // 2. Each expiring doc = 1 notification
    if (docs && docs.length > 0) {
      const nowMs = Date.now();
      docs.forEach(doc => {
        if (doc.is_verified === 1) {
          const ed = typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : (doc.extracted_data || {});
          const expiryStr = ed.expiry || ed.validity_date || '';
          if (!expiryStr || expiryStr === 'Permanent') return;
          const parts = expiryStr.split('/');
          let expiryDate;
          if (parts.length === 3) expiryDate = new Date(parts[2], parts[1] - 1, parts[0]);
          else expiryDate = new Date(expiryStr);
          if (isNaN(expiryDate.getTime())) return;
          const daysLeft = Math.ceil((expiryDate - nowMs) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 30 && daysLeft > -90) notifCount++;
        }
      });
    }
    // 3. Eligible schemes = 1 notification (only if user has at least 1 verified document)
    const hasVerifiedDoc = docs && docs.some(d => d.is_verified === 1);
    if (hasVerifiedDoc && recommendations && recommendations.length > 0 && recommendations.filter(r => r.is_eligible).length > 0) notifCount++;
    // 4. Latest verified doc = 1 notification
    if (docs && docs.filter(d => d.is_verified === 1).length > 0) notifCount++;
    // Compare with last-seen count to show badge only for NEW notifications
    const lastSeenCount = parseInt(localStorage.getItem('oc_notif_seen_count') || '0', 10);
    const newCount = Math.max(0, notifCount - lastSeenCount);
    updateBellBadge(newCount);

  } catch (err) {
    console.error(err);
  }
}

async function loadDigitalTwinScreen() {
  try {
    const profile = await apiCall('/auth/profile');
    const docs = await apiCall('/documents');
    const recommendations = await apiCall('/services/recommendations/list');
    
    // Fetch user applications
    let applications = [];
    try {
      applications = deduplicateApps(await apiCall('/services/user-applications'));
    } catch (e) {
      console.warn('Failed to load user applications:', e.message);
    }

    // Only count the 6 core profile documents for citizen profile completeness
    const PROFILE_DOC_TYPES = ['aadhaar', 'pan', 'voter', 'driving', 'ration', 'passport'];
    const verifiedDocs = docs.filter(d => d.is_verified === 1 && PROFILE_DOC_TYPES.includes(d.document_type));
    const verifiedCount = verifiedDocs.length;
    const isFullyVerified = verifiedCount === 6;

    // Populate profile details  show real data as soon as it exists
    const twinDisplayName = profile.name || 'Citizen';
    document.getElementById('twin-summary-name').innerText = twinDisplayName;
    const twinAvatarInit = document.getElementById('twin-avatar-initial');
    if (twinAvatarInit) twinAvatarInit.textContent = twinDisplayName.charAt(0).toUpperCase();
    const twinLocation = document.getElementById('twin-summary-location');
    if (twinLocation) twinLocation.style.display = 'none';
    
    const badgeOcc = document.getElementById('twin-badge-occ');
    if (badgeOcc) badgeOcc.innerText = profile.occupation || 'Not set';
    
    const badgeAge = document.getElementById('twin-badge-age');
    if (badgeAge) {
      badgeAge.innerText = profile.dob ? `${calculateAge(profile.dob)} Years` : 'Age unknown';
    }
    
    const badgeGender = document.getElementById('twin-badge-gender');
    if (badgeGender) badgeGender.innerText = profile.gender || 'Not set';

    // Completeness calculation
    let filled = 0;
    const fields = ['name', 'dob', 'gender', 'occupation', 'income_amount', 'state', 'district', 'caste'];
    fields.forEach(f => {
      if (profile[f] !== null && profile[f] !== '' && profile[f] !== 0) filled++;
    });
    const pct = isFullyVerified ? Math.round((filled / fields.length) * 100) : Math.round((verifiedCount / 6) * 100);

    const sliderFill = document.getElementById('twin-slider-fill');
    if (sliderFill) sliderFill.style.width = `${pct}%`;

    const radialPct = document.getElementById('twin-radial-pct');
    if (radialPct) radialPct.innerText = `${pct}%`;

    // Update stats grid
    // 1. Documents count
    const valDocs = document.getElementById('twin-val-docs');
    if (valDocs) valDocs.innerText = verifiedCount;

    // 2. Schemes eligible count
    const hasAadhaar = docs.some(d => d.document_type === 'aadhaar' && d.is_verified === 1);
    const eligibleCount = hasAadhaar ? recommendations.filter(r => r.is_eligible).length : 0;
    const valSchemes = document.getElementById('twin-val-schemes');
    if (valSchemes) valSchemes.innerText = eligibleCount || '0';

    // 3. Applications in progress (pending status)
    const pendingApps = applications.filter(a => a.status === 'pending').length;
    const valApps = document.getElementById('twin-val-apps');
    if (valApps) valApps.innerText = pendingApps || '0';

    // 4. Approvals (approved status)
    const approvedApps = applications.filter(a => a.status === 'approved').length;
    const valApprovals = document.getElementById('twin-val-approvals');
    if (valApprovals) valApprovals.innerText = approvedApps || '0';

    // Populate History tab
    const historyList = document.getElementById('twin-history-list');
    if (historyList) {
      if (applications.length === 0) {
        historyList.innerHTML = '<div style="text-align:center;padding:30px 10px;color:#94A3B8;"><svg width="40" height="40" fill="none" stroke="#CBD5E1" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 10px;display:block"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p style="font-size:13px;font-weight:600;color:#64748B;">No application history</p><p style="font-size:11px;color:#94A3B8;margin-top:4px;">Your applications will appear here after you apply.</p></div>';
      } else {
        const sorted = [...applications].sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        let historyHtml = '';
        sorted.forEach(function(app) {
          var dateStr = app.created_at ? new Date(app.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
          var timeStr = app.created_at ? new Date(app.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
          var statusLabel = app.status === 'under_review' ? 'Under Review' : app.status === 'approved' ? 'Approved' : app.status === 'rejected' ? 'Rejected' : 'Applied';
          var statusColor = app.status === 'approved' ? '#16A34A' : app.status === 'rejected' ? '#DC2626' : app.status === 'under_review' ? '#D97706' : '#3B82F6';
          var statusBg = app.status === 'approved' ? '#F0FDF4' : app.status === 'rejected' ? '#FEF2F2' : app.status === 'under_review' ? '#FFFBEB' : '#EFF6FF';
          var iconColor = app.status === 'approved' ? '#08573c' : app.status === 'rejected' ? '#EF4444' : app.status === 'under_review' ? '#D97706' : '#3B82F6';
          var bgClass = app.status === 'approved' ? 'bg-green-light' : app.status === 'rejected' ? 'bg-red-light' : app.status === 'under_review' ? 'bg-orange-light' : 'bg-blue-light';

          historyHtml += '<div style="padding:14px;margin-bottom:10px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0;">';
          // Header row with icon and status
          historyHtml += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">';
          historyHtml += '<div class="recent-app-icon-wrap ' + bgClass + '" style="flex-shrink:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="' + iconColor + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg></div>';
          historyHtml += '<div style="flex:1;min-width:0;"><h5 style="font-size:13px;font-weight:700;color:#1E293B;margin:0;">' + escapeHTML(app.service_name || 'Service') + '</h5>';
          historyHtml += '<p style="font-size:10px;color:#94A3B8;margin:2px 0 0;">' + dateStr + ' at ' + timeStr + '</p></div>';
          historyHtml += '<span style="font-size:9px;font-weight:700;color:' + statusColor + ';background:' + statusBg + ';padding:4px 10px;border-radius:20px;text-transform:uppercase;white-space:nowrap;">' + statusLabel + '</span>';
          historyHtml += '</div>';
          // Details grid
          historyHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:10px;">';
          historyHtml += '<div><span style="color:#94A3B8;">Application ID</span><br><span style="font-weight:600;color:#1E293B;">' + escapeHTML(app.id || 'N/A') + '</span></div>';

          historyHtml += '<div><span style="color:#94A3B8;">Status</span><br><span style="font-weight:600;color:' + statusColor + ';">' + statusLabel + '</span></div>';
          historyHtml += '<div><span style="color:#94A3B8;">Submitted</span><br><span style="font-weight:600;color:#1E293B;">' + dateStr + '</span></div>';
          historyHtml += '</div>';
          // Rejection reason
          if (app.status === 'rejected' && app.officer_notes) {
            historyHtml += '<div style="margin-top:8px;padding:8px;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;font-size:10px;color:#DC2626;"><b>Rejection Reason:</b> ' + escapeHTML(app.officer_notes) + '</div>';
          }
          // Approved message
          if (app.status === 'approved') {
            historyHtml += '<div style="margin-top:8px;padding:8px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;font-size:10px;color:#16A34A;"><b>✓ Approved</b> — Certificate ready for collection.</div>';
          }
          historyHtml += '</div>';
        });
        historyList.innerHTML = historyHtml;
      }
    }

    // Tab switching for Overview / History
    const tabOverview = document.getElementById('tab-twin-overview');
    const tabHistory = document.getElementById('tab-twin-history');
    const contentOverview = document.getElementById('twin-overview-content');
    const contentHistory = document.getElementById('twin-history-content');
    if (tabOverview && tabHistory) {
      tabOverview.onclick = function() {
        tabOverview.classList.add('active');
        tabHistory.classList.remove('active');
        if (contentOverview) contentOverview.style.display = 'block';
        if (contentHistory) contentHistory.style.display = 'none';
      };
      tabHistory.onclick = function() {
        tabHistory.classList.add('active');
        tabOverview.classList.remove('active');
        if (contentHistory) contentHistory.style.display = 'block';
        if (contentOverview) contentOverview.style.display = 'none';
      };
    }

  } catch (err) {
    console.error('Failed to load Digital Twin data:', err);
  }
}

function calculateAge(dobStr) {
  if (!dobStr) return 18;
  const parts = dobStr.split('/');
  if (parts.length !== 3) {
    const parts2 = dobStr.split('-');
    if (parts2.length !== 3) return 18;
    const birthYear = parseInt(parts2[0]);
    if (birthYear > 1900) {
      const today = new Date();
      return today.getFullYear() - birthYear;
    }
    return 18;
  }
  const birthDay = parseInt(parts[0]);
  const birthMonth = parseInt(parts[1]) - 1;
  const birthYear = parseInt(parts[2]);
  
  const today = new Date();
  let age = today.getFullYear() - birthYear;
  const m = today.getMonth() - birthMonth;
  if (m < 0 || (m === 0 && today.getDate() < birthDay)) {
    age--;
  }
  return age;
}

// 7. Profile Form Setup (Sub-screen Edit)
function setupProfileForm() {
  // Open edit form screen and populate details
  const loadProfileEditForm = async () => {
    try {
      const profile = await apiCall('/auth/profile');
      
      // OCR-extracted fields  these are finalized from uploaded documents
      const ocrFields = ['prof-name', 'prof-dob', 'prof-gender', 'prof-caste', 'prof-state', 'prof-district'];
      
      document.getElementById('prof-name').value = profile.name || '';
      document.getElementById('prof-dob').value = profile.dob || '';
      document.getElementById('prof-gender').value = profile.gender || '';
      document.getElementById('prof-marital').value = profile.marital_status || '';
      document.getElementById('prof-blood').value = profile.blood_group || '';
      document.getElementById('prof-religion').value = profile.religion || '';
      document.getElementById('prof-father').value = profile.father_name || '';
      document.getElementById('prof-mother').value = profile.mother_name || '';
      document.getElementById('prof-occupation').value = profile.occupation || '';
      document.getElementById('prof-education').value = profile.education || '';
      document.getElementById('prof-income').value = profile.income_amount || 0;
      document.getElementById('prof-caste').value = profile.caste || '';
      document.getElementById('prof-farmer').checked = profile.is_farmer === 1;
      document.getElementById('prof-address').value = profile.address || '';
      document.getElementById('prof-state').value = profile.state || '';
      document.getElementById('prof-district').value = profile.district || '';
      document.getElementById('prof-city').value = profile.city || '';
      document.getElementById('prof-pincode').value = profile.pincode || '';
      document.getElementById('prof-phone').value = profile.phone || '';
      document.getElementById('prof-email').value = profile.email || '';

      // Lock OCR-sourced fields that have values  they are finalized from documents
      ocrFields.forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (!el) return;
        // Remove any old lock badges
        const oldBadge = el.parentElement?.querySelector('.ocr-lock-badge');
        if (oldBadge) oldBadge.remove();
        
        let propName = '';
        if (fieldId === 'prof-name') propName = 'name';
        else if (fieldId === 'prof-dob') propName = 'dob';
        else if (fieldId === 'prof-gender') propName = 'gender';
        else if (fieldId === 'prof-caste') propName = 'caste';
        else if (fieldId === 'prof-state') propName = 'state';
        else if (fieldId === 'prof-district') propName = 'district';
        
        const profileValue = profile[propName];
        
        if (profileValue && profileValue.trim() !== '' && profileValue !== '0') {
          el.disabled = true;
          el.style.opacity = '0.85';
          el.style.backgroundColor = '#F1F5F9';
          el.style.cursor = 'not-allowed';
          // Add a small lock badge
          const badge = document.createElement('span');
          badge.className = 'ocr-lock-badge';
          badge.innerHTML = ' From document';
          badge.style.cssText = 'display:block; font-size:9px; color:#046A38; font-weight:700; margin-top:2px; letter-spacing:0.3px;';
          el.parentElement?.appendChild(badge);
        } else {
          el.disabled = false;
          el.style.opacity = '1';
          el.style.backgroundColor = '';
          el.style.cursor = '';
        }
      });
    } catch (e) {
      console.error(e);
    }
  };

  document.getElementById('btn-personal-info')?.addEventListener('click', loadProfileEditForm);
  document.getElementById('btn-digital-twin-edit')?.addEventListener('click', loadProfileEditForm);

  // Handle save from top right save icon or bottom update button
  const saveProfileData = async (e) => {
    if (e) e.preventDefault();
    const data = {
      name: document.getElementById('prof-name').value,
      dob: document.getElementById('prof-dob').value,
      gender: document.getElementById('prof-gender').value,
      marital_status: document.getElementById('prof-marital').value,
      blood_group: document.getElementById('prof-blood').value,
      religion: document.getElementById('prof-religion').value,
      father_name: document.getElementById('prof-father').value,
      mother_name: document.getElementById('prof-mother').value,
      occupation: document.getElementById('prof-occupation').value,
      education: document.getElementById('prof-education').value,
      income_amount: document.getElementById('prof-income').value,
      caste: document.getElementById('prof-caste').value,
      is_farmer: document.getElementById('prof-farmer').checked,
      address: document.getElementById('prof-address').value,
      state: document.getElementById('prof-state').value,
      district: document.getElementById('prof-district').value,
      city: document.getElementById('prof-city').value,
      pincode: document.getElementById('prof-pincode').value,
      phone: document.getElementById('prof-phone').value,
      email: document.getElementById('prof-email').value
    };

    try {
      await apiCall('/auth/profile', 'PUT', data);
      showToast('Profile parameters updated successfully');
      switchScreen('screen-profile');
      if (currentRole === 'admin') loadAdminDashboard();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  };

  document.getElementById('profile-form-new')?.addEventListener('submit', saveProfileData);
  document.getElementById('profile-edit-save')?.addEventListener('click', saveProfileData);
}

function getDocumentTitle(type) {
  const mapping = {
    aadhaar: 'Aadhaar Card',
    pan: 'PAN Card',
    income: 'Income Certificate',
    caste: 'Caste Certificate',
    residence: 'Residence Certificate',
    ration: 'Ration Card',
    degree: 'Degree Certificate',
    birth: 'Birth Certificate',
    passport: 'Passport',
    passport_size_photo: 'Passport Size Photo',
    driving_license: 'Driving License',
    driving: 'Driving License',
    voter: 'Voter ID Card'
  };
  return mapping[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// 8. Document Vault Renders (Compact Vertical List)
async function loadVaultItems() {
  const container = document.getElementById('vault-items-container');
  const appliedContainer = document.getElementById('vault-applied-container');
  const uploadedCountEl = document.getElementById('vault-uploaded-count');
  const appliedCountEl = document.getElementById('vault-applied-count');

  // Show skeleton loading placeholders instantly (feels faster than a spinner)
  const skeletonCard = `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:white;border-radius:12px;border:1px solid #F1F5F9;">
    <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;flex-shrink:0;"></div>
    <div style="flex:1;"><div style="width:70%;height:12px;border-radius:4px;background:linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;margin-bottom:6px;"></div>
    <div style="width:40%;height:8px;border-radius:4px;background:linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div></div>
    <div style="width:50px;height:20px;border-radius:8px;background:linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div></div>`;
  container.innerHTML = skeletonCard + skeletonCard + skeletonCard;
  if (appliedContainer) appliedContainer.innerHTML = skeletonCard + skeletonCard;

  // Document type icons (small SVGs)
  const docIcons = {
    aadhaar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M13 10h4M13 14h4M7 16h10"/></svg>',
    pan: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="6" y="8" width="4" height="3" rx="1"/><path d="M13 9h4M13 13h4M6 16h12"/></svg>',
    income: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#046A38" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>',
    caste: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6M9 15l3-3 3 3"/></svg>',
    residence: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0891B2" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    ration: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
    birth: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EC4899" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
    passport: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 18h8"/></svg>',
    voter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="9 12 11 14 15 10"/></svg>',
    driving: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h3M14 14h3"/></svg>',
    degree: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6D28D9" stroke-width="2"><path d="M22 10l-10-6L2 10l10 6 10-6z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
    passport_size_photo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 18c0-2 2-3 4-3s4 1 4 3"/></svg>'
  };
  const defaultIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  const iconBgColors = {
    aadhaar: '#FFF7ED', pan: '#EFF6FF', income: '#F0FDF4', caste: '#F5F3FF',
    residence: '#ECFEFF', ration: '#FFFBEB', birth: '#FDF2F8', passport: '#F0F4FF',
    voter: '#ECFDF5', driving: '#FFFBEB', degree: '#F5F3FF', passport_size_photo: '#F8FAFC'
  };

  try {
    const docs = await apiCall('/documents');
    container.innerHTML = '';
    if (uploadedCountEl) uploadedCountEl.textContent = docs.length;

    if (docs.length === 0) {
      container.innerHTML = '<p style="text-align:center;padding:16px 0;color:#94A3B8;font-size:12px;">No documents uploaded yet.</p>';
    } else {
      docs.forEach(doc => {
        const isOk = doc.is_verified === 1;
        const icon = docIcons[doc.document_type] || defaultIcon;
        const bgColor = iconBgColors[doc.document_type] || '#F8FAFC';
        const dateStr = doc.uploaded_at ? new Date(doc.uploaded_at + (doc.uploaded_at.includes('Z') ? '' : 'Z')).toLocaleDateString('en-IN', {day:'numeric',month:'short'}) : '';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;background:white;border-radius:12px;border:1px solid #F1F5F9;cursor:pointer;transition:all 0.2s;';
        row.innerHTML = `
          <div style="width:36px;height:36px;border-radius:10px;background:${bgColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${icon}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${getDocumentTitle(doc.document_type)}</div>
            <div style="font-size:9px;color:#94A3B8;margin-top:1px;">${dateStr}</div>
          </div>
          <span style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:8px;font-size:9px;font-weight:700;${isOk ? 'background:rgba(4,106,56,0.08);color:#046A38;' : 'background:rgba(239,68,68,0.08);color:#DC2626;'}">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">${isOk ? '<polyline points="20 6 9 17 4 12"/>' : '<circle cx="12" cy="12" r="10"/>'}</svg>
            ${isOk ? 'Verified' : 'Pending'}
          </span>
          <div class="vc-view-btn" data-filepath="${doc.file_path || ''}" style="width:28px;height:28px;border-radius:8px;background:#F1F5F9;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#046A38" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <div class="vc-delete-btn" data-docid="${doc.id}" style="width:28px;height:28px;border-radius:8px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </div>
        `;

        // View handler
        row.querySelector('.vc-view-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const fp = e.currentTarget.getAttribute('data-filepath');
          if (!fp) { showToast('No file available to view', 'warning'); return; }
          const fileUrl = '/uploads/' + fp;
          const ext = fp.split('.').pop().toLowerCase();
          let previewHtml = '';
          if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
            previewHtml = `<div style="text-align:center;padding:8px 0;"><img src="${fileUrl}" style="max-width:100%;max-height:60vh;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.15);" alt="Document Preview"/></div>`;
          } else if (ext === 'pdf') {
            previewHtml = `<div style="padding:8px 0;"><iframe src="${fileUrl}" style="width:100%;height:60vh;border:none;border-radius:8px;"></iframe></div>`;
          } else {
            previewHtml = `<div style="text-align:center;padding:20px;"><a href="${fileUrl}" target="_blank" style="color:#1E40AF;font-weight:700;font-size:14px;">Download Document</a></div>`;
          }
          previewHtml += `<button class="btn btn-primary" onclick="closeBottomSheet()" style="width:100%;margin-top:10px;font-weight:700;background:#046A38 !important;border:none !important;">Close</button>`;
          openBottomSheet(getDocumentTitle(doc.document_type), previewHtml);
        });

        // Delete handler
        row.querySelector('.vc-delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const docId = e.currentTarget.getAttribute('data-docid');
          const docTitle = getDocumentTitle(doc.document_type);
          const confirmHtml = `
            <div style="text-align:center;padding:8px 0;">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.5" style="margin-bottom:10px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              <p style="font-size:14px;font-weight:700;color:#1E293B;margin:0 0 6px;">Delete ${docTitle}?</p>
              <p style="font-size:12px;color:#64748B;margin:0 0 16px;">This action cannot be undone.</p>
              <div style="display:flex;gap:10px;">
                <button onclick="closeBottomSheet()" style="flex:1;padding:12px;border:none;border-radius:8px;background:#E2E8F0;color:#1E293B;font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>
                <button id="btn-confirm-delete" style="flex:1;padding:12px;border:none;border-radius:8px;background:#EF4444;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">Delete</button>
              </div>
            </div>`;
          openBottomSheet('Delete Document', confirmHtml);
          document.getElementById('btn-confirm-delete').addEventListener('click', () => { closeBottomSheet(); deleteDoc(docId); });
        });

        // Click card for OCR details
        row.addEventListener('click', () => { showOCRDetailsSheet(doc); });

        container.appendChild(row);
      });
    }

    // ── Section 2: Applied Services ──
    if (appliedContainer) {
      try {
        const apps = deduplicateApps(await apiCall('/services/user-applications'));
        appliedContainer.innerHTML = '';
        if (appliedCountEl) appliedCountEl.textContent = apps.length;

        if (apps.length === 0) {
          appliedContainer.innerHTML = '<p style="text-align:center;padding:16px 0;color:#94A3B8;font-size:12px;">No applications yet.</p>';
        } else {
          const statusConfig = {
            applied: { color: '#3B82F6', bg: '#EFF6FF', label: 'Applied', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
            under_review: { color: '#D97706', bg: '#FFFBEB', label: 'Under Review', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
            approved: { color: '#046A38', bg: '#F0FDF4', label: 'Approved', icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
            rejected: { color: '#DC2626', bg: '#FEF2F2', label: 'Rejected', icon: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' }
          };
          apps.forEach(app => {
            const cfg = statusConfig[app.status] || statusConfig.applied;
            const dateStr = app.created_at ? new Date(app.created_at + (app.created_at.includes('Z') ? '' : 'Z')).toLocaleDateString('en-IN', {day:'numeric',month:'short'}) : '';
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;background:white;border-radius:12px;border:1px solid #F1F5F9;cursor:pointer;transition:transform 0.1s ease;';
            row.innerHTML = `
              <div style="width:36px;height:36px;border-radius:10px;background:${cfg.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${cfg.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${cfg.icon}</svg>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${app.service_name || 'Application'}</div>
                <div style="font-size:9px;color:#94A3B8;margin-top:1px;">${app.id || ''} • ${dateStr}</div>
              </div>
              <span style="padding:3px 8px;border-radius:8px;font-size:9px;font-weight:700;background:${cfg.bg};color:${cfg.color};">${cfg.label}</span>
            `;
            // Click to show receipt
            row.addEventListener('click', () => {
              showExistingAppReceipt(app);
            });
            appliedContainer.appendChild(row);
          });
        }
      } catch(e) {
        appliedContainer.innerHTML = '<p style="text-align:center;padding:16px 0;color:#94A3B8;font-size:12px;">No applications yet.</p>';
        if (appliedCountEl) appliedCountEl.textContent = '0';
      }
    }

  } catch (err) {
    container.innerHTML = '<p style="text-align:center;color:red;font-size:12px;">Failed to load vault items.</p>';
  }
}

async function deleteDoc(id) {
  try {
    await apiCall(`/documents/${id}`, 'DELETE');
    loadVaultItems();
    loadAdminDashboard();
    showToast('Document removed successfully');
  } catch (err) {
    showToast('Delete failed: ' + err.message);
  }
}

function setupVaultUploader() {
  const fileInput = document.getElementById('file-uploader');
  const triggerBtn = document.getElementById('btn-trigger-upload');
  
  // Tab Switching Logic
  const tabScans = document.getElementById('tab-scans');
  const tabDigilocker = document.getElementById('tab-digilocker');
  const contentScans = document.getElementById('vault-content-scans');
  const contentDigilocker = document.getElementById('vault-content-digilocker');

  if (tabScans && tabDigilocker) {
    tabScans.addEventListener('click', () => {
      tabScans.classList.add('active');
      tabDigilocker.classList.remove('active');
      contentScans.classList.add('active');
      contentDigilocker.classList.remove('active');
    });

    tabDigilocker.addEventListener('click', () => {
      tabDigilocker.classList.add('active');
      tabScans.classList.remove('active');
      contentDigilocker.classList.add('active');
      contentScans.classList.remove('active');
    });
  }

  // Local Scans file picker
  triggerBtn?.addEventListener('click', async () => {
    // Fetch existing documents to filter out already-uploaded types
    const docs = await apiCall('/documents');
    const uploadedTypes = docs.map(d => d.document_type);
    const allTypes = [
      {value: 'aadhaar', label: 'Aadhaar Card'},
      {value: 'pan', label: 'PAN Card'},
      {value: 'income', label: 'Income Certificate'},
      {value: 'caste', label: 'Caste Certificate'},
      {value: 'residence', label: 'Residence Certificate'},
      {value: 'ration', label: 'Ration Card'},
      {value: 'driving_license', label: 'Driving License'},
      {value: 'voter', label: 'Voter ID Card'}
    ];
    const availableTypes = allTypes.filter(t => !uploadedTypes.includes(t.value));

    if (availableTypes.length === 0) {
      showToast('All document types have been uploaded');
      return;
    }

    // Open a bottom sheet to select document type first
    const title = "Upload New Document";
    const optionsHtml = availableTypes.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
    const html = `
      <div style="padding: 10px 0;">
        <div class="form-group" style="margin-bottom: 20px;">
          <label style="font-size: 10px; font-weight: 700; color: var(--primary-navy); text-transform: uppercase;">Doc Type to Upload:</label>
          <select id="sheet-initial-doc-type" class="upload-select" style="width: 100%; height: 35px; border-radius: 8px; border: 1px solid var(--border-color); padding: 0 10px; margin-top: 5px; font-size: 12px; font-weight: 600;">
            ${optionsHtml}
          </select>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-primary" id="btn-upload-files" style="flex: 1; font-weight: 700; font-size: 12px; padding: 12px 0; background: #046A38 !important; border: none !important; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
            Upload from Files
          </button>
          <button class="btn btn-primary" id="btn-upload-camera" style="flex: 1; font-weight: 700; font-size: 12px; padding: 12px 0; background: #0F294A !important; border: none !important; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            Take Photo
          </button>
        </div>
      </div>
    `;
    
    openBottomSheet(title, html);

    document.getElementById('btn-upload-files').addEventListener('click', () => {
      window.pendingUploadDocType = document.getElementById('sheet-initial-doc-type').value;
      fileInput.click();
    });
    document.getElementById('btn-upload-camera').addEventListener('click', () => {
      window.pendingUploadDocType = document.getElementById('sheet-initial-doc-type').value;
      closeBottomSheet();
      openCameraCapture(fileInput);
    });
  });

  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length === 0) return;
    
    const file = fileInput.files[0];
    const docType = window.pendingUploadDocType || 'aadhaar';
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

    const title = "Confirm Document Upload";
    const html = `
      <div style="padding: 10px 0;">
        <p style="font-size: 12px; color: #64748B; margin-bottom: 12px; line-height: 1.4;">
          <b>File Selected:</b> ${escapeHTML(file.name)} (${sizeMB} MB)
        </p>
        <p style="font-size: 11px; color: #1e293b; margin-bottom: 15px;">
          <b>Type:</b> ${getDocumentTitle(docType).toUpperCase()}
        </p>
        <p style="font-size: 10px; color: #D97706; font-weight: 700; margin-bottom: 15px;">
          Pending Upload
        </p>
        <div style="display: flex; gap: 12px;">
          <button class="btn btn-primary" id="btn-confirm-upload-yes" style="flex: 1; font-weight: 700; font-size: 12px; padding: 10px; background: #046A38 !important; border: none !important;">Upload &amp; Scan</button>
          <button class="btn btn-accent" id="btn-confirm-upload-no" style="flex: 1; font-weight: 700; font-size: 12px; padding: 10px; background: #E2E8F0 !important; color: #1E293B !important; box-shadow: none !important;">Cancel</button>
        </div>
      </div>
    `;

    openBottomSheet(title, html);

    document.getElementById('btn-confirm-upload-no').addEventListener('click', () => {
      closeBottomSheet();
      fileInput.value = '';
    });

    document.getElementById('btn-confirm-upload-yes').addEventListener('click', async () => {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('document_type', docType);

      const btnConfirm = document.getElementById('btn-confirm-upload-yes');
      btnConfirm.disabled = true;
      btnConfirm.innerText = 'Scanning...';

      try {
        const res = await apiCall('/documents/upload', 'POST', formData, true);
        closeBottomSheet();
        loadVaultItems();
        loadAdminDashboard();
        if (res.warnings && res.warnings.length > 0) {
          // Show a warning sheet before OCR details
          const warnHtml = `
            <div style="padding: 8px 0;">
              <div style="text-align: center; margin-bottom: 12px;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 6px;">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <p style="font-size: 13px; color: #92400E; font-weight: 700; margin: 0 0 8px; text-align: center;">Document Accepted with Warning</p>
              ${res.warnings.map(w => `
                <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;">
                  <p style="font-size: 11px; color: #78350F; margin: 0; line-height: 1.5;">⚠️ ${escapeHTML(w)}</p>
                </div>
              `).join('')}
              <button class="btn btn-primary" onclick="closeBottomSheet()" style="width: 100%; margin-top: 10px; font-weight: 700; background: #046A38 !important; border: none !important;">OK, Continue</button>
            </div>
          `;
          openBottomSheet('⚠️ Warning', warnHtml);
          // Show OCR details after they close warning
        } else {
          showToast('Document uploaded successfully!');
          showOCRDetailsSheet(res.document);
        }
      } catch (err) {
        closeBottomSheet();
        if (err.typeMismatch) {
          const tm = err.typeMismatch;
          const typeErrHtml = `
            <div style="padding:8px 0; overflow:hidden;">
              <div style="text-align:center; margin-bottom:14px;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div style="background:#FEF2F2; border-radius:8px; padding:12px; margin-bottom:12px;">
                <p style="font-size:12px; color:#991B1B; font-weight:700; margin:0 0 8px; text-align:center;">Document Type Mismatch</p>
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                  <span style="font-size:10px; color:#64748B; font-weight:600; min-width:65px;">Selected:</span>
                  <span style="font-size:12px; color:#1E293B; font-weight:700;">${tm.selected}</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:10px; color:#64748B; font-weight:600; min-width:65px;">Uploaded:</span>
                  <span style="font-size:12px; color:#DC2626; font-weight:700;">${tm.detected}</span>
                </div>
              </div>
              <p style="font-size:11px; color:#64748B; text-align:center; margin:0 0 14px;">Please upload the correct document or change your selection.</p>
              <div style="display: flex; gap: 10px;">
                <button id="btn-type-retry" style="flex: 1; padding: 12px; border: none; border-radius: 8px; background: #046A38; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  Re-upload
                </button>
                <button onclick="closeBottomSheet()" style="flex: 1; padding: 12px; border: none; border-radius: 8px; background: #E2E8F0; color: #1E293B; font-size: 12px; font-weight: 700; cursor: pointer;">OK, Got it</button>
              </div>
            </div>
          `;
          openBottomSheet('Upload Rejected', typeErrHtml);
          document.getElementById('btn-type-retry')?.addEventListener('click', () => {
            closeBottomSheet();
            fileInput.value = '';
            setTimeout(() => triggerBtn.click(), 200);
          });
        } else if (err.mismatches) {
          let rows = err.mismatches.map(m => `
            <div style="background:#FEF2F2; border-radius:6px; padding:10px 12px; margin-bottom:8px;">
              <p style="font-size:11px; color:#991B1B; font-weight:700; margin:0 0 4px;">${m.field} Mismatch</p>
              <p style="font-size:11px; color:#1E293B; margin:0;">Uploaded: <b>${m.newValue || '-'}</b></p>
              <p style="font-size:11px; color:#64748B; margin:2px 0 0;">Expected (from ${getDocumentTitle(m.existingDocType)}): <b>${m.existingValue || '-'}</b></p>
            </div>
          `).join('');
          const errHtml = `
            <div style="padding:8px 0; overflow:hidden;">
              <p style="font-size:13px; color:#DC2626; font-weight:700; margin:0 0 12px;">Upload rejected — details do not match</p>
              ${rows}
              <div style="display: flex; gap: 10px; margin-top: 14px;">
                <button id="btn-err-retry" style="flex: 1; padding: 12px; border: none; border-radius: 8px; background: #046A38; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  Re-upload
                </button>
                <button onclick="closeBottomSheet()" style="flex: 1; padding: 12px; border: none; border-radius: 8px; background: #E2E8F0; color: #1E293B; font-size: 12px; font-weight: 700; cursor: pointer;">OK, Got it</button>
              </div>
            </div>
          `;
          openBottomSheet('Document Mismatch', errHtml);
          document.getElementById('btn-err-retry')?.addEventListener('click', () => {
            closeBottomSheet();
            fileInput.value = '';
            setTimeout(() => triggerBtn.click(), 200);
          });
        } else {
          const errMsg = err.message || 'Upload failed. Please try again.';
          const failHtml = `
            <div style="padding:8px 0;">
              <div style="text-align: center; margin-bottom: 14px;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <p style="font-size: 13px; color: #991B1B; font-weight: 700; margin: 0;">${escapeHTML(errMsg)}</p>
              </div>
              <div style="display: flex; gap: 10px;">
                <button id="btn-fail-retry" style="flex: 1; padding: 12px; border: none; border-radius: 8px; background: #046A38; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  Try Again
                </button>
                <button onclick="closeBottomSheet()" style="flex: 1; padding: 12px; border: none; border-radius: 8px; background: #E2E8F0; color: #1E293B; font-size: 12px; font-weight: 700; cursor: pointer;">Cancel</button>
              </div>
            </div>
          `;
          openBottomSheet('Upload Failed', failHtml);
          document.getElementById('btn-fail-retry')?.addEventListener('click', () => {
            closeBottomSheet();
            fileInput.value = '';
            setTimeout(() => triggerBtn.click(), 200);
          });
        }
      } finally {
        fileInput.value = '';
      }
    });
  });

  // DigiLocker Connect Button
  const connectDigiBtn = document.getElementById('btn-connect-digilocker');
  if (connectDigiBtn) {
    connectDigiBtn.addEventListener('click', () => {
      // Show "Feature coming soon" toast popup
      const toast = document.createElement('div');
      toast.className = 'digilocker-toast';
      toast.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; flex-shrink:0;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>Feature coming soon</span>
      `;
      document.body.appendChild(toast);
      // Trigger animation
      requestAnimationFrame(() => {
        toast.classList.add('show');
      });
      // Auto remove after 2.5s
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    });
  }
}

function showOCRDetailsSheet(doc) {
  const title = `OCR Scan: ${getDocumentTitle(doc.document_type)}`;
  
  let extData = doc.extracted_data;
  if (typeof extData === 'string') {
    try { extData = JSON.parse(extData); } catch (e) {}
  }
  if (!extData && doc.validation_status && doc.validation_status.extracted_data) {
    extData = doc.validation_status.extracted_data;
    if (typeof extData === 'string') {
      try { extData = JSON.parse(extData); } catch (e) {}
    }
  }
  if (!extData) {
    extData = doc;
  }

  const isOk = doc.is_verified === 1;
  const issues = doc.validation_status?.issues || [];

  const uploadPath = doc.file_path || doc.validation_status?.file_path;

  // Build document-specific fields table
  let html = `
    <table class="admin-table" style="width:100%">
      <tr><th>Parameter</th><th>Extracted Value</th></tr>
      <tr><td>Name</td><td>${extData.name || extData.extracted_name || '-'}</td></tr>
  `;

  // Document-type-specific fields
  if (doc.document_type === 'aadhaar') {
    html += `<tr><td>Father's Name</td><td>${extData.father_name || '-'}</td></tr>`;
    html += `<tr><td>DOB</td><td>${extData.dob || extData.extracted_dob || '-'}</td></tr>`;
    html += `<tr><td>Gender</td><td>${extData.gender || '-'}</td></tr>`;
    html += `<tr><td>Aadhaar Number</td><td>${extData.id_number || extData.extracted_id_number || '-'}</td></tr>`;
    if (extData.address || doc.address) html += `<tr><td>Address</td><td style="font-size:11px;line-height:1.4;">${extData.address || doc.address}</td></tr>`;
  } else if (doc.document_type === 'pan') {
    html += `<tr><td>Father's Name</td><td>${extData.father_name || '-'}</td></tr>`;
    html += `<tr><td>DOB</td><td>${extData.dob || '-'}</td></tr>`;
    html += `<tr><td>PAN Number</td><td>${extData.id_number || extData.extracted_id_number || '-'}</td></tr>`;
  } else if (doc.document_type === 'income') {
    html += `<tr><td>Father's Name</td><td>${extData.father_name || '-'}</td></tr>`;
    html += `<tr><td>Application No.</td><td>${extData.id_number || extData.application_number || '-'}</td></tr>`;
    html += `<tr><td>Annual Income</td><td>${extData.income_amount ? '₹' + Number(extData.income_amount).toLocaleString('en-IN') : (extData.annual_income ? '₹' + Number(extData.annual_income).toLocaleString('en-IN') : '-')}</td></tr>`;
    if (extData.caste) html += `<tr><td>Caste</td><td>${extData.caste}</td></tr>`;
    if (extData.address) html += `<tr><td>Address</td><td style="font-size:11px;line-height:1.4;">${extData.address}</td></tr>`;
  } else if (doc.document_type === 'caste') {
    html += `<tr><td>Father's Name</td><td>${extData.father_name || '-'}</td></tr>`;
    html += `<tr><td>Certificate No.</td><td>${extData.id_number || extData.application_number || '-'}</td></tr>`;
    html += `<tr><td>Caste</td><td>${extData.caste || extData.caste_name || '-'}</td></tr>`;
    if (extData.address) html += `<tr><td>Address</td><td style="font-size:11px;line-height:1.4;">${extData.address}</td></tr>`;
  } else if (doc.document_type === 'residence') {
    html += `<tr><td>Father's Name</td><td>${extData.father_name || '-'}</td></tr>`;
    html += `<tr><td>Application No.</td><td>${extData.id_number || extData.application_number || '-'}</td></tr>`;
    html += `<tr><td>Address</td><td style="font-size:11px;line-height:1.4;">${extData.address || '-'}</td></tr>`;
  } else if (doc.document_type === 'birth') {
    html += `<tr><td>DOB</td><td>${extData.dob || '-'}</td></tr>`;
    html += `<tr><td>Father's Name</td><td>${extData.father_name || '-'}</td></tr>`;
    html += `<tr><td>Place of Birth</td><td>${extData.place_of_birth || extData.address || '-'}</td></tr>`;
    html += `<tr><td>Registration No.</td><td>${extData.id_number || '-'}</td></tr>`;
  } else if (doc.document_type === 'driving' || doc.document_type === 'driving_license') {
    html += `<tr><td>DOB</td><td>${extData.dob || '-'}</td></tr>`;
    html += `<tr><td>License Number</td><td>${extData.id_number || '-'}</td></tr>`;
    html += `<tr><td>Expiry Date</td><td>${extData.expiry || '-'}</td></tr>`;
  } else if (doc.document_type === 'voter') {
    html += `<tr><td>Father's Name</td><td>${extData.father_name || '-'}</td></tr>`;
    html += `<tr><td>DOB</td><td>${extData.dob || '-'}</td></tr>`;
    html += `<tr><td>Voter ID</td><td>${extData.id_number || '-'}</td></tr>`;
    if (extData.address) html += `<tr><td>Address</td><td style="font-size:11px;line-height:1.4;">${extData.address}</td></tr>`;
  } else if (doc.document_type === 'passport') {
    html += `<tr><td>DOB</td><td>${extData.dob || '-'}</td></tr>`;
    html += `<tr><td>Passport Number</td><td>${extData.id_number || '-'}</td></tr>`;
    html += `<tr><td>Expiry Date</td><td>${extData.expiry || '-'}</td></tr>`;
  } else if (doc.document_type === 'ration') {
    html += `<tr><td>Ration Card No.</td><td>${extData.id_number || '-'}</td></tr>`;
    if (extData.address) html += `<tr><td>Address</td><td style="font-size:11px;line-height:1.4;">${extData.address}</td></tr>`;
  } else {
    if (extData.dob) html += `<tr><td>DOB</td><td>${extData.dob || '-'}</td></tr>`;
    if (extData.id_number) html += `<tr><td>ID Number</td><td>${extData.id_number || '-'}</td></tr>`;
    if (extData.father_name) html += `<tr><td>Father's Name</td><td>${extData.father_name}</td></tr>`;
    if (extData.address) html += `<tr><td>Address</td><td style="font-size:11px;line-height:1.4;">${extData.address}</td></tr>`;
  }

  html += `</table>`;

  // Check expiry/validity date
  const expiryStr = extData.validity_date || extData.expiry || doc.expires_at;
  let isExpired = false;
  if (expiryStr && expiryStr !== 'Permanent') {
    const parts = expiryStr.split('/');
    let expiryDate;
    if (parts.length === 3) {
      expiryDate = new Date(parts[2], parts[1] - 1, parts[0]);
    } else {
      expiryDate = new Date(expiryStr);
    }
    if (!isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
      isExpired = true;
    }
  }

  if (isExpired) {
    const renewableCerts = ['income', 'caste', 'residence'];
    const isRenewable = renewableCerts.includes(doc.document_type);
    html += `
      <div style="margin-top:14px; background:#FEF2F2; border:1px solid #FECACA; border-radius:10px; padding:14px;">
        <p style="font-size:13px; color:#DC2626; font-weight:700; margin:0 0 6px;">Document Expired</p>
        <p style="font-size:11px; color:#991B1B; margin:0 0 10px;">This document's validity has expired on ${expiryStr}. ${isRenewable ? 'You can apply for a new one.' : 'Please visit the concerned authority to renew.'}</p>
        ${isRenewable 
          ? `<button class="btn btn-primary" id="btn-apply-new-doc" style="width:100%; font-weight:700; font-size:12px; padding:10px; background:#DC2626 !important; border:none !important;">Apply for New ${getDocumentTitle(doc.document_type)}</button>`
          : `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#FFF7ED;border-radius:8px;border:1px solid #FED7AA;"><span style="font-size:16px;">🔔</span><span style="font-size:11px;color:#9A3412;font-weight:600;">Renewal reminder has been set. You'll be notified periodically.</span></div>`
        }
      </div>
    `;
  }

  // Document scan preview section  placed below details
  html += `
    <div style="margin-top: 18px; border-top: 1px solid #E2E8F0; padding-top: 14px;">
      <button class="btn-sm" id="btn-toggle-scan-preview" style="background: #0F294A; color: white; border-radius: 6px; padding: 8px 14px; font-size: 11px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; box-shadow: 0 1px 4px rgba(0,0,0,0.15); width: 100%; justify-content: center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        Show Uploaded Document
      </button>
      <div id="scan-preview-container" style="display: none; margin-top: 12px; border-radius: 8px; overflow: hidden; border: 1px solid #CBD5E1; background: #F8FAFC; text-align: center;">
        ${uploadPath ? (
          uploadPath.toLowerCase().endsWith('.pdf') 
            ? `<iframe src="${window.location.origin}/uploads/${uploadPath}" style="width: 100%; height: 220px; border: none;"></iframe>` 
            : `<img src="${window.location.origin}/uploads/${uploadPath}" style="max-width: 100%; max-height: 240px; object-fit: contain; padding: 8px;" />`
        ) : `<p style="padding: 20px; font-size: 12px; color: #64748b;">No document file available.</p>`}
      </div>
    </div>
  `;

  if (!isOk) {
    html += `
      <div style="margin-top: 20px;">
        <button class="btn btn-primary" id="btn-verify-doc-now" style="width: 100%; font-weight: 700; background: #046A38 !important; border: none !important;">Confirm &amp; Verify Document</button>
      </div>
    `;
  }

  openBottomSheet(title, html);

  // Wire up expired document apply button
  const btnApplyNew = document.getElementById('btn-apply-new-doc');
  if (btnApplyNew) {
    btnApplyNew.addEventListener('click', () => {
      closeBottomSheet();
      switchScreen('screen-services');
      showToast('Select the service to apply for a new document');
    });
  }

  // Setup preview toggle click listener
  const btnToggle = document.getElementById('btn-toggle-scan-preview');
  const previewContainer = document.getElementById('scan-preview-container');
  if (btnToggle && previewContainer) {
    btnToggle.addEventListener('click', () => {
      if (previewContainer.style.display === 'none') {
        previewContainer.style.display = 'block';
        btnToggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:3px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Hide scan preview`;
      } else {
        previewContainer.style.display = 'none';
        btnToggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:3px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> Show document scan`;
      }
    });
  }

    // Full-screen image viewer on click
    const previewImg = previewContainer?.querySelector('img');
    if (previewImg) {
      previewImg.style.cursor = 'pointer';
      previewImg.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.className = 'fullscreen-doc-viewer';
        overlay.innerHTML = `
          <div class="fullscreen-doc-header">
            <span class="fullscreen-doc-back">&#8592;</span>
            <span>Document View</span>
          </div>
          <div class="fullscreen-doc-body">
            <img src="${previewImg.src}" alt="Document" />
          </div>
        `;
        document.querySelector('.phone-screen').appendChild(overlay);
        overlay.querySelector('.fullscreen-doc-back').addEventListener('click', () => {
          overlay.remove();
        });
      });
    }

  if (!isOk) {
    setTimeout(() => {
      const btnVerify = document.getElementById('btn-verify-doc-now');
      if (btnVerify) {
        btnVerify.addEventListener('click', async () => {
          btnVerify.disabled = true;
          btnVerify.innerText = 'Verifying...';
          try {
            await apiCall(`/documents/${doc.id}/verify`, 'PUT');
            showToast('Document verified successfully!');
            closeBottomSheet();
            loadVaultItems();
            loadDashboardData();
          } catch (err) {
            alert(`Verification failed: ${err.message}`);
            btnVerify.disabled = false;
            btnVerify.innerText = 'Confirm & Verify Document';
          }
        });
      }
    }, 100);
  }
}

// 9. Services Catalog & Recommendations Renders
let allServices = [];
let activeServiceCategory = 'all';

function getServiceIconClass(name) {
  const n = name.toLowerCase();
  if (n.includes('income')) return 'icon-blue';
  if (n.includes('caste')) return 'icon-orange';
  if (n.includes('residence') || n.includes('domicile')) return 'icon-purple';
  if (n.includes('birth')) return 'icon-blue';
  if (n.includes('death')) return 'icon-grey';
  if (n.includes('business') || n.includes('registration')) return 'icon-green';
  if (n.includes('pension')) return 'icon-orange';
  return 'icon-blue';
}

function getServiceIcon(name) {
  const n = name.toLowerCase();
  const docSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
  const buildingSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M3 7v1a3 3 0 0 0 6 0V7m0 0v1a3 3 0 0 0 6 0V7m0 0v1a3 3 0 0 0 6 0V7M4 21V10m16 11V10M12 21V10"></path></svg>`;
  const userSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
  
  if (n.includes('business') || n.includes('registration')) return buildingSvg;
  if (n.includes('pension')) return userSvg;
  return docSvg;
}

async function loadServicesCatalog() {
  const container = document.getElementById('services-items-container');
  if (!container) return;
  
  try {
    if (allServices.length === 0) {
      allServices = await apiCall('/services');
      setupServicesFilters();
    }
    renderServicesList();
  } catch (err) {
    container.innerHTML = '<p class="empty-state" style="text-align:center; color:red;">Failed to load services catalog.</p>';
  }
}

function setupServicesFilters() {
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach(chip => {
    if (chip.dataset.listenerAdded) return;
    chip.dataset.listenerAdded = 'true';
    
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeServiceCategory = chip.getAttribute('data-category');
      renderServicesList();
    });
  });

  const searchInput = document.getElementById('services-search');
  if (searchInput && !searchInput.dataset.listenerAdded) {
    searchInput.dataset.listenerAdded = 'true';
    searchInput.addEventListener('input', () => {
      renderServicesList();
    });
  }
}

async function renderServicesList() {
  const container = document.getElementById('services-items-container');
  if (!container) return;
  container.innerHTML = '';

  const searchInput = document.getElementById('services-search');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = allServices.filter(s => {
    if (activeServiceCategory !== 'all') {
      if (activeServiceCategory === 'more') {
        if (['certificate', 'education', 'welfare'].includes(s.category.toLowerCase())) {
          return false;
        }
      } else if (s.category.toLowerCase() !== activeServiceCategory) {
        return false;
      }
    }
    if (query) {
      const nameMatch = s.name.toLowerCase().includes(query);
      const catMatch = s.category.toLowerCase().includes(query);
      const deptMatch = s.department ? s.department.toLowerCase().includes(query) : false;
      return nameMatch || catMatch || deptMatch;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-state" style="text-align:center; padding:20px 0; color:#64748B;">No matching services found.</p>';
    return;
  }

  // Fetch user applications to check applied status
  let userApps = [];
  try { userApps = deduplicateApps(await apiCall('/services/user-applications')); } catch(e) {}

  filtered.forEach(s => {
    const row = document.createElement('div');
    row.className = 'service-item-row';
    // Check application status
    const existApp = userApps.find(a => a.service_id === s.id);
    let applyBtnHtml = '<button class="btn-apply-green">Apply</button>';
    if (existApp) {
      if (existApp.status === 'approved') {
        applyBtnHtml = '<span style="font-size:10px;font-weight:700;color:#046A38;background:#F0FDF4;padding:4px 10px;border-radius:6px;border:1px solid #BBF7D0;white-space:nowrap;">✓ Applied</span>';
      } else if (existApp.status === 'pending' || existApp.status === 'under_review') {
        applyBtnHtml = '<span style="font-size:10px;font-weight:700;color:#D97706;background:#FFFBEB;padding:4px 10px;border-radius:6px;border:1px solid #FDE68A;white-space:nowrap;">⏳ Under Review</span>';
      } else if (existApp.status === 'rejected') {
        applyBtnHtml = '<span style="font-size:10px;font-weight:700;color:#DC2626;background:#FEF2F2;padding:4px 10px;border-radius:6px;border:1px solid #FECACA;cursor:pointer;white-space:nowrap;">↻ Apply Again</span>';
      }
    }
    row.innerHTML = `
      <div class="service-row-left">
        <div class="service-row-icon ${getServiceIconClass(s.name)}">${getServiceIcon(s.name)}</div>
        <div class="service-row-details">
          <h5>${s.name}</h5>
          <p>Category: ${s.category.toUpperCase()} • Fee: ₹${s.fees} • Est. Time: ${s.processing_time}</p>
        </div>
      </div>
      ${applyBtnHtml}
    `;
    row.addEventListener('click', () => {
      showServiceDetails(s);
    });
    container.appendChild(row);
  });
}

// Track which service form is currently open (for auto-saving on close)
var _currentDraftServiceId = null;

function saveDraft(service, formValues) {
  try {
    const drafts = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
    const existing = drafts[service.id] || {};
    drafts[service.id] = {
      service: service,
      timestamp: new Date().toISOString(),
      step: 'details',
      formValues: formValues || existing.formValues || []
    };
    localStorage.setItem('one_citizen_drafts', JSON.stringify(drafts));
    loadDashboardData();
  } catch (e) {
    console.error('Failed to save draft:', e);
  }
}

// Capture all form field values from the current bottom sheet
function captureFormValues() {
  var values = [];
  var inputs = document.querySelectorAll('#sheet-body-content .mf-val');
  inputs.forEach(function(inp) {
    values.push(inp.value || '');
  });
  return values;
}

// Restore form field values into the current bottom sheet
function restoreFormValues(values) {
  if (!values || values.length === 0) return;
  var inputs = document.querySelectorAll('#sheet-body-content .mf-val');
  inputs.forEach(function(inp, idx) {
    if (idx < values.length && values[idx]) {
      inp.value = values[idx];
      // Don't add mf-has-val — draft fields should look like user-typed, not auto-filled
      inp.removeAttribute('readonly');
    }
  });
}

function deleteDraft(serviceId) {
  try {
    const drafts = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
    if (drafts[serviceId]) {
      delete drafts[serviceId];
      localStorage.setItem('one_citizen_drafts', JSON.stringify(drafts));
    }
  } catch (e) {
    console.error('Failed to delete draft:', e);
  }
}


async function openServiceFormByName(name) {
  if (allServices.length === 0) {
    try { allServices = await apiCall('/services'); } catch(e) {}
  }
  var nameLower = name.toLowerCase();
  var matched = null;
  for (var i = 0; i < allServices.length; i++) {
    if (allServices[i].name.toLowerCase().indexOf(nameLower) !== -1) { matched = allServices[i]; break; }
  }
  if (!matched) {
    // Try partial match on first word
    var firstWord = nameLower.split(' ')[0];
    for (var j = 0; j < allServices.length; j++) {
      if (allServices[j].name.toLowerCase().indexOf(firstWord) !== -1) { matched = allServices[j]; break; }
    }
  }
  if (!matched) {
    showToast('Service not found matching "' + name + '"', 'warning');
    return;
  }
  showServiceDetails(matched);
}

async function showServiceDetails(s) {
  var title = s.name;
  var docs = s.required_documents || [];

  // Check if user already has an active (non-rejected) application for this service
  try {
    var userApps = deduplicateApps(await apiCall('/services/user-applications'));
    var existingApp = userApps.find(function(a) { return a.service_id === s.id && a.status !== 'rejected'; });
    if (existingApp) {
      // Show the MeeSeva receipt for this application
      existingApp.service_name = s.name;
      existingApp.fees = s.fees;
      showExistingAppReceipt(existingApp);
      return;
    }

    // Check for rejected app — allow re-apply and pre-fill with old form data
    var rejectedApp = userApps.find(function(a) { return a.service_id === s.id && a.status === 'rejected'; });
    if (rejectedApp) {
      // Delete the old rejected application so only 1 card per certificate
      try { await apiCall('/services/application/' + rejectedApp.id, 'DELETE'); } catch(e) {}
      deleteDraft(s.id);
      // Save the old form data as a draft so the form pre-fills
      try {
        var oldFormData = typeof rejectedApp.form_data === 'string' ? JSON.parse(rejectedApp.form_data) : rejectedApp.form_data;
        if (oldFormData) {
          var drafts = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
          drafts[s.id] = { formValues: oldFormData, savedAt: Date.now() };
          localStorage.setItem('one_citizen_drafts', JSON.stringify(drafts));
        }
      } catch(e) { console.warn('Could not restore old form data:', e); }
    }
  } catch (e) {
    // If can't fetch apps, allow proceeding (submit endpoint will block duplicates anyway)
    console.warn('Could not check existing applications:', e.message);
  }

  // ── STEP 1: Show eligibility overview before form ──
  var eligRules = {};
  try { eligRules = typeof s.eligibility_rules === 'string' ? JSON.parse(s.eligibility_rules) : (s.eligibility_rules || {}); } catch(e) { eligRules = {}; }

  var overviewHtml = '';

  // Service info card
  overviewHtml += `
    <div style="background:linear-gradient(135deg,#F0FDF4,#ECFDF5);border:1px solid #BBF7D0;border-radius:12px;padding:14px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:10px;color:#64748B;font-weight:600;">Service Fee</span>
        <span style="font-size:14px;color:#046A38;font-weight:800;">₹${s.fees || 'Free'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:10px;color:#64748B;font-weight:600;">Processing Time</span>
        <span style="font-size:12px;color:#1E293B;font-weight:700;">${s.processing_time || 'N/A'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:10px;color:#64748B;font-weight:600;">Department</span>
        <span style="font-size:10px;color:#1E293B;font-weight:600;">${s.category || 'Government'}</span>
      </div>
    </div>`;

  // Eligibility rules section
  var ruleItems = [];
  if (eligRules.min_age) ruleItems.push({ label: 'Minimum Age', value: `${eligRules.min_age} years`, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' });
  if (eligRules.max_age) ruleItems.push({ label: 'Maximum Age', value: `${eligRules.max_age} years`, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' });
  if (eligRules.categories) ruleItems.push({ label: 'Category', value: eligRules.categories.join(', '), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' });
  if (eligRules.states) ruleItems.push({ label: 'Applicable States', value: eligRules.states.join(', '), icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' });
  if (eligRules.max_income) ruleItems.push({ label: 'Max Income', value: `₹${eligRules.max_income.toLocaleString()}/year`, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' });
  if (eligRules.gender) ruleItems.push({ label: 'Gender', value: eligRules.gender, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' });
  if (eligRules.occupation) ruleItems.push({ label: 'Occupation', value: eligRules.occupation, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>' });
  if (eligRules.is_farmer) ruleItems.push({ label: 'Farmer Status', value: 'Required', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c4-4 8-7.5 8-12a8 8 0 1 0-16 0c0 4.5 4 8 8 12z"/></svg>' });

  if (ruleItems.length > 0) {
    overviewHtml += `<div style="margin-bottom:14px;">
      <h4 style="font-size:12px;font-weight:800;color:#1E293B;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#046A38" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        Eligibility Requirements
      </h4>`;
    ruleItems.forEach(r => {
      overviewHtml += `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;margin-bottom:4px;border-radius:8px;background:#F8FAFC;border:1px solid #F1F5F9;">
          <div style="color:#046A38;flex-shrink:0;">${r.icon}</div>
          <div style="flex:1;min-width:0;">
            <span style="font-size:10px;color:#64748B;display:block;">${r.label}</span>
            <span style="font-size:12px;color:#1E293B;font-weight:700;">${r.value}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#046A38" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>`;
    });
    overviewHtml += `</div>`;
  }

  // Required documents preview
  if (docs.length > 0) {
    overviewHtml += `<div style="margin-bottom:14px;">
      <h4 style="font-size:12px;font-weight:800;color:#1E293B;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Required Documents (${docs.length})
      </h4>`;
    docs.forEach((d, i) => {
      overviewHtml += `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 12px;margin-bottom:3px;border-radius:6px;background:#FAFBFF;border:1px solid #EEF0FF;">
          <span style="width:18px;height:18px;border-radius:50%;background:#EEF2FF;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#4338CA;flex-shrink:0;">${i + 1}</span>
          <span style="font-size:11px;color:#1E293B;font-weight:600;">${d}</span>
        </div>`;
    });
    overviewHtml += `</div>`;
  }

  // Application steps preview
  overviewHtml += `
    <div style="margin-bottom:16px;">
      <h4 style="font-size:12px;font-weight:800;color:#1E293B;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Application Steps
      </h4>
      <div style="padding-left:4px;">
        ${['Fill application form', 'Upload required documents', 'Review & submit', 'Officer verification'].map((step, i) => `
          <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:${i < 3 ? '0' : '0'}px;position:relative;">
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div style="width:22px;height:22px;border-radius:50%;background:${i === 0 ? '#046A38' : '#E2E8F0'};display:flex;align-items:center;justify-content:center;">
                <span style="font-size:9px;font-weight:800;color:${i === 0 ? '#fff' : '#64748B'};">${i + 1}</span>
              </div>
              ${i < 3 ? `<div style="width:1.5px;height:16px;background:#E2E8F0;margin:2px 0;"></div>` : ''}
            </div>
            <div style="padding-top:3px;">
              <span style="font-size:11px;color:#1E293B;font-weight:${i === 0 ? '700' : '600'};">${step}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;

  overviewHtml += `<button id="btn-proceed-apply" style="width:100%;background:#046A38;border:none;color:#fff;padding:14px;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;letter-spacing:0.3px;">Proceed to Apply</button>`;

  openBottomSheet(title, overviewHtml);

  document.getElementById('btn-proceed-apply').addEventListener('click', async function() {
    // ── STEP 2: Show the actual application form ──
    saveDraft(s);
    _currentDraftServiceId = s.id;

    var autoFields = {};
    try {
      autoFields = await apiCall('/services/auto-fill/' + s.id);
    } catch (e) {
      autoFields = { name: '', dob: '', gender: '', state: '', district: '', aadhaar_number: '', pan_number: '', father_name: '', mobile: '', pincode: '', address: '', caste: '', income_amount: '' };
    }

    var html = '';
    html += getOfficialFormHTML(s.name, autoFields);
    html += '<button id="sheet-btn-next" style="width:100%;margin-top:18px;background:#046A38;border:none;color:#fff;padding:13px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Next</button>';

    openBottomSheet(title, html, true);

  // Restore saved draft values if any
  var drafts = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
  if (drafts[s.id] && drafts[s.id].formValues) {
    restoreFormValues(drafts[s.id].formValues);
  }

  document.getElementById('sheet-btn-next').addEventListener('click', async function() {
    var vaultDocs = [];
    var vaultDocsData = []; // full doc objects with file_path
    try {
      var vaultData = await apiCall('/documents');
      vaultDocsData = vaultData || [];
      vaultDocs = vaultDocsData.map(function(d) { return d.document_type; });
    } catch(e) {
      vaultDocs = [];
    }

    // Map human-readable doc names to vault document_type keys
    var docNameToType = {
      'aadhaar card': 'aadhaar', 'aadhaar': 'aadhaar',
      'pan card': 'pan', 'pan': 'pan',
      'passport-size photo': 'passport_size_photo', 'passport size photo': 'passport_size_photo',
      'ration card': 'ration', 'ration card (if available)': 'ration',
      'income proof of family members': null, 'salary certificate': null,
      'employer certificate': null, 'income tax return': null,
      'pension documents': null,
      'address proof': 'aadhaar', 'residence proof': 'aadhaar', 'domicile proof': 'aadhaar',
      'mobile number': null,
      'caste certificate': 'caste', 'caste certificate (sc/st/bc)': 'caste',
      "father's caste certificate (if available)": null,
      'school transfer certificate (tc)': null,
      'ssc memo / educational records': null,
      'affidavit or self declaration': null,
      'income certificate': 'income',
      'property details': null,
      'self declaration form': null,
      'hospital birth report': null,
      'parent aadhaar cards': 'aadhaar', 'parent mobile number': null,
      'death report from hospital': null,
      'aadhaar of deceased': 'aadhaar', 'aadhaar of applicant': 'aadhaar',
      'medical certificate of cause of death': null,
      'burial/cremation record (if applicable)': null,
      'age proof': 'aadhaar', 'bank passbook': null,
      'business address proof': null,
      'birth certificate': 'birth',
    };

    // Check which docs are uploaded vs missing
    var missing = [];
    docs.forEach(function(d) {
      var key = docNameToType[d.toLowerCase()];
      var uploadKey = key || d.toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (vaultDocs.indexOf(uploadKey) === -1) missing.push(d);
    });

    // Check if this is a re-apply from a rejected app
    var isRejectedReApply = !!localStorage.getItem('_rej_reapply_' + s.id);
    // Set flag when coming from rejected flow
    if (localStorage.getItem('one_citizen_drafts')) {
      try {
        var dd = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
        if (dd[s.id]) isRejectedReApply = true;
      } catch(e) {}
    }

    var docHtml = '<div style="padding:5px 0">';
    docHtml += '<h4 style="font-size:14px;font-weight:700;margin-bottom:12px">Required Documents</h4>';

    docs.forEach(function(d) {
      var key = docNameToType[d.toLowerCase()];
      var uploadKey = key || d.toLowerCase().replace(/[^a-z0-9]/g, '_');
      var found = vaultDocs.indexOf(uploadKey) !== -1;
      var vaultDoc = found ? vaultDocsData.find(function(vd) { return vd.document_type === uploadKey; }) : null;
      var filePath = (vaultDoc && vaultDoc.file_path) ? vaultDoc.file_path : '';
      docHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;border-radius:8px;background:' + (found ? '#F0FDF4' : '#FEF2F2') + ';border:1px solid ' + (found ? '#BBF7D0' : '#FECACA') + '">';
      docHtml += '<span style="font-size:12px;font-weight:600">' + d + '</span>';
      if (found) {
        docHtml += '<span style="display:flex;align-items:center;gap:6px;">';
        docHtml += '<span style="color:#16A34A;font-size:11px;font-weight:700">✓</span>';
        if (filePath) {
          docHtml += '<span class="inline-view-doc" data-fp="' + filePath + '" data-docname="' + d + '" style="color:#1E40AF;font-size:10px;font-weight:700;cursor:pointer;text-decoration:underline;">View</span>';
        }
        // Re-upload option (optional) for re-apply flows
        docHtml += '<label style="color:#D97706;font-size:10px;font-weight:700;cursor:pointer;text-decoration:underline;margin-left:2px;">';
        docHtml += 'Re-upload';
        docHtml += '<input type="file" accept="image/*,.pdf" capture="environment" data-doctype="' + uploadKey + '" data-docname="' + d + '" class="inline-doc-upload" style="display:none" />';
        docHtml += '</label>';
        docHtml += '</span>';
      } else {
        // Show inline upload button for ALL missing docs
        docHtml += '<label style="color:#fff;font-size:11px;font-weight:700;background:#1E40AF;padding:5px 12px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px">';
        docHtml += '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload';
        docHtml += '<input type="file" accept="image/*,.pdf" capture="environment" data-doctype="' + uploadKey + '" data-docname="' + d + '" class="inline-doc-upload" style="display:none" />';
        docHtml += '</label>';
      }
      docHtml += '</div>';
    });

    if (missing.length > 0) {
      docHtml += '<p style="font-size:11px;color:#DC2626;margin:10px 0">Upload missing documents above to proceed.</p>';
    } else {
      docHtml += '<p style="font-size:11px;color:#16A34A;margin:10px 0;font-weight:600">All required documents are uploaded!</p>';
      docHtml += '<button id="btn-final-apply" style="width:100%;margin-top:8px;background:#046A38;border:none;color:#fff;padding:14px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">Apply</button>';
    }
    docHtml += '</div>';

    openBottomSheet('Documents Check - ' + title, docHtml);

    // Bind View doc handlers for already-uploaded docs
    document.querySelectorAll('.inline-view-doc').forEach(function(viewBtn) {
      viewBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        var fp = this.getAttribute('data-fp');
        var dn = this.getAttribute('data-docname') || 'Document';
        var fileUrl = '/uploads/' + fp;
        var ext = fp.split('.').pop().toLowerCase();
        var previewHtml = '';
        if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
          previewHtml = '<div style="text-align:center;padding:8px 0;"><img src="' + fileUrl + '" style="max-width:100%;max-height:60vh;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.15);" alt="Preview"/></div>';
        } else if (ext === 'pdf') {
          previewHtml = '<div style="padding:8px 0;"><iframe src="' + fileUrl + '" style="width:100%;height:60vh;border:none;border-radius:8px;"></iframe></div>';
        } else {
          previewHtml = '<div style="text-align:center;padding:20px;"><a href="' + fileUrl + '" target="_blank" style="color:#1E40AF;font-weight:700;">Download</a></div>';
        }
        previewHtml += '<button class="btn btn-primary" onclick="closeBottomSheet()" style="width:100%;margin-top:10px;font-weight:700;background:#046A38 !important;border:none !important;">Close</button>';
        openBottomSheet(dn, previewHtml);
      });
    });

    // Bind inline upload handlers
    async function handleUpload() {
      var file = this.files[0];
      if (!file) return;
      var docType = this.getAttribute('data-doctype');
      var docName = this.getAttribute('data-docname');
      var row = this.closest('div');
      // Show uploading state
      var label = this.parentElement;
      label.innerHTML = '<span style="font-size:11px">Uploading...</span>';
      try {
        var fd = new FormData();
        fd.append('document', file);
        fd.append('document_type', docType);
        fd.append('skip_ocr', 'true');
        var uploadRes = await apiCall('/documents/upload', 'POST', fd, true);
        // Update row to show uploaded + view button
        row.style.background = '#F0FDF4';
        row.style.borderColor = '#BBF7D0';
        var viewFilePath = (uploadRes.document && uploadRes.document.file_path) ? uploadRes.document.file_path : '';
        label.outerHTML = `<span style="display:flex;align-items:center;gap:6px;">
          <span style="color:#16A34A;font-size:11px;font-weight:700">Uploaded</span>
          ${viewFilePath ? `<span class="inline-view-doc" data-fp="${viewFilePath}" style="color:#1E40AF;font-size:10px;font-weight:700;cursor:pointer;text-decoration:underline;">View</span>` : ''}
        </span>`;
        // Bind view click
        var viewBtn = row.querySelector('.inline-view-doc');
        if (viewBtn) {
          viewBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var fp = this.getAttribute('data-fp');
            var fileUrl = '/uploads/' + fp;
            var ext = fp.split('.').pop().toLowerCase();
            var previewHtml = '';
            if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
              previewHtml = '<div style="text-align:center;padding:8px 0;"><img src="' + fileUrl + '" style="max-width:100%;max-height:60vh;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.15);" alt="Preview"/></div>';
            } else if (ext === 'pdf') {
              previewHtml = '<div style="padding:8px 0;"><iframe src="' + fileUrl + '" style="width:100%;height:60vh;border:none;border-radius:8px;"></iframe></div>';
            } else {
              previewHtml = '<div style="text-align:center;padding:20px;"><a href="' + fileUrl + '" target="_blank" style="color:#1E40AF;font-weight:700;">Download</a></div>';
            }
            previewHtml += '<button class="btn btn-primary" onclick="closeBottomSheet()" style="width:100%;margin-top:10px;font-weight:700;background:#046A38 !important;border:none !important;">Close</button>';
            openBottomSheet(docName, previewHtml);
          });
        }
        showToast(docName + ' uploaded successfully!');
        loadVaultItems();
        // Re-check if all are uploaded now
        var stillMissing = document.querySelectorAll('.inline-doc-upload');
        if (stillMissing.length === 0) {
          // All done - add apply button
          var container = document.querySelector('#bottom-sheet-content > div > div');
          if (container) {
            var msgP = container.querySelector('p[style*="DC2626"]');
            if (msgP) {
              msgP.style.color = '#16A34A';
              msgP.textContent = 'All required documents are uploaded!';
              msgP.style.fontWeight = '600';
            }
            // Add apply button if not there
            if (!document.getElementById('btn-final-apply')) {
              var applyBtn = document.createElement('button');
              applyBtn.id = 'btn-final-apply';
              applyBtn.style.cssText = 'width:100%;margin-top:8px;background:#046A38;border:none;color:#fff;padding:14px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer';
              applyBtn.textContent = 'Apply';
              applyBtn.addEventListener('click', async function() {
                this.disabled = true;
                this.textContent = 'Submitting...';
                try {
                  var formData2 = { service_name: s.name, service: s.name, autoFields: autoFields, submitted_at: new Date().toISOString() };
                  var submitRes = await apiCall('/services/submit', 'POST', { service_id: s.id, form_data: formData2, readiness_score: 100 });
                  deleteDraft(s.id);
                  closeBottomSheet();
                  var successHtml = '<div style="text-align:center;padding:20px 10px;">' +
                    '<div style="width:60px;height:60px;border-radius:50%;background:rgba(4,106,56,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#046A38" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>' +
                    '<h3 style="font-size:16px;font-weight:800;color:#1E293B;margin-bottom:6px;">Applied Successfully!</h3>' +
                    '<p style="font-size:12px;color:#64748B;margin-bottom:16px;">Your application has been submitted for officer review.</p>' +
                    '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px;margin-bottom:16px;"><p style="font-size:10px;color:#64748B;margin-bottom:4px;">Application Number</p><p style="font-size:16px;font-weight:800;color:#046A38;letter-spacing:1px;">' + (submitRes.application_id || 'N/A') + '</p></div>' +
                    '<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:16px;"><span style="width:8px;height:8px;border-radius:50%;background:#3B82F6;"></span><span style="font-size:11px;color:#3B82F6;font-weight:600;">Status: Applied</span></div>' +
                    '<p style="font-size:10px;color:#94A3B8;">An officer will review your application shortly. You\'ll be notified of any status changes.</p>' +
                    '<button class="btn btn-accent" onclick="closeBottomSheet();switchScreen(\'screen-dashboard\');" style="width:100%;margin-top:16px;">Back to Dashboard</button></div>';
                  openBottomSheet('Application Submitted', successHtml);
                  loadDashboardData();
                  loadAdminDashboard();
                } catch(err2) {
                  this.disabled = false;
                  this.textContent = 'Apply';
                  showToast('Submission failed: ' + (err2.message || 'Error'), 'warning');
                }
              });
              container.appendChild(applyBtn);
            }
          }
        }
      } catch(err) {
        // Show retry button instead of just "Failed"
        label.innerHTML = `<label style="color:#fff;font-size:10px;font-weight:700;background:#DC2626;padding:4px 10px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Retry
          <input type="file" accept="image/*,.pdf" capture="environment" data-doctype="${docType}" data-docname="${docName}" class="inline-doc-upload" style="display:none" />
        </label>`;
        // Re-bind the new retry input
        var retryInput = label.querySelector('.inline-doc-upload');
        if (retryInput) {
          retryInput.addEventListener('change', handleUpload);
        }
        showToast('Upload failed: ' + (err.message || err.error || 'Error'), 'warning');
      }
    }

    var inlineInputs = document.querySelectorAll('.inline-doc-upload');
    inlineInputs.forEach(function(input) {
      input.addEventListener('change', handleUpload);
    });

    if (missing.length === 0) {
      document.getElementById('btn-final-apply').addEventListener('click', async function() {
        this.disabled = true;
        this.textContent = 'Submitting...';
        try {
          var formData = { service_name: s.name, service: s.name, autoFields: autoFields, submitted_at: new Date().toISOString() };
          var submitRes = await apiCall('/services/submit', 'POST', { service_id: s.id, form_data: formData, readiness_score: 100 });
          deleteDraft(s.id);
          closeBottomSheet();
          var successHtml = '<div style="text-align:center;padding:20px 10px;">' +
            '<div style="width:60px;height:60px;border-radius:50%;background:rgba(4,106,56,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#046A38" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>' +
            '<h3 style="font-size:16px;font-weight:800;color:#1E293B;margin-bottom:6px;">Applied Successfully!</h3>' +
            '<p style="font-size:12px;color:#64748B;margin-bottom:16px;">Your application has been submitted for officer review.</p>' +
            '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px;margin-bottom:16px;"><p style="font-size:10px;color:#64748B;margin-bottom:4px;">Application Number</p><p style="font-size:16px;font-weight:800;color:#046A38;letter-spacing:1px;">' + (submitRes.application_id || 'N/A') + '</p></div>' +
            '<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:16px;"><span style="width:8px;height:8px;border-radius:50%;background:#3B82F6;"></span><span style="font-size:11px;color:#3B82F6;font-weight:600;">Status: Applied</span></div>' +
            '<p style="font-size:10px;color:#94A3B8;">An officer will review your application shortly. You\'ll be notified of any status changes.</p>' +
            '<button class="btn btn-accent" onclick="closeBottomSheet();switchScreen(\'screen-dashboard\');" style="width:100%;margin-top:16px;">Back to Dashboard</button></div>';
          openBottomSheet('Application Submitted', successHtml);
          loadDashboardData();
          loadAdminDashboard();
        } catch(err) {
          this.disabled = false;
          this.textContent = 'Apply';
          showToast('Submission failed: ' + (err.message || 'Error'), 'warning');
        }
      });
    }
  });
  }); // close btn-proceed-apply click handler
}


// 10. Readiness Score Dial Check
async function checkReadinessScore(service) {
  showDialogSpinner();
  try {
    const res = await apiCall(`/services/readiness/${service.id}`);
    hideDialogSpinner();

    const score = res.readiness_score;
    const issues = res.issues || [];
    const docAnalysis = res.document_analysis || [];

    const title = "Submission Readiness Score";
    let color = score >= 80 ? 'var(--success-emerald)' : (score >= 50 ? 'orange' : 'red');

    let html = `
      <div class="score-circle-wrapper">
        <div class="score-circle" style="border-color:${color}; color:${color}">
          ${score}%
        </div>
        <span class="score-lbl" style="color:${color}">${score >= 80 ? 'SUBMISSION READY' : 'REMEDIATION NEEDED'}</span>
      </div>
      
      <h4 class="checklist-title">Required Documents Checklist</h4>
    `;

    docAnalysis.forEach(d => {
      const isOk = d.is_verified && d.status === 'present';
      html += `
        <div class="checklist-item">
          <span>${isOk ? '' : (d.status === 'missing' ? '' : '')}</span>
          <span><b>${d.document_type.toUpperCase()}</b>: ${d.status === 'missing' ? 'Missing from Vault' : 'Uploaded and scanned'}</span>
        </div>
      `;
    });

    if (issues.length > 0) {
      html += `<div class="remediation-box"><h5>Remediation Actions Needed:</h5>`;
      issues.forEach(i => {
        html += `<p style="font-size:11px; margin-top:4px;">- ${i.message}</p>`;
      });
      html += `</div>`;
    }

    if (score >= 80) {
      html += `
        <button class="btn btn-accent" id="btn-submit-package" style="width:100%; margin-top:20px;">
          Submit Application Package
        </button>
      `;
    } else {
      html += `
        <button class="btn btn-primary" style="width:100%; margin-top:20px;" disabled>
          Ready Check Blocked (Upload Missing IDs)
        </button>
      `;
    }

    openBottomSheet(title, html);

    if (score >= 80) {
      document.getElementById('btn-submit-package').addEventListener('click', async () => {
        closeBottomSheet();
        showDialogSpinner();
        
        // Auto-fill and submit
        const autoFields = await apiCall(`/services/auto-fill/${service.id}`);
        autoFields.service_name = service.name;

        const submitRes = await apiCall('/services/submit', 'POST', {
          service_id: service.id,
          form_data: autoFields,
          readiness_score: score,
          validation_report: { issues: issues.map(i => i.message) }
        });

        hideDialogSpinner();
        deleteDraft(service.id);
        loadDashboardData();

        // Show MeeSeva-style receipt
        showApplicationReceipt(submitRes);
        loadAdminDashboard();
      });
    }

  } catch (err) {
    hideDialogSpinner();
    alert(err.message);
  }
}

// ── MeeSeva-style Application Receipt ──
function showApplicationReceipt(data) {
  var appId = data.application_id || data.id || 'N/A';
  var txnId = data.transaction_id || ('TT' + appId);
  var applicantName = data.applicant_name || '';
  if (!applicantName && data.form_data) {
    var fd = typeof data.form_data === 'string' ? JSON.parse(data.form_data) : data.form_data;
    applicantName = fd.applicant_name || fd.name || '';
  }
  var serviceName = data.service_name || data.service_category || '';
  var district = (data.district || 'WARANGAL').toUpperCase();
  if (!data.district && data.form_data) {
    var fd2 = typeof data.form_data === 'string' ? JSON.parse(data.form_data) : data.form_data;
    if (fd2.district) district = fd2.district.toUpperCase();
  }
  var paymentDate = data.date_of_payment || new Date(data.created_at || Date.now()).toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'});
  var paymentMode = data.payment_mode || 'Online';
  var status = data.status || 'pending';
  var statusLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : status === 'under_review' ? 'Under Review' : 'Submitted';
  var statusColor = status === 'approved' ? '#046A38' : status === 'rejected' ? '#DC2626' : status === 'under_review' ? '#D97706' : '#1A73E8';
  // Deterministic receipt number from app ID
  var hashVal = 0;
  for (var i = 0; i < appId.length; i++) hashVal = ((hashVal << 5) - hashVal + appId.charCodeAt(i)) | 0;
  var receiptNo = 'TS ' + String(Math.abs(hashVal)).slice(0, 6).padStart(6, '0');

  var govtLogo = '<img src="/telangana_logo.png" alt="Govt of Telangana" style="width:42px;height:42px;border-radius:50%;object-fit:cover;" />';

  var receiptHtml = '<div style="padding:0;">' +
    '<!-- Header -->' +
    '<div style="background:linear-gradient(135deg,#053e2a,#08573c);padding:14px 16px;border-radius:10px 10px 0 0;">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<div style="flex-shrink:0;">' + govtLogo + '</div>' +
        '<div style="flex:1;">' +
          '<div style="font-size:9px;color:rgba(255,255,255,0.7);font-weight:600;letter-spacing:1px;">GOVERNMENT OF TELANGANA</div>' +
          '<div style="font-size:15px;font-weight:900;color:#fff;letter-spacing:0.5px;margin:1px 0;">OneCitizen Portal</div>' +
          '<div style="font-size:8px;color:rgba(255,255,255,0.5);">Integrated Citizen Services Platform</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:10px;font-weight:700;color:#FF9933;letter-spacing:0.5px;">RECEIPT</div>' +
          '<div style="font-size:10px;font-weight:800;color:#fff;">' + receiptNo + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<!-- Body -->' +
    '<div style="background:#FFFDF5;padding:14px 16px;border:1px solid #E8DCC8;border-top:none;border-radius:0 0 10px 10px;">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:10px;">' +
        '<div><span style="font-size:9px;color:#8B7355;font-weight:600;">Date :</span> <span style="font-size:10px;font-weight:700;color:#1E293B;">' + paymentDate + '</span></div>' +
        '<div><span style="font-size:9px;color:#8B7355;font-weight:600;">Mode :</span> <span style="font-size:10px;font-weight:700;color:#1E293B;">' + paymentMode + '</span></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:10px;border-bottom:1px dashed #D4C5A9;padding-bottom:10px;">' +
        '<div><span style="font-size:9px;color:#8B7355;font-weight:600;">Transaction ID :</span><br><span style="font-size:11px;font-weight:800;color:#1E293B;letter-spacing:0.5px;">' + txnId + '</span></div>' +
        '<div style="text-align:right;"><span style="font-size:9px;color:#8B7355;font-weight:600;">Status :</span><br><span style="font-size:11px;font-weight:800;color:' + statusColor + ';">' + statusLabel + '</span></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:10px;">' +
        '<div style="flex:1;"><span style="font-size:9px;color:#8B7355;font-weight:600;">Applicant Name :</span><br><span style="font-size:12px;font-weight:800;color:#1E293B;">' + (applicantName.toUpperCase() || 'N/A') + '</span></div>' +
        '<div style="text-align:right;"><span style="font-size:9px;color:#8B7355;font-weight:600;">Application No :</span><br><span style="font-size:12px;font-weight:900;color:#053e2a;letter-spacing:0.5px;">' + appId + '</span></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:10px;border-bottom:1px dashed #D4C5A9;padding-bottom:10px;">' +
        '<div><span style="font-size:9px;color:#8B7355;font-weight:600;">Service Type :</span><br><span style="font-size:11px;font-weight:700;color:#1E293B;">' + serviceName + '</span></div>' +
        '<div style="text-align:right;"><span style="font-size:9px;color:#8B7355;font-weight:600;">Document District :</span><br><span style="font-size:11px;font-weight:700;color:#1E293B;">' + district + '</span></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;">' +
        '<div>' +
          '<div style="font-size:8px;color:#8B7355;">Authorized by</div>' +
          '<div style="font-size:9px;font-weight:700;color:#1E293B;">OneCitizen Digital Services</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:8px;color:#8B7355;font-style:italic;">Sd/-</div>' +
          '<div style="font-size:10px;font-weight:800;color:#053e2a;">Tahsildar</div>' +
          '<div style="font-size:8px;font-weight:600;color:#64748B;">' + district + ' District Office</div>' +
        '</div>' +
      '</div>' +
      '<div style="background:linear-gradient(135deg,#053e2a,#08573c);border-radius:6px;padding:8px 12px;">' +
        '<div style="font-size:7px;color:rgba(255,255,255,0.8);line-height:1.5;">' +
          'OneCitizen Portal, Government of Telangana, Secretariat, Hyderabad - 500 063.<br>' +
          'Helpline: 040-2345-6789 &nbsp;|&nbsp; <b>onecitizen.telangana.gov.in</b> &nbsp;|&nbsp; This is a computer generated receipt.' +
        '</div>' +
      '</div>' +
    '</div>';

  // ── For rejected apps: add reason + apply again ──
  if (status === 'rejected') {
    var reason = data.officer_notes || 'No specific reason provided by the reviewing officer.';
    receiptHtml += '<div style="background:#FEF2F2;border:1.5px solid #FECACA;border-radius:10px;padding:12px 14px;margin-top:10px;">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
        '<span style="font-size:11px;font-weight:700;color:#DC2626;">Rejection Reason</span>' +
      '</div>' +
      '<div style="font-size:11px;color:#7F1D1D;line-height:1.5;">' + reason + '</div>' +
    '</div>';
    receiptHtml += '<button id="btn-rej-apply-again" class="btn btn-accent" style="width:100%;margin-top:10px;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;font-weight:700;padding:12px;">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
      'Apply Again</button>';
    receiptHtml += '</div>';
    openBottomSheet('Application Receipt', receiptHtml);
    // Wire apply again
    setTimeout(function() {
      var btn = document.getElementById('btn-rej-apply-again');
      if (btn) btn.addEventListener('click', async function() {
        closeBottomSheet();
        try { await apiCall('/services/application/' + appId, 'DELETE'); } catch(e) {}
        if (allServices.length === 0) { try { allServices = await apiCall('/services'); } catch(e) {} }
        var svcName = data.service_name || '';
        var matched = null;
        if (data.service_id) matched = allServices.find(function(s) { return s.id === data.service_id; });
        if (!matched) {
          for (var mi = 0; mi < allServices.length; mi++) {
            if (allServices[mi].name.toLowerCase().indexOf(svcName.toLowerCase()) !== -1) { matched = allServices[mi]; break; }
          }
        }
        if (matched) {
          if (data.form_data) {
            try {
              var fdd = typeof data.form_data === 'string' ? JSON.parse(data.form_data) : data.form_data;
              var drafts = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
              drafts[matched.id] = { formValues: fdd, savedAt: Date.now() };
              localStorage.setItem('one_citizen_drafts', JSON.stringify(drafts));
            } catch(e) {}
          }
          showServiceDetails(matched);
        } else {
          showToast('Please apply from Services Catalog.', 'info');
          switchScreen('screen-services');
        }
      });
    }, 50);
  } else if (status === 'approved') {
    // MeeSeva collection steps for approved certificates
    receiptHtml += '<div style="background:linear-gradient(135deg,#F0FDF4,#ECFDF5);border:1.5px solid #BBF7D0;border-radius:10px;padding:14px;margin-top:10px;">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#046A38" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
        '<span style="font-size:12px;font-weight:700;color:#046A38;">How to Collect Your Certificate</span>' +
      '</div>' +
      '<div style="font-size:11px;color:#1E293B;line-height:1.7;">' +
        '<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="background:#046A38;color:#fff;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0;">1</span><span>Visit your nearest <b>MeeSeva Center</b> with this receipt and your Aadhaar card.</span></div>' +
        '<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="background:#046A38;color:#fff;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0;">2</span><span>Show your <b>Application ID: ' + appId + '</b> at the counter.</span></div>' +
        '<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="background:#046A38;color:#fff;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0;">3</span><span>Pay the certificate printing fee of <b>₹15 - ₹30</b> at the MeeSeva counter.</span></div>' +
        '<div style="display:flex;gap:8px;"><span style="background:#046A38;color:#fff;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0;">4</span><span>Collect your <b>physical certificate</b> with official stamp and signature.</span></div>' +
      '</div>' +
      '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #BBF7D0;font-size:9px;color:#64748B;line-height:1.5;">' +
        'Timing: Mon-Sat, 8:00 AM - 8:00 PM &nbsp;|&nbsp; Use the Locator tab to find your nearest MeeSeva center.' +
      '</div>' +
    '</div>';
    receiptHtml += '</div>';
    openBottomSheet('Application Receipt', receiptHtml);
  } else {
    receiptHtml += '</div>';
    openBottomSheet('Application Receipt', receiptHtml);
  }
}

// Show receipt for an existing application (from any page click)
async function showExistingAppReceipt(app) {
  var formData = {};
  try { formData = typeof app.form_data === 'string' ? JSON.parse(app.form_data) : (app.form_data || {}); } catch(e) {}
  
  // Pull applicant name from profile if missing
  var applicantName = formData.applicant_name || formData.name || '';
  if (!applicantName) {
    try {
      var profile = await apiCall('/auth/profile');
      applicantName = profile.full_name || profile.name || '';
    } catch(e) {}
  }

  // Pull district from Aadhaar card if missing
  var district = formData.district || '';
  if (!district) {
    try {
      var docs = await apiCall('/documents');
      var aadhaar = docs.find(function(d) { return d.document_type === 'aadhaar' && d.is_verified === 1; });
      if (aadhaar) {
        var ed = typeof aadhaar.extracted_data === 'string' ? JSON.parse(aadhaar.extracted_data) : (aadhaar.extracted_data || {});
        var addr = ed.address || '';
        var knownDistricts = ['Hyderabad','Ranga Reddy','Rangareddy','Medchal','Sangareddy','Warangal','Karimnagar','Nizamabad','Khammam','Nalgonda','Mahabubnagar','Adilabad','Siddipet'];
        for (var k = 0; k < knownDistricts.length; k++) {
          if (addr.toLowerCase().indexOf(knownDistricts[k].toLowerCase()) !== -1) {
            district = knownDistricts[k].toUpperCase();
            break;
          }
        }
      }
    } catch(e) {}
  }

  var receiptData = {
    application_id: app.id,
    applicant_name: applicantName,
    service_name: app.service_name || formData.service_name || '',
    district: district,
    date_of_payment: app.created_at ? new Date(app.created_at).toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}) : '',
    payment_mode: 'Online',
    status: app.status,
    created_at: app.created_at
  };

  // Route based on status
  if (app.status === 'approved') {
    showApprovedOptions(receiptData);
  } else if (app.status === 'rejected') {
    receiptData.officer_notes = app.officer_notes || '';
    receiptData.service_id = app.service_id;
    receiptData.form_data = formData;
    showRejectedOptions(receiptData);
  } else {
    showApplicationReceipt(receiptData);
  }
}

// ── Approved Certificate Options ──
function showApprovedOptions(receiptData) {
  showApplicationReceipt(receiptData);
}

// ── Virtual Certificate Download ──
function showVirtualCertificate(data) {
  var serviceName = data.service_name || 'Certificate';
  var appId = data.application_id || '';
  var district = (data.district || 'WARANGAL').toUpperCase();

  var html = '<div style="padding:4px 0;">' +
    '<div style="background:linear-gradient(135deg,#046A38,#08573c);border-radius:12px;padding:16px;text-align:center;margin-bottom:14px;">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>' +
      '<div style="font-size:14px;font-weight:800;color:#fff;">' + serviceName + '</div>' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.7);margin-top:4px;">Digital Certificate Ready</div>' +
    '</div>' +
    '<div style="background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:12px;padding:14px 16px;margin-bottom:12px;">' +
      '<div style="font-size:11px;font-weight:700;color:#16A34A;margin-bottom:6px;">✅ Your digital certificate is ready</div>' +
      '<div style="font-size:10px;color:#4B5563;line-height:1.6;">' +
        'Application No: <b>' + appId + '</b><br>' +
        'District: <b>' + district + '</b><br>' +
        'This digitally signed certificate is valid for all government purposes and can be verified at onecitizen.telangana.gov.in' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-accent" style="width:100%;border-radius:10px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px;" onclick="showToast(&apos;Certificate downloaded successfully&apos;, &apos;success&apos;);">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      'Download Certificate (PDF)' +
    '</button>' +
    '<button class="btn" style="width:100%;border-radius:10px;background:#F1F5F9;color:#475569;font-weight:600;" onclick="closeBottomSheet();">Close</button>' +
  '</div>';

  openBottomSheet('Virtual Certificate', html);
}

// ── Physical Certificate Guide (MeeSeva Steps) ──
function showPhysicalCertificateGuide(data) {
  var serviceName = data.service_name || 'Certificate';
  var appId = data.application_id || '';
  var district = (data.district || 'WARANGAL').toUpperCase();

  // Fee structure based on service type
  var svcLower = serviceName.toLowerCase();
  var fees = { base: 35, urgent: 100 };
  if (svcLower.indexOf('income') !== -1) { fees = { base: 35, urgent: 100 }; }
  else if (svcLower.indexOf('caste') !== -1) { fees = { base: 25, urgent: 75 }; }
  else if (svcLower.indexOf('birth') !== -1 || svcLower.indexOf('death') !== -1) { fees = { base: 50, urgent: 150 }; }
  else if (svcLower.indexOf('residence') !== -1 || svcLower.indexOf('domicile') !== -1) { fees = { base: 30, urgent: 100 }; }
  else if (svcLower.indexOf('marriage') !== -1) { fees = { base: 100, urgent: 250 }; }
  else if (svcLower.indexOf('obc') !== -1 || svcLower.indexOf('ews') !== -1) { fees = { base: 25, urgent: 75 }; }

  var steps = [
    { icon: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', title: 'Visit your nearest MeeSeva Centre', desc: 'Locate MeeSeva Kendra in ' + district + ' district. Use meeseva.telangana.gov.in for nearest center.' },
    { icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>', title: 'Carry Required Documents', desc: 'Bring your Aadhaar Card (original), application receipt printout, and one passport-size photo.' },
    { icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>', title: 'Pay the Service Fee', desc: 'Pay ₹' + fees.base + ' (normal) or ₹' + fees.urgent + ' (urgent/tatkal) at the MeeSeva counter. Payment via cash, card, or UPI.' },
    { icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M9 15l2 2 4-4"/>', title: 'Quote your Application Number', desc: 'Give the operator your Application No: <b>' + appId + '</b>. They will pull up your approved application.' },
    { icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', title: 'Collect Certificate', desc: 'Normal delivery: 3-5 working days. Tatkal: Same day or next working day. You will receive an SMS when ready.' }
  ];

  var stepsHtml = '';
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var isLast = (i === steps.length - 1);
    stepsHtml += '<div style="display:flex;gap:12px;position:relative;">' +
      '<div style="display:flex;flex-direction:column;align-items:center;">' +
        '<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#053e2a,#08573c);display:flex;align-items:center;justify-content:center;flex-shrink:0;z-index:1;">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + s.icon + '</svg>' +
        '</div>' +
        (isLast ? '' : '<div style="width:2px;flex:1;background:#E2E8F0;margin:4px 0;"></div>') +
      '</div>' +
      '<div style="flex:1;padding-bottom:' + (isLast ? '0' : '16') + 'px;">' +
        '<div style="font-size:11px;font-weight:700;color:#1E293B;">Step ' + (i + 1) + ': ' + s.title + '</div>' +
        '<div style="font-size:10px;color:#64748B;margin-top:3px;line-height:1.5;">' + s.desc + '</div>' +
      '</div>' +
    '</div>';
  }

  var html = '<div style="padding:4px 0;">' +
    // Header
    '<div style="background:linear-gradient(135deg,#7C2D12,#B45309);border-radius:12px;padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px;">' +
      '<div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:13px;font-weight:800;color:#fff;">Physical Certificate Collection</div>' +
        '<div style="font-size:9px;color:rgba(255,255,255,0.7);margin-top:2px;">' + serviceName + ' • ' + district + ' District</div>' +
      '</div>' +
    '</div>' +

    // Fee Card
    '<div style="background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:12px;padding:12px 14px;margin-bottom:14px;">' +
      '<div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:8px;">💰 Fee Structure</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<div style="flex:1;background:#fff;border-radius:8px;padding:8px;text-align:center;">' +
          '<div style="font-size:9px;color:#78716C;font-weight:600;">Normal</div>' +
          '<div style="font-size:16px;font-weight:900;color:#1E293B;">₹' + fees.base + '</div>' +
          '<div style="font-size:8px;color:#A8A29E;">3-5 working days</div>' +
        '</div>' +
        '<div style="flex:1;background:#fff;border-radius:8px;padding:8px;text-align:center;border:1px solid #FBBF24;">' +
          '<div style="font-size:9px;color:#D97706;font-weight:600;">Tatkal / Urgent</div>' +
          '<div style="font-size:16px;font-weight:900;color:#D97706;">₹' + fees.urgent + '</div>' +
          '<div style="font-size:8px;color:#A8A29E;">Same / next day</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Steps
    '<div style="background:#fff;border:1.5px solid #E2E8F0;border-radius:12px;padding:14px 16px;margin-bottom:14px;">' +
      '<div style="font-size:11px;font-weight:700;color:#1E293B;margin-bottom:12px;">📋 Steps to Collect</div>' +
      stepsHtml +
    '</div>' +

    // Important Note
    '<div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:10px;padding:10px 12px;margin-bottom:12px;">' +
      '<div style="font-size:9px;color:#1D4ED8;font-weight:600;">ℹ️ Important</div>' +
      '<div style="font-size:9px;color:#3B82F6;margin-top:3px;line-height:1.5;">MeeSeva centres are open Mon-Sat, 8:00 AM to 8:00 PM. Carry original Aadhaar for identity verification. Service fee is non-refundable.</div>' +
    '</div>' +

    // View Receipt + Close buttons
    '<div style="display:flex;gap:8px;">' +
      '<button id="phys-receipt-btn" class="btn" style="flex:1;border-radius:10px;background:#F1F5F9;color:#475569;font-weight:600;font-size:12px;">View Receipt</button>' +
      '<button class="btn btn-accent" style="flex:1;border-radius:10px;font-size:12px;" onclick="closeBottomSheet();">Done</button>' +
    '</div>' +
  '</div>';

  openBottomSheet('Physical Certificate', html, true);

  setTimeout(function() {
    var btn = document.getElementById('phys-receipt-btn');
    if (btn) btn.addEventListener('click', function() {
      showApplicationReceipt(data);
    });
  }, 50);
}


// ── Rejected Certificate Options (shows receipt with reason + apply again) ──
function showRejectedOptions(data) {
  showApplicationReceipt(data);
}

// 11. Schemes Recommendations
async function loadSchemesRecommendations() {
  const container = document.getElementById('schemes-items-container');
  container.innerHTML = '<div style="text-align:center;padding:30px;color:#94A3B8;font-size:12px;">Loading schemes...</div>';

  try {
    const list = await apiCall('/services/recommendations/list');
    if (!list || list.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#94A3B8;font-size:12px;">No schemes available.</div>';
      return;
    }

    const now = new Date();
    const categorySVG = {
      'Agriculture': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4-4 8-7.5 8-12a8 8 0 1 0-16 0c0 4.5 4 8 8 12z"/><path d="M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
      'Education': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
      'Entrepreneurship': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
      'Housing': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      'Health': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>',
      'Women & Child': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      'Senior Citizens': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      'Employment': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
      'General': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
    };
    const categoryColors = {
      'Agriculture': '#15803D', 'Education': '#1D4ED8', 'Entrepreneurship': '#9333EA',
      'Housing': '#B45309', 'Health': '#DC2626', 'Women & Child': '#DB2777',
      'Senior Citizens': '#4338CA', 'Employment': '#0F766E', 'General': '#475569'
    };

    // Collect unique categories
    const categories = ['All', ...new Set(list.map(item => item.scheme.category || 'General'))];
    let activeCategory = 'All';

    function daysAgoText(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      const diff = Math.floor((now - d) / 86400000);
      if (diff === 0) return 'Added today';
      if (diff === 1) return 'Added yesterday';
      if (diff <= 7) return `Added ${diff} days ago`;
      if (diff <= 30) return `${Math.floor(diff / 7)} weeks ago`;
      return `${Math.floor(diff / 30)} months ago`;
    }

    function isNew(dateStr) {
      if (!dateStr) return false;
      return (now - new Date(dateStr)) < 7 * 86400000;
    }

    function renderSchemes(filter) {
      const filtered = filter === 'All' ? list : list.filter(item => (item.scheme.category || 'General') === filter);
      const eligible = filtered.filter(i => i.is_eligible);
      const notEligible = filtered.filter(i => !i.is_eligible);

      // Stats bar
      let html = `
        <div style="display:flex;gap:8px;margin-bottom:14px;">
          <div style="flex:1;background:linear-gradient(135deg,#ECFDF5,#D1FAE5);border-radius:10px;padding:10px 12px;text-align:center;">
            <div style="font-size:20px;font-weight:800;color:#046A38;">${eligible.length}</div>
            <div style="font-size:9px;color:#065F46;font-weight:600;">Eligible</div>
          </div>
          <div style="flex:1;background:linear-gradient(135deg,#EFF6FF,#DBEAFE);border-radius:10px;padding:10px 12px;text-align:center;">
            <div style="font-size:20px;font-weight:800;color:#1A73E8;">${filtered.length}</div>
            <div style="font-size:9px;color:#1E40AF;font-weight:600;">Total Schemes</div>
          </div>
          <div style="flex:1;background:linear-gradient(135deg,#FFF7ED,#FED7AA);border-radius:10px;padding:10px 12px;text-align:center;">
            <div style="font-size:20px;font-weight:800;color:#D97706;">${filtered.filter(i => isNew(i.scheme.created_at)).length}</div>
            <div style="font-size:9px;color:#92400E;font-weight:600;">Newly Added</div>
          </div>
        </div>
      `;

      // Render eligible first, then others
      const sorted = [...eligible, ...notEligible];
      sorted.forEach((item, idx) => {
        const s = item.scheme;
        const cat = s.category || 'General';
        const catSvg = categorySVG[cat] || categorySVG['General'];
        const catColor = categoryColors[cat] || '#475569';
        const newBadge = isNew(s.created_at);
        const timeText = daysAgoText(s.created_at);
        const reasons = item.reasons || [];

        html += `
          <div class="scheme-card" style="animation:fadeInUp 0.3s ease ${idx * 0.05}s both;">
            <div class="scheme-title-row">
              <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                <div style="width:32px;height:32px;border-radius:8px;background:${item.is_eligible ? catColor : '#94A3B8'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  ${catSvg}
                </div>
                <div style="min-width:0;flex:1;">
                  <h5 style="margin:0;line-height:1.3;padding-right:4px;">${s.name}</h5>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:3px;flex-wrap:wrap;">
                    <span style="font-size:8px;color:#475569;background:#F1F5F9;padding:1px 6px;border-radius:4px;font-weight:600;">${cat}</span>
                    ${newBadge ? `<span style="background:#DC2626;color:#fff;font-size:7px;font-weight:800;padding:1px 5px;border-radius:4px;letter-spacing:0.3px;">NEW</span>` : ''}
                    ${timeText ? `<span style="font-size:8px;color:#94A3B8;">${timeText}</span>` : ''}
                  </div>
                </div>
              </div>
              <span class="eligibility-badge ${item.is_eligible ? 'eligible' : 'ineligible'}" style="margin-left:6px;flex-shrink:0;white-space:nowrap;">
                ${item.is_eligible ? '✓ Eligible' : 'Not Matched'}
              </span>
            </div>
            <p class="desc" style="margin-top:8px;">${s.description}</p>
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
              <div style="background:${item.is_eligible ? 'linear-gradient(135deg,#FFF7ED,#FFEDD5)' : '#F8FAFC'};border-radius:6px;padding:5px 10px;flex:1;">
                <span style="font-size:9px;color:#92400E;font-weight:600;">💰 ${s.benefit_amount}</span>
              </div>
            </div>
            <div style="margin-top:8px;font-size:10px;color:#94A3B8;">
              <span style="font-weight:600;color:#64748B;">Match: </span>${reasons.join(' · ')}
            </div>
          </div>
        `;
      });

      return html;
    }

    // Build full UI: filter tabs + scheme cards
    let fullHtml = `<div id="scheme-category-tabs" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;margin-bottom:4px;-webkit-overflow-scrolling:touch;">`;
    categories.forEach(cat => {
      fullHtml += `<button class="scheme-cat-btn${cat === activeCategory ? ' active' : ''}" data-cat="${cat}" style="flex-shrink:0;padding:6px 14px;border-radius:20px;border:1px solid ${cat === activeCategory ? '#046A38' : '#E2E8F0'};background:${cat === activeCategory ? '#046A38' : '#fff'};color:${cat === activeCategory ? '#fff' : '#475569'};font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;">${cat}</button>`;
    });
    fullHtml += `</div><div id="scheme-cards-area">${renderSchemes(activeCategory)}</div>`;

    container.innerHTML = fullHtml;

    // Wire category tabs
    container.querySelectorAll('.scheme-cat-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        activeCategory = this.dataset.cat;
        container.querySelectorAll('.scheme-cat-btn').forEach(b => {
          b.classList.remove('active');
          b.style.background = '#fff';
          b.style.color = '#475569';
          b.style.borderColor = '#E2E8F0';
        });
        this.classList.add('active');
        this.style.background = '#046A38';
        this.style.color = '#fff';
        this.style.borderColor = '#046A38';
        document.getElementById('scheme-cards-area').innerHTML = renderSchemes(activeCategory);
      });
    });

  } catch (e) {
    container.innerHTML = '<p style="text-align:center;padding:30px;color:#DC2626;font-size:12px;">Failed to load scheme matches.</p>';
  }
}

// AI Scheme Finder — uses copilot to answer scheme queries
function setupSchemesAI() {
  const askBtn = document.getElementById('schemes-ai-ask');
  const input = document.getElementById('schemes-ai-input');
  const responseDiv = document.getElementById('schemes-ai-response');
  if (!askBtn || !input) return;

  async function askSchemeAI() {
    const query = input.value.trim();
    if (!query) return;

    askBtn.disabled = true;
    askBtn.textContent = 'Thinking...';
    responseDiv.style.display = 'block';
    responseDiv.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span class="spinner" style="width:16px;height:16px;"></span> <span style="color:#64748B;font-size:11px;">Finding relevant schemes...</span></div>';

    try {
      const res = await apiCall('/copilot/chat', 'POST', {
        message: 'As a government welfare scheme expert, answer this citizen query about government schemes and benefits in India. Be specific about scheme names, eligibility, and how to apply. Query: ' + query,
        history: []
      });
      const reply = res.reply || 'Sorry, I could not find relevant information. Please try a different query.';
      // Format the reply with basic styling
      const formatted = reply
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\n/g, '<br>')
        .replace(/•/g, '&bull;');
      responseDiv.innerHTML = `
        <div style="margin-bottom:8px;">
          <span style="font-size:10px;font-weight:700;color:#046A38;text-transform:uppercase;letter-spacing:0.5px;">AI Response</span>
        </div>
        <div style="font-size:12px;line-height:1.7;color:#1E293B;">${formatted}</div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:9px;color:#94A3B8;">Powered by OneCitizen AI</span>
          <button onclick="document.getElementById('schemes-ai-response').style.display='none'" style="font-size:10px;color:#64748B;background:none;border:none;cursor:pointer;text-decoration:underline;">Dismiss</button>
        </div>
      `;
    } catch (err) {
      responseDiv.innerHTML = '<p style="color:#DC2626;font-size:11px;">Failed to get AI response. Please try again.</p>';
    }
    askBtn.disabled = false;
    askBtn.textContent = 'Ask AI';
  }

  askBtn.addEventListener('click', askSchemeAI);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') askSchemeAI();
  });
}

// Initialize the schemes AI when the page loads
document.addEventListener('DOMContentLoaded', () => {
  setupSchemesAI();
});

// 12. Leaflet Maps Locator Setup
// 12. Leaflet Maps Locator Setup
function requestUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        userLatitude = position.coords.latitude;
        userLongitude = position.coords.longitude;
        
        console.log(`GPS coordinates retrieved: ${userLatitude}, ${userLongitude}`);
        
        // Update active map if initialized
        if (activeMap) {
          activeMap.setView([userLatitude, userLongitude], 13);
        }
        
        try {
          // Fetch reverse geocoding from OSM Nominatim
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLatitude}&lon=${userLongitude}&zoom=12`, {
            headers: {
              'Accept': 'application/json'
            }
          });
          if (response.ok) {
            const data = await response.json();
            const addr = data.address || {};
            const city = addr.city || addr.town || addr.village || addr.suburb || addr.municipality || addr.county || 'Hyderabad';
            const state = addr.state || 'Telangana';
            userLocationName = `${city}, ${state}`;
            
            console.log(`Reverse geocoded location name: ${userLocationName}`);
            
            // Update UI elements
            updateLocationUI();
          }
        } catch (err) {
          console.warn('Failed to reverse geocode user coordinates:', err.message);
        }
      },
      (error) => {
        console.warn('Geolocation permission denied or failed. Fallback to simulation location.', error.message);
      }
    );
  }
}

function updateLocationUI() {
  const dashLoc = document.getElementById('dash-location-text');
  if (dashLoc) {
    dashLoc.innerText = userLocationName;
  }
  
  const twinLoc = document.getElementById('twin-summary-location');
  if (twinLoc && twinLoc.innerHTML.indexOf('Location Unlinked') === -1) {
    twinLoc.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px; vertical-align: middle;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> ${userLocationName}`;
  }
}

function initLeafletMap() {
  if (typeof L === 'undefined') return;
  if (activeMap) {
    setTimeout(() => {
      activeMap.invalidateSize();
    }, 100);
    return;
  }

  // Use the globally resolved user GPS coordinates
  let lat = userLatitude;
  let lon = userLongitude;

  // Initialize Map
  activeMap = L.map('leaflet-map').setView([lat, lon], 13);
  updateMapTiles();

  const gpsIcon = L.divIcon({
    className: 'gps-dot-container',
    html: '<div class="gps-dot-pulse"></div><div class="gps-dot-core"></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  // Pulsating Blue Dot representing user exact GPS Location
  L.marker([lat, lon], { icon: gpsIcon }).addTo(activeMap).bindPopup('My Location').openPopup();

  // Accuracy circle
  L.circle([lat, lon], {
    color: '#2196F3',
    fillColor: '#2196F3',
    fillOpacity: 0.15,
    weight: 1.5,
    radius: 120
  }).addTo(activeMap);

  // Load nearest MeeSeva centers relative to user GPS location
  loadMeeSevaCenters(lat, lon);
}

function updateMapTiles() {
  if (!activeMap) return;
  if (activeTileLayer) {
    activeMap.removeLayer(activeTileLayer);
  }
  const isDark = document.querySelector('.phone-chassis').classList.contains('dark-theme');
  const tileUrl = isDark 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  
  activeTileLayer = L.tileLayer(tileUrl, {
    maxZoom: 19,
    attribution: ' CARTO'
  }).addTo(activeMap);
}

async function loadMeeSevaCenters(lat, lon) {
  const container = document.getElementById('centers-items-container');
  container.innerHTML = '';

  // Clear existing markers
  if (activeMap) {
    activeMarkers.forEach(m => activeMap.removeLayer(m));
    activeMarkers = [];
  }

  try {
    const centers = await apiCall(`/meeseva/locate?latitude=${lat}&longitude=${lon}`);
    
    centers.forEach((c, idx) => {
      let marker = null;
      // Put marker on Leaflet Map
      if (activeMap) {
        const meesevaIcon = L.divIcon({
          className: 'meeseva-div-icon',
          html: MEESEVA_PIN_SVG,
          iconSize: [32, 38],
          iconAnchor: [16, 38],
          popupAnchor: [0, -34]
        });

        marker = L.marker([c.latitude, c.longitude], { icon: meesevaIcon })
          .addTo(activeMap)
          .bindPopup(`<b>${c.name}</b><br>${c.address}<br>¸ Wait: ${c.wait_time}`);
        
        marker.on('click', () => {
          selectMeeSevaCenter(c, marker, idx);
        });

        activeMarkers.push(marker);
      }

      // Add to list under map
      const card = document.createElement('div');
      card.className = 'center-card';
      card.setAttribute('data-index', idx);
      card.innerHTML = `
        <div class="center-card-header">
          <h5>${c.name}</h5>
          <span class="dist">${c.distance} km</span>
        </div>
        <p class="addr">${c.address}</p>
        <div class="center-meta-row">
          <span> ${c.rating} Rating</span>
          <span>¸ Wait: ${c.wait_time}</span>
        </div>
      `;

      // Card click interactive panning and popup trigger
      card.addEventListener('click', () => {
        selectMeeSevaCenter(c, marker, idx);
      });

      container.appendChild(card);
    });

    // Auto-select Himayatnagar or default first
    const himayatnagar = centers.find(c => c.name.toLowerCase().includes('himayatnagar'));
    if (himayatnagar) {
      const idx = centers.indexOf(himayatnagar);
      selectMeeSevaCenter(himayatnagar, activeMarkers[idx], idx);
    } else if (centers.length > 0) {
      selectMeeSevaCenter(centers[0], activeMarkers[0], 0);
    }
  } catch (e) {
    container.innerHTML = '<p>Failed to locate centers.</p>';
  }
}

function selectMeeSevaCenter(c, marker, idx) {
  // Update floating bottom card
  const floatCard = document.getElementById('locator-floating-card');
  if (floatCard) {
    document.getElementById('float-center-name').innerText = c.name;
    document.getElementById('float-center-dist').innerText = `${c.distance} km`;
    document.getElementById('float-center-rating').innerText = `${c.rating} `;
    document.getElementById('float-center-reviews').innerText = `(${50 + Math.round(c.latitude * 1000) % 150} reviews)`;
    document.getElementById('float-center-addr').innerText = c.address;
    
    // Wire up Directions button to open Google Maps navigation route
    const btnDirections = document.getElementById('btn-float-directions');
    if (btnDirections) {
      const newBtn = btnDirections.cloneNode(true);
      btnDirections.parentNode.replaceChild(newBtn, btnDirections);
      
      newBtn.addEventListener('click', () => {
        const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${userLatitude},${userLongitude}&destination=${c.latitude},${c.longitude}&travelmode=driving`;
        window.open(gmapsUrl, '_blank');
      });
    }
  }

  // Update card active class in list
  document.querySelectorAll('.center-card').forEach(cc => {
    cc.classList.remove('active-center');
  });
  const selectedCard = document.querySelector(`.center-card[data-index="${idx}"]`);
  if (selectedCard) {
    selectedCard.classList.add('active-center');
  }

  if (activeMap && marker) {
    activeMap.setView([c.latitude, c.longitude], 15, { animate: true, duration: 1.0 });
    marker.openPopup();
  }
}

// 13. Notifications alerts
async function loadNotifications() {
  const container = document.getElementById('notifications-items-container');
  container.innerHTML = '<div style="text-align:center;padding:30px;color:#94A3B8;font-size:12px;">Loading...</div>';

  let docs = [];
  let recommendations = [];
  try {
    docs = await apiCall('/documents');
  } catch (e) { console.warn('Failed to load docs for notifications:', e.message); }
  try {
    recommendations = await apiCall('/services/recommendations/list');
  } catch (e) { console.warn('Failed to load recommendations for notifications:', e.message); }

  const notifications = [];
  const now = new Date();

  // SVG icon helpers (white on colored circle)
  const notifSVGs = {
    approved: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    rejected: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    review: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    submitted: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    scheme: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    verified: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    profile: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
  };
  const notifColors = { success: '#046A38', error: '#DC2626', warning: '#D97706', info: '#1A73E8', reminder: '#7C3AED' };

  // Helper: relative time — uses current client time as baseline
  function relativeTime(date) {
    if (!date) return 'Recent';
    // SQLite datetime('now') returns UTC without 'Z' — force UTC parsing
    let ds = String(date);
    if (!ds.endsWith('Z') && !ds.includes('+') && !ds.includes('T')) ds = ds.replace(' ', 'T') + 'Z';
    else if (!ds.endsWith('Z') && !ds.includes('+')) ds += 'Z';
    const d = new Date(ds);
    if (isNaN(d.getTime())) return 'Recent';
    const diffMs = now - d;
    if (diffMs < 0) return 'Just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    return `${days}d ago`;
  }

  // 1. Application status notifications
  try {
    const apps = await apiCall('/services/user-applications');
    if (apps && apps.length > 0) {
      apps.forEach(app => {
        const sName = app.service_name || 'Application';
        const time = relativeTime(app.updated_at || app.created_at);
        if (app.status === 'approved') {
          notifications.push({ svg: notifSVGs.approved, title: `${sName} Approved`, desc: 'Your application has been approved by the reviewing officer.', time, type: 'success' });
        } else if (app.status === 'rejected') {
          notifications.push({ svg: notifSVGs.rejected, title: `${sName} Rejected`, desc: app.officer_notes ? `Reason: ${app.officer_notes}` : 'Your application was rejected. Please check details.', time, type: 'error' });
        } else if (app.status === 'under_review') {
          notifications.push({ svg: notifSVGs.review, title: `${sName} Under Review`, desc: 'An officer is currently reviewing your application.', time, type: 'info' });
        } else {
          notifications.push({ svg: notifSVGs.submitted, title: `${sName} Submitted`, desc: 'Your application has been submitted and is pending review.', time, type: 'info' });
        }
      });
    }
  } catch (e) {}

  // 2. Document expiry warnings (based on actual expiry date)
  if (docs && docs.length > 0) {
    docs.forEach(doc => {
      if (doc.is_verified) {
        const ed = typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : (doc.extracted_data || {});
        const expiryStr = ed.expiry || ed.validity_date || '';
        if (!expiryStr || expiryStr === 'Permanent') return;
        const parts = expiryStr.split('/');
        let expiryDate;
        if (parts.length === 3) expiryDate = new Date(parts[2], parts[1] - 1, parts[0]);
        else expiryDate = new Date(expiryStr);
        if (isNaN(expiryDate.getTime())) return;
        
        const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry <= 30 && daysUntilExpiry > -90) {
          const docName = getDocumentTitle(doc.document_type);
          const urgency = daysUntilExpiry <= 0 
            ? 'has expired! Renew immediately.' 
            : daysUntilExpiry === 1 
              ? 'expires tomorrow! Renew now.' 
              : `expires in ${daysUntilExpiry} days. Renew soon.`;
          notifications.push({
            svg: notifSVGs.warning,
            title: `${docName} ${daysUntilExpiry <= 0 ? 'Expired' : 'Expiring Soon'}`,
            desc: `Your ${docName.toLowerCase()} ${urgency}`,
            time: daysUntilExpiry <= 0 ? 'Urgent' : `${daysUntilExpiry}d left`,
            type: 'warning'
          });
        }
      }
    });
  }

  // 3. Eligible schemes — only show if user has at least 1 verified document
  const hasAnyVerifiedDoc = docs && docs.some(d => d.is_verified === 1);
  if (hasAnyVerifiedDoc && recommendations.length > 0) {
    const eligible = recommendations.filter(r => r.is_eligible);
    if (eligible.length > 0) {
      // Find the newest scheme by created_at to show dynamic time
      const newestScheme = eligible
        .filter(r => r.scheme.created_at)
        .sort((a, b) => new Date(b.scheme.created_at) - new Date(a.scheme.created_at))[0];
      const schemeTime = newestScheme ? relativeTime(newestScheme.scheme.created_at) : relativeTime(new Date().toISOString());
      notifications.push({
        svg: notifSVGs.scheme,
        title: `Eligible for ${eligible.length} scheme${eligible.length > 1 ? 's' : ''}`,
        desc: `Based on your profile: ${eligible.slice(0, 3).map(r => r.scheme.name).join(', ')}${eligible.length > 3 ? ` +${eligible.length - 3} more` : ''}.`,
        time: schemeTime,
        type: 'success'
      });
    }
  }

  // 4. Latest verified doc
  if (docs && docs.length > 0) {
    const verifiedDocs = docs.filter(d => d.is_verified === 1);
    if (verifiedDocs.length > 0) {
      const latest = verifiedDocs.sort((a,b) => new Date(b.uploaded_at || b.created_at) - new Date(a.uploaded_at || a.created_at))[0];
      notifications.push({
        svg: notifSVGs.verified,
        title: `${getDocumentTitle(latest.document_type)} Verified`,
        desc: `Your document has been verified and stored in your vault.`,
        time: relativeTime(latest.uploaded_at || latest.created_at),
        type: 'info'
      });
    }
  }

  // 5. Profile completeness
  if (docs && docs.length > 0 && docs.length < 3) {
    notifications.push({
      svg: notifSVGs.profile,
      title: 'Complete Your Profile',
      desc: `Upload more documents to unlock scheme recommendations. ${3 - docs.length} more needed.`,
      time: 'Tip',
      type: 'info'
    });
  }

  // Render
  if (notifications.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:50px 20px;color:#94A3B8;">
        <div style="font-size:14px;font-weight:600;">No Notifications</div>
      </div>
    `;
    updateBellBadge(0);
    return;
  }

  container.innerHTML = notifications.map((n, i) => `
    <div class="notification-item notif-swipeable" data-notif-idx="${i}" style="position:relative;overflow:hidden;transition:transform 0.25s ease, opacity 0.25s ease;">
      <div style="display:flex;align-items:flex-start;gap:10px;width:100%;">
        <div style="width:32px;height:32px;border-radius:10px;background:${notifColors[n.type] || '#1A73E8'};display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px ${notifColors[n.type] || '#1A73E8'}33;">
          ${n.svg}
        </div>
        <div class="notif-body" style="flex:1;min-width:0;">
          <h5>${n.title}</h5>
          <p>${n.desc}</p>
          <span class="time">${n.time}</span>
        </div>
      </div>
    </div>
  `).join('');
  // Mark current count as seen
  localStorage.setItem('oc_notif_seen_count', String(notifications.length));
  updateBellBadge(0);

  // Wire swipe-to-dismiss on each notification item
  container.querySelectorAll('.notif-swipeable').forEach(item => {
    let sx = 0;
    item.addEventListener('touchstart', e => { sx = e.touches[0].clientX; item.style.transition = 'none'; }, { passive: true });
    item.addEventListener('touchmove', e => {
      const dx = e.touches[0].clientX - sx;
      if (dx < 0) item.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    item.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx;
      if (dx < -80) {
        item.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        item.style.transform = 'translateX(-120%)';
        item.style.opacity = '0';
        setTimeout(() => { item.style.height = item.offsetHeight + 'px'; item.style.overflow = 'hidden'; requestAnimationFrame(() => { item.style.transition = 'height 0.2s ease, margin 0.2s ease, padding 0.2s ease'; item.style.height = '0'; item.style.margin = '0'; item.style.padding = '0'; }); setTimeout(() => item.remove(), 200); }, 200);
      } else {
        item.style.transition = 'transform 0.2s ease';
        item.style.transform = '';
      }
    });
  });
}

// Update bell badge count on dashboard
function updateBellBadge(count) {
  const badge = document.getElementById('bell-badge-count');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// Push notification popup (slides in from top like a real mobile notification)
function showNotificationPopup(title, body, type) {
  // Check if push notifications are enabled
  if (localStorage.getItem('pref_push') === 'off') return;
  
  // Remove any existing popup
  const existing = document.querySelector('.notif-popup');
  if (existing) existing.remove();
  
  const typeConfig = {
    success: { icon: '✅', accent: '#046A38', bg: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)', border: '#A7F3D0', label: 'OneCitizen' },
    warning: { icon: '⚠️', accent: '#D97706', bg: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)', border: '#FDE68A', label: 'OneCitizen' },
    error:   { icon: '❌', accent: '#DC2626', bg: 'linear-gradient(135deg, #FEF2F2 0%, #FECACA 100%)', border: '#FCA5A5', label: 'OneCitizen' },
    info:    { icon: '📋', accent: '#1A73E8', bg: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)', border: '#93C5FD', label: 'OneCitizen' },
    reminder:{ icon: '🔔', accent: '#7C3AED', bg: 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)', border: '#C4B5FD', label: 'OneCitizen' }
  };
  const cfg = typeConfig[type] || typeConfig.info;
  
  const popup = document.createElement('div');
  popup.className = 'notif-popup';
  popup.innerHTML = `
    <div class="notif-popup-inner" style="background:${cfg.bg};border:1px solid ${cfg.border};position:relative;overflow:hidden;">
      <div style="padding-left:4px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="width:18px;height:18px;border-radius:5px;background:${cfg.accent};display:flex;align-items:center;justify-content:center;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
            </div>
            <span style="font-size:10px;font-weight:700;color:${cfg.accent};text-transform:uppercase;letter-spacing:0.5px;">${cfg.label}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:9px;color:#94A3B8;">now</span>
            <button onclick="this.closest('.notif-popup').remove()" style="background:none;border:none;color:#94A3B8;font-size:14px;cursor:pointer;padding:0;line-height:1;width:18px;height:18px;display:flex;align-items:center;justify-content:center;">×</button>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <span style="font-size:18px;line-height:1;flex-shrink:0;margin-top:1px;">${cfg.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:#0F172A;margin-bottom:2px;line-height:1.3;">${title}</div>
            <div style="font-size:11px;color:#475569;line-height:1.4;">${body}</div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Insert inside phone chassis if it exists, else body
  const phone = document.querySelector('.phone-chassis');
  if (phone) {
    popup.style.position = 'absolute';
    phone.style.position = 'relative';
    phone.appendChild(popup);
  } else {
    document.body.appendChild(popup);
  }

  // Swipe up to dismiss
  let startY = 0;
  popup.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  popup.addEventListener('touchmove', e => {
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) popup.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  popup.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - startY;
    if (dy < -40) { popup.style.transition = 'transform 0.2s, opacity 0.2s'; popup.style.transform = 'translateY(-100%)'; popup.style.opacity = '0'; setTimeout(() => popup.remove(), 200); }
    else { popup.style.transform = ''; }
  });
  
  // Auto-dismiss after 5 seconds
  setTimeout(() => { if (popup.parentNode) { popup.style.transition = 'transform 0.3s, opacity 0.3s'; popup.style.transform = 'translateY(-100%)'; popup.style.opacity = '0'; setTimeout(() => popup.remove(), 300); } }, 5000);
}

// Real-time status polling — checks for application status changes every 10s
let _lastAppStatuses = {};
let _statusPollTimer = null;

function startStatusPolling() {
  if (_statusPollTimer) clearInterval(_statusPollTimer);
  _statusPollTimer = setInterval(async () => {
    try {
      const apps = await apiCall('/services/user-applications');
      if (!apps || !Array.isArray(apps)) return;
      
      apps.forEach(app => {
        const prevStatus = _lastAppStatuses[app.id];
        const curStatus = app.status;
        
        if (prevStatus && prevStatus !== curStatus) {
          // Status changed! Show notification
          const serviceName = app.service_name || 'Application';
          if (curStatus === 'approved') {
            showNotificationPopup('Application Approved! ✅', `Your ${serviceName} has been approved.`, 'success');
          } else if (curStatus === 'rejected') {
            showNotificationPopup('Application Rejected', `Your ${serviceName} has been rejected. ${app.officer_notes ? 'Reason: ' + app.officer_notes : ''}`, 'error');
          } else if (curStatus === 'under_review') {
            showNotificationPopup('Under Review', `Your ${serviceName} is now being reviewed by an officer.`, 'info');
          }
          
          // Update the UI immediately
          loadDashboardData();
        }
        
        _lastAppStatuses[app.id] = curStatus;
      });
    } catch (e) { /* silent */ }
  }, 30000);
}

function stopStatusPolling() {
  if (_statusPollTimer) { clearInterval(_statusPollTimer); _statusPollTimer = null; }
}

// Renewal reminder notifications for expiring documents
let _renewalReminderTimer = null;

async function startRenewalReminders() {
  // Run once immediately, then every 60 seconds
  await checkRenewalReminders();
  if (_renewalReminderTimer) clearInterval(_renewalReminderTimer);
  _renewalReminderTimer = setInterval(checkRenewalReminders, 60000);
}

async function checkRenewalReminders() {
  if (localStorage.getItem('pref_push') === 'off') return;
  try {
    const docs = await apiCall('/documents');
    if (!docs || docs.length === 0) return;
    const now = new Date();
    const shownKey = 'renewal_reminders_shown';
    const shown = JSON.parse(localStorage.getItem(shownKey) || '{}');
    
    docs.forEach(doc => {
      if (!doc.is_verified) return;
      const ed = typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : (doc.extracted_data || {});
      const expiryStr = ed.expiry || ed.validity_date;
      if (!expiryStr || expiryStr === 'Permanent') return;
      
      // Parse expiry date
      const parts = expiryStr.split('/');
      let expiryDate;
      if (parts.length === 3) expiryDate = new Date(parts[2], parts[1] - 1, parts[0]);
      else expiryDate = new Date(expiryStr);
      if (isNaN(expiryDate.getTime())) return;
      
      const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      const docName = getDocumentTitle(doc.document_type);
      const reminderKey = `${doc.document_type}_${expiryStr}`;
      const lastShown = shown[reminderKey] ? new Date(shown[reminderKey]) : null;
      const hoursSinceShown = lastShown ? (now - lastShown) / (1000 * 60 * 60) : 999;
      
      // Show reminder max once per 6 hours
      if (hoursSinceShown < 6) return;
      
      if (daysLeft <= 0 && daysLeft > -90) {
        showNotificationPopup('Document Expired 🔴', `Your ${docName} expired on ${expiryStr}. Please renew it as soon as possible.`, 'warning');
        shown[reminderKey] = now.toISOString();
      } else if (daysLeft <= 30 && daysLeft > 0) {
        showNotificationPopup('Renewal Reminder 🔔', `Your ${docName} expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}. Renew soon to avoid disruption.`, 'reminder');
        shown[reminderKey] = now.toISOString();
      }
    });
    
    localStorage.setItem(shownKey, JSON.stringify(shown));
  } catch (e) { /* silent */ }
}

// checkNotificationCount removed — badge is now managed by loadDashboardData preload + loadNotifications seen tracking

// 14. Life Event Input
function setupCopilot() {
  const btnSend = document.getElementById('btn-copilot-send');
  const chatInput = document.getElementById('copilot-chat-input');
  const chatHistory = document.getElementById('copilot-chat-history');
  const suggestions = document.getElementById('copilot-suggestions');
  const btnBack = document.getElementById('copilot-back');

  // Conversation history for context
  window.copilotHistory = window.copilotHistory || [];

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      switchScreen('screen-dashboard');
    });
  }

  if (btnSend && chatInput) {
    btnSend.addEventListener('click', () => {
      handleCopilotMessageSend();
    });

    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleCopilotMessageSend();
      }
    });
  }

  if (suggestions) {
    suggestions.querySelectorAll('.copilot-chip-card').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        if (query) {
          sendCopilotQuery(query);
        }
      });
    });
  }

  async function handleCopilotMessageSend() {
    const query = chatInput.value.trim();
    if (!query) return;
    chatInput.value = '';
    await sendCopilotQuery(query);
  }

  async function sendCopilotQuery(query) {
    addChatMessage('user', query);
    window.copilotHistory.push({ role: 'user', text: query });

    // Hide suggestions after first message
    if (suggestions) suggestions.style.display = 'none';

    const indicator = showTypingIndicator();

    try {
      const res = await apiCall('/copilot/chat', 'POST', {
        message: query,
        history: window.copilotHistory.slice(-8)
      });

      removeTypingIndicator(indicator);

      const reply = res.reply || "I'm sorry, I couldn't process that. Could you try asking in a different way?";
      window.copilotHistory.push({ role: 'bot', text: reply });

      // Type out the response character by character for human feel
      await typeOutMessage(reply);

      // Auto-append "Apply Now" button for service-related queries
      const ql = query.toLowerCase();
      const serviceKeywords = ['certificate', 'certif', 'apply', 'get', 'need', 'want', 'how to', 'ews', 'income', 'caste', 'residence', 'birth', 'death', 'marriage', 'passport', 'driving', 'license', 'licence', 'voter', 'pan card', 'ration', 'pension', 'scholarship', 'housing', 'awas', 'scheme', 'eligible', 'rti', 'land', 'dharani'];
      const isServiceQuery = serviceKeywords.some(k => ql.includes(k));
      
      if (isServiceQuery) {
        const chatHistory = document.getElementById('copilot-chat-history');
        const lastBotMsg = chatHistory?.querySelector('.bot-msg:last-child .bot-msg-bubble');
        if (lastBotMsg) {
          const btnWrap = document.createElement('div');
          btnWrap.style.cssText = 'margin-top: 10px; display: flex; gap: 8px;';
          btnWrap.innerHTML = '<button class="btn-sm btn-apply-green" style="padding: 8px 16px; font-size: 11px; font-weight: 700; border-radius: 8px; border: none; background: #046A38; color: #fff; cursor: pointer; display: flex; align-items: center; gap: 5px;" id="copilot-apply-btn"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> Apply Now</button>';
          btnWrap.querySelector('#copilot-apply-btn').addEventListener('click', async function() {
            // Find matching service from query keywords
            if (allServices.length === 0) { try { allServices = await apiCall('/services'); } catch(e){} }
            var matched = null;
            var qlw = ql;
            // Keyword-to-service mapping for accurate matching
            var keywordMap = [
              { keywords: ['income', 'income cert'], service: 'Income Certificate' },
              { keywords: ['caste', 'community', 'sc ', 'st ', 'obc'], service: 'Caste Certificate' },
              { keywords: ['ews', 'economically weaker'], service: 'EWS Certificate' },
              { keywords: ['birth', 'birth cert'], service: 'Birth Certificate' },
              { keywords: ['death', 'death cert'], service: 'Death Certificate' },
              { keywords: ['pension', 'old age', 'aasara'], service: 'Old Age Pension' },
              { keywords: ['business', 'registration', 'trade'], service: 'Business Registration' },
              { keywords: ['marriage', 'marriage cert'], service: 'Marriage Certificate' },
              { keywords: ['residence', 'domicile'], service: 'Residence Certificate' },
              { keywords: ['passport'], service: 'Passport' },
              { keywords: ['driving', 'license', 'licence', 'dl '], service: 'Driving License' },
              { keywords: ['voter', 'voter id', 'election'], service: 'Voter ID' },
              { keywords: ['pan card', 'pan '], service: 'PAN Card' },
              { keywords: ['ration', 'ration card'], service: 'Ration Card' },
              { keywords: ['scholarship', 'student'], service: 'Post-Matric Scholarship Scheme' },
            ];
            // Find by keyword match
            for (var k = 0; k < keywordMap.length; k++) {
              for (var kw = 0; kw < keywordMap[k].keywords.length; kw++) {
                if (qlw.includes(keywordMap[k].keywords[kw])) {
                  // Find the service by name
                  for (var s = 0; s < allServices.length; s++) {
                    if (allServices[s].name.toLowerCase().includes(keywordMap[k].service.toLowerCase())) { matched = allServices[s]; break; }
                  }
                  if (matched) break;
                }
              }
              if (matched) break;
            }
            // Fallback: try matching any word from query against service names
            if (!matched) {
              var words = qlw.split(/\s+/);
              for (var w = 0; w < words.length; w++) {
                if (words[w].length < 4) continue;
                for (var s = 0; s < allServices.length; s++) {
                  if (allServices[s].name.toLowerCase().includes(words[w])) { matched = allServices[s]; break; }
                }
                if (matched) break;
              }
            }
            if (!matched && allServices.length > 0) matched = allServices[0];
            if (matched) { showServiceDetails(matched); }
          });
          lastBotMsg.appendChild(btnWrap);
          chatHistory.scrollTop = chatHistory.scrollHeight;
        }
      }

    } catch (err) {
      removeTypingIndicator(indicator);
      const fallback = "I'm having a moment!  Could you try again? If this keeps happening, check your connection.";
      addChatMessage('bot', fallback, true);
    }
  }
}

// Type out bot message word by word for human feel
async function typeOutMessage(text) {
  const history = document.getElementById('copilot-chat-history');
  if (!history) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message bot-msg';
  msgDiv.innerHTML = `
    <div class="bot-avatar-img-wrap" style="background-color: transparent;">
      <img src="copilot_robot.png" alt="bot avatar" style="width: 32px; height: 32px; object-fit: contain;">
    </div>
    <div class="bot-msg-bubble">
      <p id="typing-target"></p>
    </div>
  `;
  history.appendChild(msgDiv);

  const target = document.getElementById('typing-target');
  if (!target) return;

  // Split into lines, then words
  const lines = text.split('\n');
  let fullHtml = '';

  for (let li = 0; li < lines.length; li++) {
    if (li > 0) {
      fullHtml += '<br>';
      target.innerHTML = fullHtml;
      history.scrollTop = history.scrollHeight;
      await new Promise(r => setTimeout(r, 40));
    }

    const words = lines[li].split(/\s+/).filter(w => w.length > 0);
    for (let wi = 0; wi < words.length; wi++) {
      fullHtml += (wi > 0 ? ' ' : '') + words[wi];
      target.innerHTML = fullHtml;
      history.scrollTop = history.scrollHeight;

      const hasEnd = /[.!?:,]$/.test(words[wi]);
      const delay = hasEnd ? 70 : 20 + Math.random() * 15;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  target.removeAttribute('id');
  history.scrollTop = history.scrollHeight;
}

function addChatMessage(sender, text, isHtml = false) {
  const history = document.getElementById('copilot-chat-history');
  if (!history) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${sender === 'user' ? 'user-msg' : 'bot-msg'}`;

  if (sender === 'bot') {
    msgDiv.innerHTML = `
      <div class="bot-avatar-img-wrap" style="background-color: transparent;">
        <img src="copilot_robot.png" alt="bot avatar" style="width: 32px; height: 32px; object-fit: contain;">
      </div>
      <div class="bot-msg-bubble">
        <p>${isHtml ? text : escapeHTML(text).replace(/\n/g, '<br>')}</p>
      </div>
    `;
  } else {
    msgDiv.innerHTML = `
      <div class="user-msg-bubble">
        <p>${escapeHTML(text).replace(/\n/g, '<br>')}</p>
      </div>
    `;
  }

  history.appendChild(msgDiv);
  history.scrollTop = history.scrollHeight;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function showTypingIndicator() {
  const history = document.getElementById('copilot-chat-history');
  if (!history) return null;

  const indicator = document.createElement('div');
  indicator.className = 'chat-message bot-msg typing-indicator-msg';
  indicator.innerHTML = `
    <div class="bot-avatar-img-wrap" style="background-color: transparent;">
      <img src="copilot_robot.png" alt="bot avatar" style="width: 32px; height: 32px; object-fit: contain;">
    </div>
    <div class="bot-msg-bubble" style="padding: 10px 14px;">
      <div class="typing-dots" style="display: flex; gap: 4px; align-items: center; height: 12px;">
        <span style="width: 6px; height: 6px; background-color: #94A3B8; border-radius: 50%; animation: pulse 1s infinite alternate;"></span>
        <span style="width: 6px; height: 6px; background-color: #94A3B8; border-radius: 50%; animation: pulse 1s infinite alternate; animation-delay: 0.2s;"></span>
        <span style="width: 6px; height: 6px; background-color: #94A3B8; border-radius: 50%; animation: pulse 1s infinite alternate; animation-delay: 0.4s;"></span>
      </div>
    </div>
  `;
  history.appendChild(indicator);
  history.scrollTop = history.scrollHeight;
  return indicator;
}

function removeTypingIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator);
  }
}

window.startCopilotApplication = async (serviceName) => {
  try {
    const services = await apiCall('/services');
    const match = services.find(s => s.name.toLowerCase().includes(serviceName.toLowerCase()));
    if (match) {
      switchScreen('screen-services');
      showServiceDetails(match);
    } else {
      switchScreen('screen-services');
    }
  } catch (e) {
    switchScreen('screen-services');
  }
};

function showLifeEventCopilotResult(res) {
  const title = `AI Copilot Analysis: ${res.service_name}`;
  const docs = res.required_documents || [];
  const schemes = res.recommended_schemes || [];
  const steps = res.application_steps || [];

  let html = `
    <h4 class="checklist-title">Required Documents</h4>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom: 15px;">
  `;
  docs.forEach(d => {
    html += `<span class="btn-sm">${d.toUpperCase()}</span>`;
  });
  
  html += `</div><h4 class="checklist-title">Eligible Schemes</h4><ul>`;
  schemes.forEach(s => {
    html += `<li style="color:var(--success-emerald); font-weight:700; margin-bottom:6px;"> ${s}</li>`;
  });

  html += `</ul><h4 class="checklist-title" style="margin-top:15px;">Remediation Action Steps</h4><ol style="padding-left:15px;">`;
  steps.forEach(st => {
    html += `<li style="margin-bottom:6px;">${st}</li>`;
  });
  html += `</ol>`;

  html += `<button class="btn btn-primary" id="sheet-btn-copilot-go" style="width:100%; margin-top:20px;">Start Application</button>`;

  openBottomSheet(title, html);

  document.getElementById('sheet-btn-copilot-go').addEventListener('click', () => {
    closeBottomSheet();
    // Switch to catalog
    switchScreen('screen-services');
  });
}

async function simulateLifeEventAI(query) {
  const sit = query.toLowerCase();
  let name = "Income Certificate";
  let docs = ["aadhaar", "address"];
  let schemes = ["PM Awas Yojana (Rural Subsidy)"];
  let steps = ["Verify income registry", "Obtain self-declaration stamp", "Register package at local Tahsildar desk"];

  if (sit.includes("college") || sit.includes("education") || sit.includes("engineering") || sit.includes("study")) {
    name = "Post-Matric Scholarship Scheme";
    docs = ["aadhaar", "income", "caste", "degree"];
    schemes = ["Post-Matric Scholarship Scheme"];
    steps = ["Get admission fee structure receipt", "Authenticate Caste Certificate in Vault", "Check application verification steps"];
  } else if (sit.includes("bakery") || sit.includes("business") || sit.includes("shop") || sit.includes("startup")) {
    name = "Business Registration";
    docs = ["pan", "aadhaar", "address"];
    schemes = ["Startup India Seed Fund Scheme"];
    steps = ["Verify corporate trade name classification", "Upload business address certification", "Lodge at Municipal desk"];
  } else if (sit.includes("farmer") || sit.includes("crop") || sit.includes("agriculture")) {
    name = "PM-KISAN Farmer Registration";
    docs = ["aadhaar", "address"];
    schemes = ["PM-KISAN (Farmer Income Support)"];
    steps = ["Upload land title certificate", "Verify bank account linkages", "Authenticate coordinates of fields"];
  }
  return {
    service_name: name,
    required_documents: docs,
    recommended_schemes: schemes,
    application_steps: steps
  };
}

// 15. Admin Portal Console Renders (Live desktop updates)
async function loadAdminDashboard() {
  try {
    // If not authenticated yet, wait
    if (!authToken) return;

    const adminElement = document.getElementById('admin-val-citizens');
    if (!adminElement) return;

    // Fetch stats
    const stats = await apiCall('/admin/analytics');
    
    adminElement.innerText = stats.total_citizens;
    
    const adminApps = document.getElementById('admin-val-apps');
    if (adminApps) adminApps.innerText = stats.total_applications;
    
    const adminDocs = document.getElementById('admin-val-docs');
    if (adminDocs) adminDocs.innerText = stats.total_documents_vaulted;
    
    const adminPrev = document.getElementById('admin-val-prevention');
    if (adminPrev) adminPrev.innerText = `${stats.rejection_prevention_rate}%`;

    // Render Table Queue
    loadAdminQueue();

    // Render Service usages breakdown chart
    const chartContainer = document.getElementById('admin-service-chart');
    if (chartContainer) {
      chartContainer.innerHTML = '';
      
      const usage = stats.service_usage || [];
      const maxVal = Math.max(...usage.map(u => u.count), 1);

      usage.forEach(item => {
        const pctWidth = (item.count / maxVal) * 100;
        const bar = document.createElement('div');
        bar.className = 'chart-bar-item';
        bar.innerHTML = `
          <div class="chart-bar-label">
            <span>${item.name}</span>
            <span>${item.count} Submissions</span>
          </div>
          <div class="chart-bar-bg">
            <div class="chart-bar-fill" style="width: ${pctWidth}%"></div>
          </div>
        `;
        chartContainer.appendChild(bar);
      });
    }

  } catch (err) {
    console.warn("Admin panel stats fetch bypassed (requires Admin role token). Message:", err.message);
  }
}

async function loadAdminQueue() {
  const tbody = document.getElementById('admin-apps-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading packages queue...</td></tr>';

  try {
    const list = await apiCall('/admin/applications');
    tbody.innerHTML = '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Queue empty. No applications filed.</td></tr>';
      return;
    }

    list.forEach(app => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${app.id}</b></td>
        <td>${app.citizen_name}</td>
        <td>${app.service_name}</td>

        <td><span style="color:${app.status === 'pending' ? 'orange' : 'green'}">${app.status.toUpperCase()}</span></td>
        <td>
          <button class="btn-sm btn-admin-pdf" style="font-size: 9px; padding: 4px 8px;">View Receipt</button>
        </td>
      `;

      var pdfBtn = tr.querySelector('.btn-admin-pdf');
      if (pdfBtn) {
        pdfBtn.addEventListener('click', () => {
          window.open(`${window.location.origin}/api/applications/download/${app.package_pdf_path}`);
        });
      }

      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Unauthorized to read registrar queue (Citizen view only).</td></tr>';
  }
}

// 15.5 Camera Capture  live viewfinder inside the phone
function openCameraCapture(fileInput) {
  const phoneScreen = document.querySelector('.phone-screen');
  if (!phoneScreen) return;

  const overlay = document.createElement('div');
  overlay.id = 'camera-capture-overlay';
  overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:#000; z-index:9999; display:flex; flex-direction:column;';

  overlay.innerHTML = `
    <div style="flex:1; position:relative; overflow:hidden;">
      <video id="cam-video" autoplay playsinline style="width:100%; height:100%; object-fit:cover;"></video>
      <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:80%; height:55%; border:2px solid rgba(255,255,255,0.4); border-radius:12px; pointer-events:none;"></div>
      <p style="position:absolute; top:12px; left:0; width:100%; text-align:center; color:rgba(255,255,255,0.7); font-size:11px; font-weight:600;">Align document within the frame</p>
    </div>
    <div style="display:flex; align-items:center; justify-content:center; gap:30px; padding:16px 0 24px; background:#111;">
      <button id="cam-cancel" style="background:none; border:1px solid rgba(255,255,255,0.3); color:#fff; font-size:12px; font-weight:600; padding:10px 20px; border-radius:25px; cursor:pointer;">Cancel</button>
      <button id="cam-snap" style="width:56px; height:56px; border-radius:50%; border:3px solid #fff; background:rgba(255,255,255,0.15); cursor:pointer; position:relative;">
        <span style="display:block; width:40px; height:40px; border-radius:50%; background:#fff; margin:auto;"></span>
      </button>
      <div style="width:68px;"></div>
    </div>
  `;

  phoneScreen.appendChild(overlay);
  const video = document.getElementById('cam-video');
  const canvas = document.createElement('canvas');
  let stream = null;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } } })
    .then(s => {
      stream = s;
      video.srcObject = stream;
    })
    .catch(() => {
      overlay.remove();
      showToast('Camera not available. Please use "Upload from Files" instead.');
    });

  function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    overlay.remove();
  }

  document.getElementById('cam-cancel').addEventListener('click', stopCamera);

  document.getElementById('cam-snap').addEventListener('click', () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stopCamera();

    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change'));
    }, 'image/jpeg', 0.92);
  });
}

// 16. Bottom Sheet Helpers
var _sheetHistory = []; // stack of { title, html, fullPage }

function openBottomSheet(title, htmlContent, fullPage) {
  var overlay = document.getElementById('bottom-sheet-overlay');
  // If sheet is already open, push current content to history stack
  if (overlay.classList.contains('active')) {
    _sheetHistory.push({
      title: document.getElementById('sheet-title').innerText,
      html: document.getElementById('sheet-body-content').innerHTML,
      fullPage: overlay.classList.contains('sheet-fullpage')
    });
  }
  document.getElementById('sheet-title').innerText = title;
  document.getElementById('sheet-body-content').innerHTML = htmlContent;
  overlay.classList.add('active');
  if (fullPage) {
    overlay.classList.add('sheet-fullpage');
  } else {
    overlay.classList.remove('sheet-fullpage');
  }
}

function closeBottomSheet() {
  // If there's a previous sheet in history, go back to it instead of closing
  if (_sheetHistory.length > 0) {
    var prev = _sheetHistory.pop();
    document.getElementById('sheet-title').innerText = prev.title;
    document.getElementById('sheet-body-content').innerHTML = prev.html;
    var overlay = document.getElementById('bottom-sheet-overlay');
    if (prev.fullPage) {
      overlay.classList.add('sheet-fullpage');
    } else {
      overlay.classList.remove('sheet-fullpage');
    }
    // Re-bind View handlers for doc checklist
    document.querySelectorAll('.inline-view-doc').forEach(function(viewBtn) {
      viewBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        var fp = this.getAttribute('data-fp');
        var dn = this.getAttribute('data-docname') || 'Document';
        var fileUrl = '/uploads/' + fp;
        var ext = fp.split('.').pop().toLowerCase();
        var previewHtml = '';
        if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
          previewHtml = '<div style="text-align:center;padding:8px 0;"><img src="' + fileUrl + '" style="max-width:100%;max-height:60vh;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.15);" alt="Preview"/></div>';
        } else if (ext === 'pdf') {
          previewHtml = '<div style="padding:8px 0;"><iframe src="' + fileUrl + '" style="width:100%;height:60vh;border:none;border-radius:8px;"></iframe></div>';
        } else {
          previewHtml = '<div style="text-align:center;padding:20px;"><a href="' + fileUrl + '" target="_blank" style="color:#1E40AF;font-weight:700;">Download</a></div>';
        }
        previewHtml += '<button class="btn btn-primary" onclick="closeBottomSheet()" style="width:100%;margin-top:10px;font-weight:700;background:#046A38 !important;border:none !important;">Close</button>';
        openBottomSheet(dn, previewHtml);
      });
    });
    return;
  }

  // Auto-save form values if a draft form is open
  if (_currentDraftServiceId) {
    try {
      var values = captureFormValues();
      if (values.length > 0) {
        var drafts = JSON.parse(localStorage.getItem('one_citizen_drafts') || '{}');
        if (drafts[_currentDraftServiceId]) {
          drafts[_currentDraftServiceId].formValues = values;
          drafts[_currentDraftServiceId].timestamp = new Date().toISOString();
          localStorage.setItem('one_citizen_drafts', JSON.stringify(drafts));
        }
      }
      _currentDraftServiceId = null;
    } catch(e) {
      console.warn('Could not auto-save draft:', e);
    }
  }
  var overlay = document.getElementById('bottom-sheet-overlay');
  overlay.classList.remove('active');
  overlay.classList.remove('sheet-fullpage');
  _sheetHistory = []; // Clear history on full close
}

// 16.5 Toast Notification Helper
function showToast(message, type) {
  const toast = document.getElementById('phone-toast');
  if (toast) {
    toast.innerText = message;
    toast.style.background = type === 'warning' ? '#D97706' : '#046A38';
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, type === 'warning' ? 4000 : 2500);
  }
}

// 17. Page Overlay Spinner
function showDialogSpinner() {
  const dialog = document.createElement('div');
  dialog.id = 'page-spinner-dialog';
  dialog.style.position = 'fixed';
  dialog.style.top = '0';
  dialog.style.left = '0';
  dialog.style.width = '100vw';
  dialog.style.height = '100vh';
  dialog.style.backgroundColor = 'rgba(0,0,0,0.4)';
  dialog.style.zIndex = '9999';
  dialog.style.display = 'flex';
  dialog.style.alignItems = 'center';
  dialog.style.justifyContent = 'center';
  dialog.innerHTML = '<div class="spinner"></div>';
  document.body.appendChild(dialog);
}

function hideDialogSpinner() {
  const dialog = document.getElementById('page-spinner-dialog');
  if (dialog) dialog.remove();
}

// 18. Language Translation Dictionary & Engine
const TRANSLATIONS = {
  en: {
    namaste: "Namaste,",
    morning: "Good Morning,",
    afternoon: "Good Afternoon,",
    evening: "Good Evening,",
    twin_title: "Citizen Digital Twin",
    copilot_title: "AI Life-Event Copilot",
    copilot_desc: "What situation are you currently facing? We will find the correct documents and schemes.",
    tracker_title: "Active Application Progress",
    track_submitted: "Submitted",
    track_vro: "VRO Verification",
    track_mro: "Tahsildar Approval",
    // Login page
    login_title: "OneCitizen AI",
    login_subtitle: "AI-Powered Government Service Assistant",
    login_mobile_label: "Mobile Number",
    login_mobile_placeholder: "Enter 10-digit number",
    login_send_otp: "Send OTP",
    login_verify: "Verify & Login",
    login_why_title: "Why OneCitizen?",
    login_feat_title_1: "Upload Documents Once",
    login_feat_desc_1: "Upload files securely to your personal Digital Twin vault.",
    login_feat_title_2: "Verify Documents",
    login_feat_desc_2: "OneCitizen AI validates details & prevents rejection.",
    login_feat_title_3: "Discover Schemes",
    login_feat_desc_3: "Find and match with eligible welfare benefits instantly.",
    login_feat_title_4: "Auto-Fill Applications",
    login_feat_desc_4: "Forms auto-complete instantly from verified credentials.",
    login_feat_title_5: "Track Status",
    login_feat_desc_5: "Monitor real-time progress of active approvals and reviews.",
    onboarding_title_1: "Upload Once",
    onboarding_desc_1: "Store your documents securely and reuse them across government services anytime.",
    onboarding_title_2: "Find Eligible Schemes",
    onboarding_desc_2: "Our AI analyzes your profile and recommends government services you qualify for.",
    onboarding_title_3: "Track Everything",
    onboarding_desc_3: "Track all your applications, approvals and updates in real-time from one dashboard."
  },
  te: {
    namaste: "à°¨à°®à°¸à±à°¤à±‡,",
    morning: "à°¶à±à°­à±‹à°¦à°¯à°‚,",
    afternoon: "à°¶à±à°­ à°®à°§à±à°¯à°¾à°¹à±à°¨à°‚,",
    evening: "à°¶à±à°­ à°¸à°¾à°¯à°‚à°¤à±à°°à°‚,",
    twin_title: "à°¸à°¿à°Ÿà°¿à°œà°¨à± à°¡à°¿à°œà°¿à°Ÿà°²à± à°Ÿà±à°µà°¿à°¨à±",
    copilot_title: "AI à°²à±ˆà°«à±-à°ˆà°µà±†à°‚à°Ÿà± à°•à±‹-à°ªà±ˆà°²à°Ÿà±",
    copilot_desc: "à°®à±€à°°à± à°ªà±à°°à°¸à±à°¤à±à°¤à°‚ à° à°ªà°°à°¿à°¸à±à°¥à°¿à°¤à°¿à°¨à°¿ à°Žà°¦à±à°°à±à°•à±Šà°‚à°Ÿà±à°¨à±à°¨à°¾à°°à±? à°®à±‡à°®à± à°¸à°°à±ˆà°¨ à°ªà°¤à±à°°à°¾à°²à± à°®à°°à°¿à°¯à± à°ªà°¥à°•à°¾à°²à°¨à± à°•à°¨à±à°—à±Šà°‚à°Ÿà°¾à°®à±.",
    tracker_title: "à°¦à°°à°–à°¾à°¸à±à°¤à± à°ªà±à°°à°—à°¤à°¿",
    track_submitted: "à°¸à°®à°°à±à°ªà°¿à°‚à°šà°¬à°¡à°¿à°‚à°¦à°¿",
    track_vro: "VRO à°§à±ƒà°µà±€à°•à°°à°£",
    track_mro: "à°¤à°¹à°¶à±€à°²à±à°¦à°¾à°°à± à°†à°®à±‹à°¦à°‚",
    // Login page
    login_title: "OneCitizen AI",
    login_subtitle: "AI-à°†à°§à°¾à°°à°¿à°¤ à°ªà±à°°à°­à±à°¤à±à°µ à°¸à±‡à°µà°¾ à°¸à°¹à°¾à°¯à°•à±à°¡à±",
    login_mobile_label: "à°®à±Šà°¬à±ˆà°²à± à°¨à°‚à°¬à°°à±",
    login_mobile_placeholder: "10 à°…à°‚à°•à±†à°² à°¨à°‚à°¬à°°à± à°¨à°®à±‹à°¦à± à°šà±‡à°¯à°‚à°¡à°¿",
    login_send_otp: "OTP à°ªà°‚à°ªà°‚à°¡à°¿",
    login_verify: "à°§à±ƒà°µà±€à°•à°°à°¿à°‚à°šà°¿ à°²à°¾à°—à°¿à°¨à± à°…à°µà±à°µà°‚à°¡à°¿",
    login_why_title: "OneCitizen à°Žà°‚à°¦à±à°•à±?",
    login_feat_title_1: "à°ªà°¤à±à°°à°¾à°²à°¨à± à°’à°•à±à°•à°¸à°¾à°°à°¿ à°…à°ªà±à°²à±‹à°¡à± à°šà±‡à°¯à°‚à°¡à°¿",
    login_feat_desc_1: "à°®à±€ à°µà±à°¯à°•à±à°¤à°¿à°—à°¤ à°¡à°¿à°œà°¿à°Ÿà°²à± à°Ÿà±à°µà°¿à°¨à± à°µà°¾à°²à±à°Ÿà±à°•à± à°ªà°¤à±à°°à°¾à°²à°¨à± à°­à°¦à±à°°à°‚à°—à°¾ à°…à°ªà±à°²à±‹à°¡à± à°šà±‡à°¯à°‚à°¡à°¿.",
    login_feat_title_2: "à°ªà°¤à±à°°à°¾à°²à°¨à± à°§à±ƒà°µà±€à°•à°°à°¿à°‚à°šà°‚à°¡à°¿",
    login_feat_desc_2: "OneCitizen AI à°µà°¿à°µà°°à°¾à°²à°¨à± à°§à±ƒà°µà±€à°•à°°à°¿à°‚à°šà°¿ à°¤à°¿à°°à°¸à±à°•à°°à°£à°¨à± à°¨à°¿à°°à±‹à°§à°¿à°¸à±à°¤à±à°‚à°¦à°¿.",
    login_feat_title_3: "à°ªà°¥à°•à°¾à°²à°¨à± à°•à°¨à±à°—à±Šà°¨à°‚à°¡à°¿",
    login_feat_desc_3: "à°…à°°à±à°¹à°¤ à°•à°²à°¿à°—à°¿à°¨ à°¸à°‚à°•à±à°·à±‡à°® à°ªà°¥à°•à°¾à°²à°¨à± à°¤à°•à±à°·à°£à°®à±‡ à°•à°¨à±à°—à±Šà°¨à°‚à°¡à°¿.",
    login_feat_title_4: "à°¦à°°à°–à°¾à°¸à±à°¤à±à°²à± à°†à°Ÿà±‹-à°«à°¿à°²à±",
    login_feat_desc_4: "à°§à±ƒà°µà±€à°•à°°à°¿à°‚à°šà°¬à°¡à°¿à°¨ à°†à°§à°¾à°°à°¾à°² à°¨à±à°‚à°¡à°¿ à°«à°¾à°°à°®à±à°²à± à°¤à°•à±à°·à°£à°®à±‡ à°ªà±‚à°°à°¿à°‚à°šà°¬à°¡à°¤à°¾à°¯à°¿.",
    login_feat_title_5: "à°¸à±à°¥à°¿à°¤à°¿à°¨à°¿ à°Ÿà±à°°à°¾à°•à± à°šà±‡à°¯à°‚à°¡à°¿",
    login_feat_desc_5: "à°¯à°¾à°•à±à°Ÿà°¿à°µà± à°†à°®à±‹à°¦à°¾à°² à°¯à±Šà°•à±à°• à°¨à°¿à°œ-à°¸à°®à°¯ à°ªà±à°°à±‹à°—à°¤à°¿à°¨à°¿ à°ªà°°à±à°¯à°µà±‡à°•à±à°·à°¿à°‚à°šà°‚à°¡à°¿.",
    onboarding_title_1: "à°’à°•à±à°•à°¸à°¾à°°à°¿ à°…à°ªà±à°²à±‹à°¡à± à°šà±‡à°¯à°‚à°¡à°¿",
    onboarding_desc_1: "à°®à±€ à°ªà°¤à±à°°à°¾à°²à°¨à± à°­à°¦à±à°°à°‚à°—à°¾ à°¨à°¿à°²à±à°µ à°šà±‡à°¸à±à°•à±‹à°‚à°¡à°¿ à°®à°°à°¿à°¯à± à°Žà°ªà±à°ªà±à°¡à±ˆà°¨à°¾ à°ªà±à°°à°­à±à°¤à±à°µ à°¸à±‡à°µà°²à°²à±‹ à°µà°¾à°Ÿà°¿à°¨à°¿ à°¤à°¿à°°à°¿à°—à°¿ à°‰à°ªà°¯à±‹à°—à°¿à°‚à°šà±à°•à±‹à°‚à°¡à°¿.",
    onboarding_title_2: "à°…à°°à±à°¹à°¤à°—à°² à°ªà°¥à°•à°¾à°²à°¨à± à°•à°¨à±à°—à±Šà°¨à°‚à°¡à°¿",
    onboarding_desc_2: "à°®à°¾ AI à°®à±€ à°ªà±à°°à±Šà°«à±ˆà°²à±à°¨à± à°µà°¿à°¶à±à°²à±‡à°·à°¿à°¸à±à°¤à±à°‚à°¦à°¿ à°®à°°à°¿à°¯à± à°®à±€à°°à± à°…à°°à±à°¹à°¤ à°ªà±Šà°‚à°¦à±‡ à°ªà±à°°à°­à±à°¤à±à°µ à°¸à±‡à°µà°²à°¨à± à°¸à°¿à°«à°¾à°°à±à°¸à± à°šà±‡à°¸à±à°¤à±à°‚à°¦à°¿.",
    onboarding_title_3: "à°…à°¨à±à°¨à±€ à°Ÿà±à°°à°¾à°•à± à°šà±‡à°¯à°‚à°¡à°¿",
    onboarding_desc_3: "à°’à°•à±‡ à°¡à±à°¯à°¾à°·à±à°¬à±‹à°°à±à°¡à± à°¨à±à°‚à°¡à°¿ à°¨à°¿à°œ-à°¸à°®à°¯à°‚à°²à±‹ à°®à±€ à°¦à°°à°–à°¾à°¸à±à°¤à±à°²à±, à°†à°®à±‹à°¦à°¾à°²à± à°®à°°à°¿à°¯à± à°¨à°µà±€à°•à°°à°£à°²à°¨à± à°Ÿà±à°°à°¾à°•à± à°šà±‡à°¯à°‚à°¡à°¿."
  },
  hi: {
    namaste: "à¤¨à¤®à¤¸à¥à¤¤à¥‡,",
    morning: "à¤¶à¥à¤­ à¤ªà¥à¤°à¤­à¤¾à¤¤,",
    afternoon: "à¤¶à¥à¤­ à¤¦à¥‹à¤ªà¤¹à¤°,",
    evening: "à¤¶à¥à¤­ à¤¸à¤‚à¤§à¥à¤¯à¤¾,",
    twin_title: "à¤¸à¤¿à¤Ÿà¤¿à¤œà¤¨ à¤¡à¤¿à¤œà¤¿à¤Ÿà¤² à¤Ÿà¥à¤µà¤¿à¤¨",
    copilot_title: "AI à¤²à¤¾à¤‡à¤«-à¤‡à¤µà¥‡à¤‚à¤Ÿ à¤•à¥‹-à¤ªà¤¾à¤¯à¤²à¤Ÿ",
    copilot_desc: "à¤†à¤ª à¤µà¤°à¥à¤¤à¤®à¤¾à¤¨ à¤®à¥‡à¤‚ à¤•à¤¿à¤¸ à¤ªà¤°à¤¿à¤¸à¥à¤¥à¤¿à¤¤à¤¿ à¤•à¤¾ à¤¸à¤¾à¤®à¤¨à¤¾ à¤•à¤° à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚? à¤¹à¤® à¤¸à¤¹à¥€ à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œ à¤”à¤° à¤¯à¥‹à¤œà¤¨à¤¾à¤à¤‚ à¤¢à¥‚à¤‚à¤¢à¥‡à¤‚à¤—à¥‡à¥¤",
    tracker_title: "à¤†à¤µà¥‡à¤¦à¤¨ à¤•à¥€ à¤ªà¥à¤°à¤—à¤¤à¤¿",
    track_submitted: "à¤ªà¥à¤°à¤¸à¥à¤¤à¥à¤¤ à¤•à¤¿à¤¯à¤¾ à¤—à¤¯à¤¾",
    track_vro: "VRO à¤¸à¤¤à¥à¤¯à¤¾à¤ªà¤¨",
    track_mro: "à¤¤à¤¹à¤¸à¥€à¤²à¤¦à¤¾à¤° à¤•à¥€ à¤®à¤‚à¤œà¥‚à¤°à¥€",
    // Login page
    login_title: "OneCitizen AI",
    login_subtitle: "AI-à¤¸à¤‚à¤šà¤¾à¤²à¤¿à¤¤ à¤¸à¤°à¤•à¤¾à¤°à¥€ à¤¸à¥‡à¤µà¤¾ à¤¸à¤¹à¤¾à¤¯à¤•",
    login_mobile_label: "à¤®à¥‹à¤¬à¤¾à¤‡à¤² à¤¨à¤‚à¤¬à¤°",
    login_mobile_placeholder: "10 à¤…à¤‚à¤•à¥‹à¤‚ à¤•à¤¾ à¤¨à¤‚à¤¬à¤° à¤¦à¤°à¥à¤œ à¤•à¤°à¥‡à¤‚",
    login_send_otp: "OTP à¤­à¥‡à¤œà¥‡à¤‚",
    login_verify: "à¤¸à¤¤à¥à¤¯à¤¾à¤ªà¤¿à¤¤ à¤•à¤°à¥‡à¤‚ à¤”à¤° à¤²à¥‰à¤—à¤¿à¤¨ à¤•à¤°à¥‡à¤‚",
    login_why_title: "OneCitizen à¤•à¥à¤¯à¥‹à¤‚?",
    login_feat_title_1: "à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œà¤¼ à¤à¤• à¤¬à¤¾à¤° à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚",
    login_feat_desc_1: "à¤…à¤ªà¤¨à¥‡ à¤µà¥à¤¯à¤•à¥à¤¤à¤¿à¤—à¤¤ à¤¡à¤¿à¤œà¤¿à¤Ÿà¤² à¤Ÿà¥à¤µà¤¿à¤¨ à¤µà¥‰à¤²à¥à¤Ÿ à¤®à¥‡à¤‚ à¤¸à¥à¤°à¤•à¥à¤·à¤¿à¤¤ à¤°à¥‚à¤ª à¤¸à¥‡ à¤«à¤¼à¤¾à¤‡à¤²à¥‡à¤‚ à¤…à¤ªà¤²à¥‹à¤¡ à¤•à¤°à¥‡à¤‚à¥¤",
    login_feat_title_2: "à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œà¤¼à¥‹à¤‚ à¤•à¥‹ à¤¸à¤¤à¥à¤¯à¤¾à¤ªà¤¿à¤¤ à¤•à¤°à¥‡à¤‚",
    login_feat_desc_2: "OneCitizen AI à¤µà¤¿à¤µà¤°à¤£à¥‹à¤‚ à¤•à¥‹ à¤®à¤¾à¤¨à¥à¤¯ à¤•à¤°à¤¤à¤¾ à¤¹à¥ˆ à¤”à¤° à¤…à¤¸à¥à¤µà¥€à¤•à¥ƒà¤¤à¤¿ à¤•à¥‹ à¤°à¥‹à¤•à¤¤à¤¾ à¤¹à¥ˆà¥¤",
    login_feat_title_3: "à¤¯à¥‹à¤œà¤¨à¤¾à¤à¤‚ à¤–à¥‹à¤œà¥‡à¤‚",
    login_feat_desc_3: "à¤ªà¤¾à¤¤à¥à¤° à¤•à¤²à¥à¤¯à¤¾à¤£à¤•à¤¾à¤°à¥€ à¤¯à¥‹à¤œà¤¨à¤¾à¤“à¤‚ à¤•à¥‹ à¤¤à¥à¤°à¤‚à¤¤ à¤–à¥‹à¤œà¥‡à¤‚ à¤”à¤° à¤®à¤¿à¤²à¤¾à¤¨ à¤•à¤°à¥‡à¤‚à¥¤",
    login_feat_title_4: "à¤†à¤µà¥‡à¤¦à¤¨ à¤‘à¤Ÿà¥‹-à¤­à¤°à¥‡à¤‚",
    login_feat_desc_4: "à¤¸à¤¤à¥à¤¯à¤¾à¤ªà¤¿à¤¤ à¤•à¥à¤°à¥‡à¤¡à¥‡à¤‚à¤¶à¤¿à¤¯à¤²à¥à¤¸ à¤¸à¥‡ à¤«à¤¼à¥‰à¤°à¥à¤® à¤¤à¥à¤°à¤‚à¤¤ à¤‘à¤Ÿà¥‹-à¤ªà¥‚à¤°à¥à¤£ à¤¹à¥‹ à¤œà¤¾à¤¤à¥‡ à¤¹à¥ˆà¤‚à¥¤",
    login_feat_title_5: "à¤¸à¥à¤¥à¤¿à¤¤à¤¿ à¤Ÿà¥à¤°à¥ˆà¤• à¤•à¤°à¥‡à¤‚",
    login_feat_desc_5: "à¤¸à¤•à¥à¤°à¤¿à¤¯ à¤¸à¥à¤µà¥€à¤•à¥ƒà¤¤à¤¿à¤¯à¥‹à¤‚ à¤•à¥€ à¤µà¤¾à¤¸à¥à¤¤à¤µà¤¿à¤• à¤¸à¤®à¤¯ à¤•à¥€ à¤ªà¥à¤°à¤—à¤¤à¤¿ à¤•à¥€ à¤¨à¤¿à¤—à¤°à¤¾à¤¨à¥€ à¤•à¤°à¥‡à¤‚à¥¤"
  }
};

function switchLanguage(lang) {
  currentLanguage = lang;
  const dict = TRANSLATIONS[lang] || TRANSLATIONS['en'];

  // -- Dashboard labels --
  const hour = new Date().getHours();
  let timeKey = 'morning';
  if (hour >= 12 && hour < 17) {
    timeKey = 'afternoon';
  } else if (hour >= 17) {
    timeKey = 'evening';
  }
  const elNamaste = document.getElementById('lbl-namaste');
  if (elNamaste) elNamaste.innerText = dict[timeKey] || dict.namaste;
  const elTwinTitle = document.getElementById('lbl-twin-title');
  if (elTwinTitle) elTwinTitle.innerText = dict.twin_title;
  const elCopilotTitle = document.getElementById('lbl-copilot-title');
  if (elCopilotTitle) elCopilotTitle.innerText = dict.copilot_title;
  const elCopilotDesc = document.getElementById('lbl-copilot-desc');
  if (elCopilotDesc) elCopilotDesc.innerText = dict.copilot_desc;
  const elTrackerTitle = document.getElementById('lbl-tracker-title');
  if (elTrackerTitle) elTrackerTitle.innerText = dict.tracker_title;
  const elTrackSubmitted = document.getElementById('lbl-track-submitted');
  if (elTrackSubmitted) elTrackSubmitted.innerText = dict.track_submitted;
  const elTrackVro = document.getElementById('lbl-track-vro');
  if (elTrackVro) elTrackVro.innerText = dict.track_vro;
  const elTrackMro = document.getElementById('lbl-track-mro');
  if (elTrackMro) elTrackMro.innerText = dict.track_mro;

  // -- Login page labels --
  const loginTitle = document.querySelector('.login-title');
  if (loginTitle) loginTitle.innerText = dict.login_title;

  const loginSubtitle = document.querySelector('.login-subtitle');
  if (loginSubtitle) loginSubtitle.innerText = dict.login_subtitle;

  const mobileLabel = document.querySelector('#otp-step-mobile label');
  if (mobileLabel) mobileLabel.innerText = dict.login_mobile_label;

  const mobileInput = document.getElementById('login-mobile');
  if (mobileInput) mobileInput.placeholder = dict.login_mobile_placeholder;

  const sendBtn = document.getElementById('btn-send-otp');
  if (sendBtn && !sendBtn.disabled) sendBtn.innerText = dict.login_send_otp;

  const verifyBtn = document.getElementById('btn-verify-otp');
  if (verifyBtn && !verifyBtn.disabled) verifyBtn.innerText = dict.login_verify;

  const whyTitle = document.querySelector('.why-onecitizen-section h3');
  if (whyTitle) whyTitle.innerText = dict.login_why_title;

  // Translate onboarding slides
  const onboardingSlides = document.querySelectorAll('.onboarding-slide');
  onboardingSlides.forEach((slide, idx) => {
    const title = slide.querySelector('.onboarding-title');
    const desc = slide.querySelector('.onboarding-desc');
    if (title && desc) {
      title.innerText = dict[`onboarding_title_${idx + 1}`];
      desc.innerText = dict[`onboarding_desc_${idx + 1}`];
    }
  });

  // -- Sync dashboard language dropdown --
  const langSelector = document.getElementById('lang-selector');
  if (langSelector) langSelector.value = lang;

  // -- Highlight active top language bar --
  document.querySelectorAll('.login-lang-top-glass span[data-lang]').forEach(s => {
    s.classList.toggle('active', s.getAttribute('data-lang') === lang);
  });
}

// ── Copilot Voice Input via Web Speech API ──
var _copilotRecognition = null;
function startCopilotVoiceInput() {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Voice input not supported in this browser', 'warning');
    return;
  }
  var micBtn = document.getElementById('btn-copilot-mic');
  var chatInput = document.getElementById('copilot-chat-input');
  if (!chatInput) return;

  // If already listening, stop
  if (_copilotRecognition) {
    _copilotRecognition.stop();
    _copilotRecognition = null;
    if (micBtn) { micBtn.style.color = '#94A3B8'; micBtn.style.background = 'none'; }
    chatInput.placeholder = 'Ask anything...';
    return;
  }

  var recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;
  _copilotRecognition = recognition;

  // Visual feedback
  if (micBtn) { micBtn.style.color = '#DC2626'; micBtn.style.background = 'rgba(220,38,38,0.08)'; }
  chatInput.value = '';
  chatInput.placeholder = '🎤 Listening...';

  recognition.onresult = function(event) {
    var transcript = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    chatInput.value = transcript;
    // If final result, auto-send
    if (event.results[event.results.length - 1].isFinal) {
      setTimeout(function() {
        var sendBtn = document.getElementById('btn-copilot-send');
        if (sendBtn && chatInput.value.trim()) sendBtn.click();
      }, 300);
    }
  };

  recognition.onerror = function(e) {
    console.warn('Speech error:', e.error);
    if (e.error === 'not-allowed') {
      showToast('Microphone access denied. Allow microphone in browser settings.', 'warning');
    } else if (e.error !== 'aborted') {
      showToast('Could not recognise speech. Try again.', 'info');
    }
    _copilotRecognition = null;
    if (micBtn) { micBtn.style.color = '#94A3B8'; micBtn.style.background = 'none'; }
    chatInput.placeholder = 'Ask anything...';
  };

  recognition.onend = function() {
    _copilotRecognition = null;
    if (micBtn) { micBtn.style.color = '#94A3B8'; micBtn.style.background = 'none'; }
    chatInput.placeholder = 'Ask anything...';
  };

  try { recognition.start(); } catch(e) {
    showToast('Could not start microphone', 'warning');
    _copilotRecognition = null;
    if (micBtn) { micBtn.style.color = '#94A3B8'; micBtn.style.background = 'none'; }
    chatInput.placeholder = 'Ask anything...';
  }
}

// 19. Microphone Voice Simulation typing effect
function simulateVoiceAssistant() {
  const micBtn = document.getElementById('btn-voice-mic');
  const queryBox = document.getElementById('copilot-query');
  
  if (!micBtn || !queryBox) return;
  if (micBtn.classList.contains('listening')) return;
  
  // Clear box and start listening
  queryBox.value = '';
  micBtn.classList.add('listening');
  
  const textToType = "I got admission into engineering college";
  let index = 0;
  
  function typeChar() {
    if (index < textToType.length) {
      queryBox.value += textToType.charAt(index);
      index++;
      setTimeout(typeChar, 40); // Type next letter
    } else {
      // Finished typing
      setTimeout(() => {
        micBtn.classList.remove('listening');
        // Automatically submit the copilot query
        document.getElementById('btn-consult-copilot').click();
      }, 500);
    }
  }
  
  setTimeout(typeChar, 800); // Wait for speech wave before typing
}

// 20. Official Government Forms - Exact MeeSeva Replicas
function getOfficialFormHTML(serviceName, autoFields) {
  var n = autoFields.name || '';
  var dob = autoFields.dob || '';
  var g = '';
  var dist = '';
  var aad = autoFields.aadhaar_number || '';
  var pan = '';
  var inc = '';
  var cas = '';
  var addr = '';
  var mob = '';
  var fn = '';
  var pin = '';
  var dt = new Date().toLocaleDateString('en-IN');

  // Inline field: label ___value___ on same line
  function fi(label, val) {
    var cls = val ? ' mf-has-val' : '';
    var ro = val ? ' readonly' : '';
    return '<div class="mf-line"><span class="mf-lbl">' + label + '</span><input class="mf-val' + cls + '" value="' + (val||'') + '"' + ro + '></div>';
  }
  // Two fields on same line
  function fi2(l1, v1, l2, v2) {
    var c1 = v1 ? ' mf-has-val' : ''; var c2 = v2 ? ' mf-has-val' : '';
    var r1 = v1 ? ' readonly' : ''; var r2 = v2 ? ' readonly' : '';
    return '<div class="mf-line mf-line-2"><span class="mf-lbl">' + l1 + '</span><input class="mf-val' + c1 + '" value="' + (v1||'') + '"' + r1 + '><span class="mf-lbl">' + l2 + '</span><input class="mf-val' + c2 + '" value="' + (v2||'') + '"' + r2 + '></div>';
  }
  // Bold label only (no input)
  function fb(text) { return '<div class="mf-bold">' + text + '</div>'; }
  // Paragraph note
  function fp(text) { return '<p class="mf-note">' + text + '</p>'; }
  // Sub-item
  function fs(text) { return '<div class="mf-sub">' + text + '</div>'; }
  // Section heading
  function fh(text) { return '<div class="mf-heading">' + text + '</div>'; }

  var sn = serviceName.toLowerCase();
  var h = '';

  // ============ DEATH CERTIFICATE ============
  if (sn.includes('death')) {
    h = '<div class="mf-page">';
    h += '<div class="mf-header"><img src="telangana_logo.jpg" class="mf-logo"><div class="mf-title">APPLICATION FOR DEATH CERTIFICATE</div><div class="mf-sub-title">(Write in Capital Letters)</div></div>';
    h += fi('CIRCLE / LOCALITY', '');
    h += fi('1. Date of Death', '');
    h += fi('2. Name of the Deceased', '');
    h += fi('3. Sex of the Deceased', '');
    h += fi('4. Name of the Father of the deceased', fn);
    h += fi('5. Name of the Mother', '');
    h += fb('6. Place of Death:');
    h += fp('(Tick the appropriate entry a, b, c below and give the name of the Hospital/Institute or the Address of the House where the Death took place. If other place gives location)');
    h += fs('a) Hospital/Institution Name : ');
    h += '<div class="mf-line"><input class="mf-val" placeholder=""></div>';
    h += fs('b) House Address :');
    h += '<div class="mf-line"><input class="mf-val" placeholder=""></div>';
    h += fs('c) Other place :');
    h += '<div class="mf-line"><input class="mf-val" placeholder=""></div>';
    h += fi('7. No. of Copies Required', '');
    h += '<div class="mf-line"><span class="mf-lbl">8 &nbsp;&nbsp; a) Do you want the Death Certificate by Courier-</span><span class="mf-lbl" style="margin-left:auto">Yes / No.</span></div>';
    h += fi('b) If Yes give Name and Address with Pin Code', '');
    h += '<div class="mf-spacer"></div>';
    h += fi('Name & address.', n);
    h += '<div class="mf-spacer"></div>';
    h += '<div class="mf-sig">(Signature of the Applicant)</div>';
    h += fi('Telephone No:', mob);
    h += fp('<b>Note:</b> - Death certificate will be issued subject to entry found Registered with <b>GHMC</b> records.');
    h += '</div>';

  // ============ BIRTH CERTIFICATE ============
  } else if (sn.includes('birth')) {
    h = '<div class="mf-page">';
    h += '<div class="mf-header"><img src="telangana_logo.jpg" class="mf-logo"><div class="mf-title">APPLICATION FOR BIRTH CERTIFICATE</div><div class="mf-sub-title">(Write in Capital Letters)</div></div>';
    h += fi('CIRCLE/LOCALITY', '');
    h += fi('1. Date of Birth', '');
    h += fi('2. Sex', '');
    h += fi('3. Child Name', '');
    h += fp('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b>a)</b> If Registered Mention the Child Name.<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b>b)</b> If Child Name not included a separate form to be filled by the Father and Mother of the child');
    h += fi('4. Name of the Father', fn);
    h += fi('5. Name of the Mother', '');
    h += fb('6. Place of Birth');
    h += fp('(Tick the appropriate entry <b>a, b, c</b> below and give the name of the Hospital/Institute or the Address of the House where the <b>Birth</b> took place. If other place gives location)');
    h += fi('a) Hospital/Institution Name', '');
    h += fi('b) House Address', '');
    h += fi('c) Other place', '');
    h += fi('7. No. Of Copies Required', '');
    h += '<div class="mf-line"><span class="mf-lbl">8. a) Do you want the Birth Certificate by Courier-</span><span class="mf-lbl" style="margin-left:auto">Yes / No</span></div>';
    h += fi('b) If Yes give Name and Address with Pin Code', '');
    h += '<div class="mf-spacer"></div>';
    h += '<div class="mf-line mf-line-2"><span class="mf-lbl">Name & address,</span><input class="mf-val' + (n ? ' mf-has-val' : '') + '" value="' + n + '"' + (n ? ' readonly' : '') + '><span class="mf-lbl">(Signature of the Applicant)</span></div>';
    h += '<div class="mf-spacer"></div>';
    h += fi('Telephone No:', mob);
    h += fp('<b>Note:-</b> Birth certificate will be issued subject to entry found Registered in <b>BIRTH RECORDS- C&DMA/PANCHYATS</b>.');
    h += '</div>';

  // ============ INCOME CERTIFICATE ============
  } else if (sn.includes('income')) {
    h = '<div class="mf-page">';
    h += '<div class="mf-header"><div class="mf-title" style="text-decoration:underline">GOVERNMENT OF TELANGANA</div><div class="mf-sub-title" style="text-decoration:underline">REVENUE DEPARTMENT<br>APPLICATION<br>INCOME CERTIFICATE</div></div>';
    h += '<div class="mf-addr">To<br>The Tahsildar</div>';
    h += fi2('', '', 'Mandal,', '');
    h += fi2('', '', 'Dist Telangana.', '');
    h += '<div class="mf-line"><span class="mf-lbl" style="margin-left:auto">Date : ' + dt + '</span></div>';
    h += '<div class="mf-spacer"></div>';
    h += fi('Applicant Name', n);
    h += fi('Relation : S/o,D/o,W/o,H/o,F/o,C/o,(with Name)', fn);
    h += fi2('Gender :  Male / Female', g, 'Date of Birth *', dob);
    h += fh('ADDRESS:');
    h += fi2('Door No', '', 'Locality/ Land Mark', '');
    h += fi2('District', dist, 'Mandal', '');
    h += fi2('Village', '', 'Pin code', pin);
    h += '<div class="mf-spacer-sm"></div>';
    h += fi('Ration Card No', '');
    h += fi('Mobile No', mob);
    h += fi('AADHAAR NO', aad);
    h += fh('INCOME FROM ALL SOURCES (JOB, BUSINESS OR OTHERS) :');
    h += fi2('Income from Land and Buildings', '', 'Rs.', '');
    h += fi2('By Business', '', 'Rs.', '');
    h += fi2('Total Income of husband and Wife', '', 'Rs.', '');
    h += fi2('Daily wage Earner', '', 'Rs.', '');
    h += fi2('Income from Others Source\'s (Total Income Details)', '', 'Rs.', '');
    h += fi2('Total :', '', 'Rs.', inc);
    h += fi('Purpose of Certificate', '');
    h += '<div class="mf-spacer"></div>';
    h += fp('The information submitted is true and accurate to the best of my knowledge. If the information found incorrect, legal action as deemed fit.');
    h += '<div class="mf-line mf-line-2"><span class="mf-lbl"><b>Parents Signature.</b></span><span class="mf-lbl" style="text-align:right"><b>Signature of the Applicant</b></span></div>';
    h += '</div>';

  // ============ CASTE CERTIFICATE (FORM-6) ============
  } else if (sn.includes('caste')) {
    h = '<div class="mf-page">';
    h += '<div class="mf-header"><div class="mf-title" style="text-decoration:underline">GOVERNMENT OF TELANGANA</div><div class="mf-sub-title" style="text-decoration:underline">REVENUE DEPARTMENT<br>APPLICATION<br>COMMUNITY AND BIRTH APPLICATION (CASTE) FORM - 6</div></div>';
    h += '<div class="mf-addr">To<br>The Tahsildar</div>';
    h += fi2('', '', 'Mandal,', '');
    h += fi2('', '', 'Dist Telangana.', '');
    h += '<div class="mf-line"><span class="mf-lbl" style="margin-left:auto">Date : ' + dt + '</span></div>';
    h += '<div class="mf-spacer"></div>';
    h += fi('Applicant Name', n);
    h += fi('Relation : S/o,D/o,W/o,H/o,F/o,C/o(with Name)', fn);
    h += fi('Mother Name', '');
    h += fi2('Gender :  Male / Female', g, 'Date of Birth *', dob);
    h += fh('ADDRESS:');
    h += fi2('Door No', '', 'Locality/ Land Mark', '');
    h += fi2('District', dist, 'Mandal', '');
    h += fi2('Village', '', 'Pin code', pin);
    h += fi('Ration Card No', '');
    h += fi('Mobile No', mob);
    h += fi('AADHAAR NO', aad);
    h += fh('CASTE CERTIFICATE');
    h += '<div class="mf-line mf-line-2"><span class="mf-lbl">Issued Caste Certificate in Past <b>(Yes/No)</b></span><input class="mf-val"><span class="mf-lbl">Caste Claimed :</span><input class="mf-val' + (cas ? ' mf-has-val' : '') + '" value="' + cas + '"' + (cas ? ' readonly' : '') + '></div>';
    h += fi2('Caste Category', '', 'Purpose of Caste Certificate', '');
    h += fi('Religion', '');
    h += '<div class="mf-spacer"></div>';
    h += '<div class="mf-sig">Signature of the Applicant</div>';
    h += '</div>';

  // ============ PENSION (ANNEXURE-A) ============
  } else if (sn.includes('pension') || sn.includes('aasara') || sn.includes('old age')) {
    h = '<div class="mf-page">';
    h += '<div class="mf-header"><div class="mf-title">ANNEXURE - A</div><div class="mf-sub-title"><b>GOVERNMENT OF TELANGANA - AASARA PENSION SCHEME<br>APPLICATION FOR SANCTION OF NEW OLD AGE PENSION</b></div></div>';
    h += '<div class="mf-spacer"></div>';
    h += fi('District', dist);
    h += fi('Mandal /Municipality', '');
    h += fi('Gram Panchayat / Ward No.', '');
    h += fi('Habitation/Street', '');
    h += '<div class="mf-spacer"></div>';
    h += fi('1.  Applicant Full Name (As shown in Aadhar)', n);
    h += fi('2.  Aadhar Number', aad);
    h += fi('3.  Father\'s/Husband\'s Name', fn);
    h += fi('4.  Address', addr);
    h += fi2('5.  Date of Birth (as per Aadhar)', dob, 'Age', '');
    h += fi('6.  Gender', g);
    h += fi('7.  Social Category', '');
    h += fp('SC / ST / BC / Minority / Others');
    h += '<div class="mf-spacer"></div>';
    h += fi2('8.  Bank Account No.', '', 'IFSC Code', '');
    h += fi2('Bank Branch', '', 'Mobile No', mob);
    h += '<div class="mf-spacer"></div>';
    h += fp('Documents enclosed: &nbsp;&nbsp; Aadhar Card Xerox Copy');
    h += fp('Declaration : I hereby declare that all particulars stated are true to the best of my knowledge and belief, and no material information has been concealed or misstated. I further state that if any inaccuracy is detected in the application, I shall be liable to forfeiture of any benefits derived and other action as per law.');
    h += '<div class="mf-spacer"></div>';
    h += '<div class="mf-sig"><b>Signature/Thumb Impression of the Applicant</b></div>';
    h += '</div>';

  // ============ FALLBACK ============
  } else {
    h = '<div class="mf-page">';
    h += '<div class="mf-header"><div class="mf-title">APPLICATION FORM</div><div class="mf-sub-title">' + serviceName.toUpperCase() + '</div></div>';
    h += fi('Full Name', n);
    h += fi('Date of Birth', dob);
    h += fi('Gender', g);
    h += fi('Aadhaar No', aad);
    h += fi2('State', 'Telangana', 'District', dist);
    h += '</div>';
  }

  return h;
}
function setupCarousel() {
  const slides = document.querySelectorAll('#features-carousel .carousel-slide');
  const indicators = document.querySelectorAll('.carousel-indicators .indicator');
  let currentIndex = 0;
  let intervalId = null;

  function showSlide(index) {
    slides.forEach((s, idx) => {
      s.classList.toggle('active', idx === index);
    });
    indicators.forEach((ind, idx) => {
      ind.classList.toggle('active', idx === index);
    });
    currentIndex = index;
  }

  function startAutoPlay() {
    stopAutoPlay();
    intervalId = setInterval(() => {
      let nextIndex = (currentIndex + 1) % slides.length;
      showSlide(nextIndex);
    }, 3000);
  }

  function stopAutoPlay() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  indicators.forEach((ind, idx) => {
    ind.addEventListener('click', () => {
      showSlide(idx);
      startAutoPlay();
    });
  });

  startAutoPlay();
}

function setupAccessibility() {
  const btnFont = document.getElementById('btn-font-toggle');
  if (btnFont) {
    btnFont.addEventListener('click', () => {
      const chassis = document.querySelector('.phone-chassis');
      if (chassis.classList.contains('large-font')) {
        chassis.classList.remove('large-font');
        btnFont.textContent = 'A+';
      } else {
        chassis.classList.add('large-font');
        btnFont.textContent = 'A-';
      }
    });
  }
}



function setupOnboarding() {
  const slider = document.getElementById('onboarding-slider');
  const slides = document.querySelectorAll('.onboarding-slide');
  const dots = document.querySelectorAll('.onboarding-dot');
  const progressFill = document.getElementById('onboarding-progress');
  const nextBtn = document.getElementById('btn-onboarding-next');
  const skipBtn = document.getElementById('btn-onboarding-skip');
  let currentIdx = 0;
  let autoplayInterval = null;

  // Track slide direction for animation
  let slideDirection = 'right'; // 'left' or 'right'

  function updateOnboardingView(idx, dir) {
    slideDirection = dir || (idx > currentIdx ? 'right' : 'left');
    
    slides.forEach((slide, i) => {
      slide.classList.remove('active', 'slide-exit-left', 'slide-exit-right');
      if (i === idx) {
        // Set entry direction
        slide.style.transform = slideDirection === 'right' ? 'translateX(60px)' : 'translateX(-60px)';
        slide.style.opacity = '0';
        slide.classList.add('active');
        // Trigger reflow then animate in
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            slide.style.transform = 'translateX(0)';
            slide.style.opacity = '1';
          });
        });
      } else {
        slide.style.transform = '';
        slide.style.opacity = '0';
      }
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === idx);
    });
    
    const pct = ((idx + 1) / slides.length) * 100;
    if (progressFill) progressFill.style.width = pct + "%";
    
    currentIdx = idx;

    const textSpan = nextBtn ? nextBtn.querySelector('.onboarding-btn-text') : null;
    if (textSpan) {
      textSpan.textContent = idx === slides.length - 1 ? 'Get Started' : 'Next';
    } else if (nextBtn) {
      nextBtn.textContent = idx === slides.length - 1 ? 'Get Started' : 'Next';
    }
  }

  function advanceOnboarding() {
    if (currentIdx < slides.length - 1) {
      updateOnboardingView(currentIdx + 1, 'right');
    } else {
      finishOnboarding();
    }
  }

  function goBack() {
    if (currentIdx > 0) {
      updateOnboardingView(currentIdx - 1, 'left');
    }
  }

  function finishOnboarding() {
    stopAutoplay();
    localStorage.setItem('onboarding_completed', 'true');
    switchScreen('screen-dashboard');
  }

  function startAutoplay() {
    stopAutoplay();
    autoplayInterval = setInterval(() => {
      if (currentIdx < slides.length - 1) {
        updateOnboardingView(currentIdx + 1, 'right');
      } else {
        updateOnboardingView(0, 'right');
      }
    }, 3000);
  }

  function stopAutoplay() {
    if (autoplayInterval) {
      clearInterval(autoplayInterval);
      autoplayInterval = null;
    }
  }

  // Touch swipe support
  let touchStartX = 0;
  let touchEndX = 0;
  const minSwipeDistance = 50;

  if (slider) {
    slider.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
      stopAutoplay();
    }, { passive: true });

    slider.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const diff = touchStartX - touchEndX;
      if (Math.abs(diff) > minSwipeDistance) {
        if (diff > 0) {
          // Swiped left → next slide
          if (currentIdx < slides.length - 1) {
            updateOnboardingView(currentIdx + 1, 'right');
          }
        } else {
          // Swiped right → previous slide
          if (currentIdx > 0) {
            updateOnboardingView(currentIdx - 1, 'left');
          }
        }
      }
    }, { passive: true });
  }

  // Button listeners
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      stopAutoplay();
      advanceOnboarding();
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      finishOnboarding();
    });
  }

  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      stopAutoplay();
      updateOnboardingView(i, i > currentIdx ? 'right' : 'left');
    });
  });

  // Expose hooks
  window.triggerOnboardingAutoplay = () => {
    updateOnboardingView(0, 'right');
    startAutoplay();
  };
  window.stopOnboardingAutoplay = stopAutoplay;
}

