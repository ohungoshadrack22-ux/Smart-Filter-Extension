// content.js — SmartFilter v1.5 (refresh count limit)

const STORAGE_KEY = `sf_config_${location.hostname}`;
const COUNT_KEY   = `sf_count_${location.hostname}`; // separate key — resets independently
const PRESETS = [
  { label: "5s",  secs: 5 },
  { label: "10s", secs: 10 },
  { label: "30s", secs: 30 },
  { label: "1m",  secs: 60 },
  { label: "5m",  secs: 300 },
  { label: "15m", secs: 900 },
];

let config = {
  enabled: false,
  showKeywords: [],
  hideKeywords: [],
  refreshEnabled: false,
  refreshInterval: 30,
  refreshMode: "always",
  notifyEnabled: false,
  countLimitEnabled: false,   // whether count limit is on
  countLimit: 10,             // max number of refreshes
};

// runtime state
let observer        = null;
let _tabId          = null;
let countdownTimer  = null;
let countdownSecs   = 0;
let knownMatchKeys  = new Set();
let currentCount    = 0;  // how many refreshes have happened this session

// ── Storage ───────────────────────────────────────────────────────────────────

function saveConfig() {
  chrome.storage.local.set({ [STORAGE_KEY]: config });
}

function loadConfig(cb) {
  chrome.storage.local.get([STORAGE_KEY, COUNT_KEY], (res) => {
    if (res[STORAGE_KEY]) config = { ...config, ...res[STORAGE_KEY] };
    currentCount = res[COUNT_KEY] ?? 0;
    cb();
  });
}

function saveCount() {
  chrome.storage.local.set({ [COUNT_KEY]: currentCount });
}

function resetCount() {
  currentCount = 0;
  saveCount();
  updateCountDisplay();
}

function getTabId() { return _tabId; }

// ── Filtering ─────────────────────────────────────────────────────────────────

function getRows() {
  return document.querySelectorAll("table tr, tbody tr, [role='row']");
}

function getMatchKey(row) {
  return row.textContent.trim().slice(0, 120);
}

function applyFilters({ checkNew = false } = {}) {
  if (!config.enabled) {
    getRows().forEach(r => r.style.display = "");
    updateCount(null, null);
    return;
  }
  const show = config.showKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  const hide = config.hideKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  let shown = 0, hidden = 0;
  const newMatches = [];

  getRows().forEach(row => {
    if (row.querySelector("th")) return;
    const text = row.textContent.toLowerCase();
    const blocked = hide.length > 0 && hide.some(k => text.includes(k));
    const allowed = show.length === 0 || show.some(k => text.includes(k));
    const visible = !blocked && allowed;
    row.style.display = visible ? "" : "none";
    if (visible) {
      shown++;
      const key = getMatchKey(row);
      if (checkNew && !knownMatchKeys.has(key)) newMatches.push(key);
      knownMatchKeys.add(key);
    } else {
      hidden++;
    }
  });

  updateCount(shown, hidden);
  if (checkNew && newMatches.length > 0 && config.notifyEnabled) {
    sendNotification(newMatches.length, shown);
  }
}

function sendNotification(newCount, totalShown) {
  chrome.runtime.sendMessage({
    type: "NOTIFY",
    title: "SmartFilter — New match found!",
    message: `${newCount} new row${newCount > 1 ? "s" : ""} appeared (${totalShown} total visible) on ${location.hostname}`
  });
}

function startObserver() {
  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    const hasNew = mutations.some(m => [...m.addedNodes].some(n => n.nodeType === 1));
    if (hasNew) applyFilters({ checkNew: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Refresh count logic ───────────────────────────────────────────────────────

// Called on every page load when count limit is active
function incrementAndCheckCount() {
  if (!config.countLimitEnabled || !config.refreshEnabled) return;

  currentCount++;
  saveCount();
  updateCountDisplay();

  if (currentCount >= config.countLimit) {
    // Limit reached — stop everything
    chrome.runtime.sendMessage({ type: "STOP_REFRESH", tabId: getTabId() });
    config.refreshEnabled = false;
    saveConfig();
    stopCountdown();
    updateRefreshBadge(false);

    // Notify user
    chrome.runtime.sendMessage({
      type: "NOTIFY",
      title: "SmartFilter — Refresh limit reached",
      message: `Stopped after ${currentCount} refresh${currentCount > 1 ? "es" : ""} on ${location.hostname}`
    });

    // Show stopped state in badge
    const badge = document.getElementById("__sf_refresh_badge");
    if (badge) {
      badge.textContent = `Stopped at ${currentCount}`;
      badge.style.background = "#451a03";
      badge.style.color = "#fed7aa";
    }
  }
}

function updateCountDisplay() {
  const el = document.getElementById("__sf_count_display");
  if (!el) return;
  if (!config.countLimitEnabled) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  const remaining = Math.max(0, config.countLimit - currentCount);
  const pct = Math.min(100, Math.round((currentCount / config.countLimit) * 100));
  el.innerHTML = `
    <div class="sf-count-progress-wrap">
      <div class="sf-count-progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="sf-count-row">
      <span class="sf-count-stat">${currentCount} / ${config.countLimit} refreshes</span>
      <span class="sf-count-remaining">${remaining} left</span>
    </div>
  `;
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function startCountdown(seconds) {
  stopCountdown();
  countdownSecs = seconds;
  updateCountdownDisplay(countdownSecs);
  countdownTimer = setInterval(() => {
    countdownSecs--;
    if (countdownSecs <= 0) countdownSecs = config.refreshInterval;
    updateCountdownDisplay(countdownSecs);
  }, 1000);
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  updateCountdownDisplay(null);
}

function updateCountdownDisplay(secs) {
  const el = document.getElementById("__sf_countdown");
  if (!el) return;
  if (secs === null) { el.style.display = "none"; return; }
  el.style.display = "block";
  const pct = Math.round((secs / config.refreshInterval) * 100);
  el.innerHTML = `
    <div class="sf-countdown-bar-wrap">
      <div class="sf-countdown-bar" style="width:${pct}%"></div>
    </div>
    <div class="sf-countdown-text">Next refresh in <strong>${secs}s</strong></div>
  `;
}

// ── Refresh pause-on-interaction ──────────────────────────────────────────────

let userIsActive = false;
let activityTimer = null;
const IDLE_GRACE = 5000;

function onUserActivity() {
  if (event && event.target && document.getElementById("__sf_panel")?.contains(event.target)) return;
  if (!userIsActive) {
    userIsActive = true;
    if (config.refreshMode === "interaction" && config.refreshEnabled) {
      chrome.runtime.sendMessage({ type: "STOP_REFRESH", tabId: getTabId() });
      showPausedIndicator(true);
      stopCountdown();
    }
  }
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => {
    userIsActive = false;
    if (config.refreshMode === "interaction" && config.refreshEnabled) {
      chrome.runtime.sendMessage({ type: "START_REFRESH", tabId: getTabId(), intervalSeconds: config.refreshInterval });
      showPausedIndicator(false);
      startCountdown(config.refreshInterval);
    }
  }, IDLE_GRACE);
}

function attachActivityListeners() {
  ["mousedown", "keydown", "scroll", "touchstart"].forEach(evt =>
    document.addEventListener(evt, onUserActivity, { passive: true })
  );
}

function showPausedIndicator(paused) {
  const badge = document.getElementById("__sf_refresh_badge");
  if (!badge) return;
  if (paused) {
    badge.textContent = "Paused";
    badge.style.background = "#7c2d12";
    badge.style.color = "#fed7aa";
  } else {
    updateRefreshBadge(true);
  }
}

// ── Panel helpers ─────────────────────────────────────────────────────────────

function updateCount(shown, hidden) {
  const el = document.getElementById("__sf_count");
  if (!el) return;
  if (shown === null) { el.textContent = "Filter off"; el.style.color = "#64748b"; }
  else { el.textContent = `${shown} shown · ${hidden} hidden`; el.style.color = "#fbbf24"; }
}

function updateRefreshBadge(active) {
  const badge = document.getElementById("__sf_refresh_badge");
  const btn   = document.getElementById("__sf_refresh_toggle");
  if (!badge || !btn) return;
  if (active) {
    badge.textContent = `Every ${formatInterval(config.refreshInterval)}`;
    badge.style.background = "#166534";
    badge.style.color = "#bbf7d0";
    btn.textContent = "Stop refresh";
  } else {
    badge.textContent = "Off";
    badge.style.background = "#1e293b";
    badge.style.color = "#64748b";
    btn.textContent = "Start refresh";
  }
}

function formatInterval(secs) {
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${secs / 60}m`;
  return `${secs / 3600}h`;
}

function syncPresetButtons() {
  document.querySelectorAll(".sf-preset-btn[data-secs]").forEach(btn => {
    btn.classList.toggle("sf-preset-active", parseInt(btn.dataset.secs) === config.refreshInterval);
  });
  const isPreset = PRESETS.some(p => p.secs === config.refreshInterval);
  const customRow = document.getElementById("__sf_custom_row");
  if (customRow) customRow.style.display = isPreset ? "none" : "flex";
}

function setInterval_(secs) {
  config.refreshInterval = secs;
  saveConfig();
  syncPresetButtons();
  updateRefreshBadge(config.refreshEnabled);
  if (config.refreshEnabled && config.refreshMode !== "manual") {
    chrome.runtime.sendMessage({ type: "START_REFRESH", tabId: getTabId(), intervalSeconds: secs });
    startCountdown(secs);
  }
}

function toggleCountFields(enabled) {
  const fields = document.getElementById("__sf_count_fields");
  if (fields) fields.style.opacity = enabled ? "1" : "0.4";
  updateCountDisplay();
}

// ── Build panel ───────────────────────────────────────────────────────────────

function buildPanel() {
  if (document.getElementById("__sf_panel")) return;

  const presetHTML = PRESETS.map(p =>
    `<button class="sf-preset-btn" data-secs="${p.secs}">${p.label}</button>`
  ).join("");

  const panel = document.createElement("div");
  panel.id = "__sf_panel";
  panel.innerHTML = `
    <div id="__sf_header">
      <span id="__sf_title">⚡ SmartFilter</span>
      <button id="__sf_minimize" title="Minimize">−</button>
    </div>

    <div id="__sf_body">

      <!-- Filter section -->
      <div class="sf-section">
        <div class="sf-row">
          <span class="sf-label">Filter rows</span>
          <label class="sf-toggle">
            <input type="checkbox" id="__sf_filter_on">
            <span class="sf-slider"></span>
          </label>
        </div>
      </div>
      <div class="sf-section" id="__sf_filter_fields">
        <div class="sf-field-label">Show rows containing</div>
        <textarea id="__sf_show" placeholder="captioning, translation, proofreading" rows="2"></textarea>
        <div class="sf-field-label" style="margin-top:8px">Hide rows containing</div>
        <textarea id="__sf_hide" placeholder="inaudible, test" rows="2"></textarea>
        <button id="__sf_apply">Apply filters</button>
        <div id="__sf_count" class="sf-count">Filter off</div>
      </div>

      <div class="sf-divider"></div>

      <!-- Refresh section -->
      <div class="sf-section">
        <div class="sf-row">
          <span class="sf-label">Auto refresh</span>
          <span id="__sf_refresh_badge" class="sf-badge">Off</span>
        </div>

        <div class="sf-field-label" style="margin-top:10px">Interval</div>
        <div class="sf-preset-grid">${presetHTML}</div>
        <button class="sf-preset-btn sf-custom-trigger" id="__sf_custom_trigger">+ Custom</button>
        <div id="__sf_custom_row" style="display:none;align-items:center;gap:6px;margin-top:6px">
          <input type="number" id="__sf_interval" min="5" max="86400" placeholder="secs">
          <span class="sf-field-label" style="margin:0">s</span>
          <button id="__sf_custom_set" class="sf-set-btn">Set</button>
        </div>

        <div class="sf-field-label" style="margin-top:10px">Refresh mode</div>
        <div class="sf-mode-group">
          <label class="sf-mode-btn"><input type="radio" name="sf_mode" value="always"><span>Always</span></label>
          <label class="sf-mode-btn"><input type="radio" name="sf_mode" value="interaction"><span>Pause on use</span></label>
          <label class="sf-mode-btn"><input type="radio" name="sf_mode" value="manual"><span>Manual only</span></label>
        </div>
        <div id="__sf_mode_hint" class="sf-mode-hint"></div>

        <button id="__sf_refresh_toggle">Start refresh</button>
        <button id="__sf_refresh_now" class="sf-secondary-btn">Refresh now</button>
        <div id="__sf_countdown" style="display:none;margin-top:8px"></div>
      </div>

      <div class="sf-divider"></div>

      <!-- Refresh count limit section -->
      <div class="sf-section">
        <div class="sf-row">
          <span class="sf-label">Refresh limit</span>
          <label class="sf-toggle">
            <input type="checkbox" id="__sf_count_limit_on">
            <span class="sf-slider"></span>
          </label>
        </div>
        <div id="__sf_count_fields">
          <div class="sf-count-input-row">
            <span class="sf-field-label" style="margin:0">Stop after</span>
            <input type="number" id="__sf_count_limit_val" min="1" max="9999" value="10">
            <span class="sf-field-label" style="margin:0">refreshes</span>
          </div>
          <div id="__sf_count_display" style="display:none;margin-top:8px"></div>
          <button id="__sf_count_reset" class="sf-secondary-btn" style="margin-top:6px">Reset counter</button>
        </div>
      </div>

      <div class="sf-divider"></div>

      <!-- Notifications section -->
      <div class="sf-section">
        <div class="sf-row">
          <span class="sf-label">Notifications</span>
          <label class="sf-toggle">
            <input type="checkbox" id="__sf_notify_on">
            <span class="sf-slider"></span>
          </label>
        </div>
        <div class="sf-field-label" style="margin-top:4px">Alert when new matching rows appear.</div>
      </div>

    </div>
  `;

  document.body.appendChild(panel);
  makeDraggable(panel);

  // Restore values
  document.getElementById("__sf_filter_on").checked       = config.enabled;
  document.getElementById("__sf_show").value               = config.showKeywords.join(", ");
  document.getElementById("__sf_hide").value               = config.hideKeywords.join(", ");
  document.getElementById("__sf_notify_on").checked        = config.notifyEnabled;
  document.getElementById("__sf_count_limit_on").checked   = config.countLimitEnabled;
  document.getElementById("__sf_count_limit_val").value    = config.countLimit;
  toggleFilterFields(config.enabled);
  toggleCountFields(config.countLimitEnabled);

  const savedMode = document.querySelector(`input[name="sf_mode"][value="${config.refreshMode}"]`);
  if (savedMode) savedMode.checked = true;
  updateModeHint(config.refreshMode);
  syncPresetButtons();
  updateCountDisplay();

  chrome.runtime.sendMessage({ type: "GET_ALARM", tabId: getTabId() }, (res) => {
    const active = res && res.active;
    updateRefreshBadge(active);
    if (active) startCountdown(config.refreshInterval);
  });

  // ── Listeners ────────────────────────────────────────────────────────────────

  document.getElementById("__sf_filter_on").addEventListener("change", (e) => {
    config.enabled = e.target.checked;
    toggleFilterFields(config.enabled);
    saveConfig();
    applyFilters();
  });

  document.getElementById("__sf_apply").addEventListener("click", () => {
    config.showKeywords = parseKeywords(document.getElementById("__sf_show").value);
    config.hideKeywords = parseKeywords(document.getElementById("__sf_hide").value);
    saveConfig();
    applyFilters();
  });

  document.querySelectorAll(".sf-preset-btn[data-secs]").forEach(btn => {
    btn.addEventListener("click", () => setInterval_(parseInt(btn.dataset.secs)));
  });

  document.getElementById("__sf_custom_trigger").addEventListener("click", () => {
    const row = document.getElementById("__sf_custom_row");
    row.style.display = row.style.display === "none" ? "flex" : "none";
    if (row.style.display === "flex") document.getElementById("__sf_interval").focus();
    document.querySelectorAll(".sf-preset-btn").forEach(b => b.classList.remove("sf-preset-active"));
  });

  document.getElementById("__sf_custom_set").addEventListener("click", () => {
    const secs = parseInt(document.getElementById("__sf_interval").value);
    if (!secs || secs < 5) return;
    setInterval_(secs);
    document.getElementById("__sf_custom_row").style.display = "none";
  });

  document.getElementById("__sf_interval").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("__sf_custom_set").click();
  });

  document.querySelectorAll("input[name='sf_mode']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      config.refreshMode = e.target.value;
      saveConfig();
      updateModeHint(config.refreshMode);
    });
  });

  document.getElementById("__sf_count_limit_on").addEventListener("change", (e) => {
    config.countLimitEnabled = e.target.checked;
    saveConfig();
    toggleCountFields(config.countLimitEnabled);
    if (!config.countLimitEnabled) resetCount();
  });

  document.getElementById("__sf_count_limit_val").addEventListener("change", (e) => {
    config.countLimit = parseInt(e.target.value) || 10;
    saveConfig();
    updateCountDisplay();
  });

  document.getElementById("__sf_count_reset").addEventListener("click", () => {
    resetCount();
    // If refresh was stopped by limit, restart it
    if (!config.refreshEnabled && config.countLimitEnabled) {
      config.refreshEnabled = true;
      saveConfig();
      if (config.refreshMode !== "manual") {
        chrome.runtime.sendMessage({ type: "START_REFRESH", tabId: getTabId(), intervalSeconds: config.refreshInterval });
        updateRefreshBadge(true);
        startCountdown(config.refreshInterval);
      }
    }
  });

  document.getElementById("__sf_notify_on").addEventListener("change", (e) => {
    config.notifyEnabled = e.target.checked;
    saveConfig();
    if (config.notifyEnabled) requestNotificationPermission();
  });

  document.getElementById("__sf_refresh_toggle").addEventListener("click", () => {
    const tabId = getTabId();
    chrome.runtime.sendMessage({ type: "GET_ALARM", tabId }, (res) => {
      if (res && res.active) {
        chrome.runtime.sendMessage({ type: "STOP_REFRESH", tabId }, () => {
          config.refreshEnabled = false;
          saveConfig();
          updateRefreshBadge(false);
          stopCountdown();
        });
      } else {
        config.refreshEnabled = true;
        saveConfig();
        if (config.refreshMode !== "manual") {
          chrome.runtime.sendMessage({ type: "START_REFRESH", tabId, intervalSeconds: config.refreshInterval }, () => {
            updateRefreshBadge(true);
            startCountdown(config.refreshInterval);
          });
        } else {
          updateRefreshBadge(true);
        }
      }
    });
  });

  document.getElementById("__sf_refresh_now").addEventListener("click", () => location.reload());

  document.getElementById("__sf_minimize").addEventListener("click", () => {
    const body = document.getElementById("__sf_body");
    const minimized = body.style.display === "none";
    body.style.display = minimized ? "" : "none";
    document.getElementById("__sf_minimize").textContent = minimized ? "−" : "+";
  });
}

function requestNotificationPermission() {
  if (Notification.permission === "default") Notification.requestPermission();
}

function updateModeHint(mode) {
  const hint = document.getElementById("__sf_mode_hint");
  if (!hint) return;
  const hints = {
    always:      "Refreshes on schedule regardless of activity.",
    interaction: "Pauses while you interact, resumes 5s after you stop.",
    manual:      "Only refreshes when you click 'Refresh now'."
  };
  hint.textContent = hints[mode] || "";
}

function toggleFilterFields(enabled) {
  const fields = document.getElementById("__sf_filter_fields");
  if (fields) fields.style.opacity = enabled ? "1" : "0.4";
}

function parseKeywords(str) {
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

// ── Draggable ─────────────────────────────────────────────────────────────────

function makeDraggable(el) {
  const header = document.getElementById("__sf_header");
  let startX, startY, startLeft, startTop;
  header.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    startX = e.clientX; startY = e.clientY;
    const rect = el.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
    const move = (e) => {
      el.style.left = `${startLeft + e.clientX - startX}px`;
      el.style.top  = `${startTop  + e.clientY - startY}px`;
      el.style.right = "auto"; el.style.bottom = "auto";
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    e.preventDefault();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (res) => {
  if (res) _tabId = res.tabId;
});

loadConfig(() => {
  setTimeout(() => {
    buildPanel();

    // Count this page load as a refresh (if refresh is active and limit is on)
    // Small delay so tabId is ready
    setTimeout(() => incrementAndCheckCount(), 200);

    applyFilters({ checkNew: false });
    getRows().forEach(row => {
      if (!row.querySelector("th") && row.style.display !== "none") {
        knownMatchKeys.add(getMatchKey(row));
      }
    });
    startObserver();
    attachActivityListeners();

    if (config.refreshEnabled && config.refreshMode !== "manual") {
      chrome.runtime.sendMessage({ type: "START_REFRESH", tabId: getTabId(), intervalSeconds: config.refreshInterval });
      updateRefreshBadge(true);
      startCountdown(config.refreshInterval);
    }
  }, 800);
});
