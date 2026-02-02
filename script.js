/**
 * AIRCRAFT MAINTENANCE COLLABORATIVE WO SYSTEM
 * FRONTEND LOGIC
 */

const API = "https://script.google.com/macros/s/AKfycbyneQ_EO9rlekZQrinWWuy9jsEcdkjStvBBPsjr4WzMfDmQVsPpdobmt8Ctgcnr3QJusg/exec";
const urlParams = new URLSearchParams(window.location.search);
const SHEET_ID = urlParams.get('sheetId') || "1IyjNL723csoFdYA9Zo8_oMOhIxzPPpNOXw5YSJLGh-c";

let APP_STATE = {
    info: {},
    findings: [],
    materials: [],
    logs: [],
    woId: "" // Fetched from INFO!C4
};

window.addEventListener('DOMContentLoaded', () => {
    fetchInitialData();      // Initial load (shows loader)
    setupGlobalEvents();
    startTimerEngine();

    // ADD THIS: Refresh data every 30 seconds without showing loader
    setInterval(() => {
        fetchInitialData(true); 
    }, 30000); 
});

function setupGlobalEvents() {
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.onclick = () => document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    });
    document.getElementById('final-status-select').onchange = (e) => {
        const uploadBox = document.getElementById('evidence-upload-section');
        e.target.value === 'CLOSED' ? uploadBox.classList.remove('hidden') : uploadBox.classList.add('hidden');
    };
}

async function fetchInitialData(isBackground = false) {
    // 1. Only show the loading spinner if the user clicked something.
    // We don't want the spinner to pop up every 30 seconds during auto-sync.
    if (!isBackground) showLoader(true); 

    try {
        const response = await fetch(`${API}?sheetId=${SHEET_ID}&action=getWOData`);
        const result = await response.json();

        if (result.success) {
            APP_STATE.info = result.data.info;
            APP_STATE.findings = result.data.findings;
            APP_STATE.materials = result.data.materials;
            APP_STATE.logs = result.data.logs;
            APP_STATE.woId = result.data.info.woNo;

            // Re-draw the screen with the new data from other users
            renderHeader();
            renderFindings();
        } else {
            // Only show alert if user is manually loading. 
            // If background fails, just log it to console.
            if (!isBackground) alert("Error: " + result.error);
            console.warn("Background sync failed:", result.error);
        }
    } catch (e) {
        if (!isBackground) alert("System connection failure.");
        console.error("Network error during sync:", e);
    } finally {
        // 2. Only hide the loader if we actually showed it
        if (!isBackground) showLoader(false);
    }
}

function renderHeader() {
    document.getElementById('wo-title').textContent = `WO: ${APP_STATE.woId}`;
    document.getElementById('header-reg').textContent = APP_STATE.info.reg;
    document.getElementById('header-customer').textContent = APP_STATE.info.customer;
    document.getElementById('info-desc').textContent = APP_STATE.info.description;
    document.getElementById('info-pn').textContent = APP_STATE.info.pn;
    document.getElementById('info-sn').textContent = APP_STATE.info.sn;
}

function renderFindings() {
    const container = document.getElementById('findings-container');
    container.innerHTML = '';
    
    if (!APP_STATE.findings || APP_STATE.findings.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px;">No findings found.</p>';
        return;
    }

    APP_STATE.findings.forEach(f => {
        const card = document.createElement('div');
        card.className = 'finding-card';
        
        const imageUrl = formatDriveUrl(f.imageUrl);
        const evidenceImg = f.evidenceUrl ? formatDriveUrl(f.evidenceUrl) : null;
        
        // Build the image block (Single or Comparison)
        let imageHtml = `
            <div class="image-comparison">
                <div class="img-box">
                    <small>ORIGINAL FINDING</small>
                    <img src="${imageUrl}" class="finding-thumb" onclick="previewImage('${imageUrl}')">
                </div>
        `;

        if (evidenceImg) {
            imageHtml += `
                <div class="img-box">
                    <small>AFTER REPAIR</small>
                    <img src="${evidenceImg}" class="finding-thumb" onclick="previewImage('${evidenceImg}')">
                </div>
            `;
        }
        imageHtml += `</div>`;

        // Create the card content
        card.innerHTML = `
            <div class="card-header" onclick="toggleCard('${f.no}')">
                <div><h4>Finding #${f.no}</h4><span class="summary-text">${f.description}</span></div>
                <span class="badge status-${(f.status || 'OPEN').toLowerCase().replace('_','-')}">${f.status || 'OPEN'}</span>
            </div>
            <div id="body-${f.no}" class="card-body hidden">
                <div class="description-box"><strong>Finding:</strong> ${f.description}</div>
                <div class="description-box"><strong>Action Given:</strong> ${f.actionGiven}</div>
                
                ${imageHtml} 

                <div class="section-title">Materials</div>
                <table class="material-table"><tbody>${renderMaterialRows(f.no)}</tbody></table>
                
                <div class="section-title">Man-Hour Action</div>
                <div class="controls-row">
                    <input type="text" id="emp-${f.no}" placeholder="EMP ID">
                    <input type="text" id="task-${f.no}" placeholder="Task Code">
                </div>
                <div class="controls-row">
                    <button class="btn btn-primary" onclick="handleStart('${f.no}')">START</button>
                    <button class="btn btn-danger" onclick="handleStopPrompt('${f.no}')">STOP</button>
                </div>
                
                <div class="active-timers-container" id="timers-${f.no}"></div>
                
                <div class="section-title">Log</div>
                <table class="log-table"><tbody>${renderLogRows(f.no)}</tbody></table>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderMaterialRows(fNo) {
    const filtered = APP_STATE.materials.filter(m => m.findingNo == fNo);
    
    // If no materials, show a message across all columns
    if (!filtered.length) return '<tr><td colspan="4">No materials required</td></tr>';
    
    // Header for the materials (Optional: adds clarity)
    const header = `<tr style="font-weight:bold; background:#eee;">
                        <td>P/N</td>
                        <td>Description</td>
                        <td>Qty</td>
                        <td>Avail</td>
                    </tr>`;

    const rows = filtered.map(m => `
        <tr>
            <td><b>${m.pn}</b></td>
            <td>${m.desc || "-"}</td>
            <td>${m.qty} ${m.uom}</td>
            <td>
                <span style="color: ${m.avail === 'INSTOCK' ? 'var(--success)' : 'var(--danger)'}; font-weight: bold;">
                    ${m.avail}
                </span>
            </td>
        </tr>
    `).join('');

    return header + rows;
}

function renderLogRows(fNo) {
    const filtered = APP_STATE.logs.filter(l => l.findingNo == fNo).reverse();
    
    if (filtered.length === 0) return '<tr><td colspan="5" style="text-align:center;">No logs yet</td></tr>';

    return filtered.map(l => {
        // Create the date object from the timestamp
        const d = new Date(l.timestamp);
        
        // 1. Format Date: 24 May 2024
        const dateStr = d.toLocaleDateString('en-GB', { 
            day: '2-digit', month: 'short', year: 'numeric' 
        });

        // 2. Format Time: 14:30
        const timeStr = d.toLocaleTimeString('en-GB', { 
            hour: '2-digit', minute: '2-digit', hour12: false 
        });

        // 3. Format Duration (Only show if action is STOP and duration exists)
        let durationDisplay = "-";
        if (l.action === 'STOP' && l.duration) {
            durationDisplay = formatDuration(l.duration);
        }

        const statusText = l.status || "";

        // YOUR CODE HERE:
        return `
            <tr>
                <td style="font-size: 0.85em; line-height: 1.2;">
                    ${dateStr}<br>
                    <small style="color: #666; font-size: 0.75em;">${timeStr}</small>
                </td>
                <td><b>${l.employeeId}</b></td>
                <td>
                    <span class="badge ${l.action === 'START' ? 'status-in-progress' : 'status-closed'}">
                        ${l.action}
                    </span>
                </td>
                <td style="font-family: monospace; font-weight: bold; color: var(--primary-dark);">
                    ${durationDisplay}
                </td>
                <td><small>${statusText}</small></td>
            </tr>`;
    }).join('');
}

// Helper function to turn seconds into "1h 20m" or "45s"
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return "-";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}
function toggleCard(fNo) { document.getElementById(`body-${fNo}`).classList.toggle('hidden'); }

function formatDriveUrl(url) {
    if (!url) return "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Noimage.svg/250px-Noimage.svg.png";
    const match = url.match(/[-\w]{25,}/);
    return match ? `https://drive.google.com/thumbnail?id=${match[0]}&sz=w800` : url;
}

function previewImage(url) {
    document.getElementById('modal-img-large').src = url;
    document.getElementById('image-modal').style.display = 'block';
}

function handleStart(fNo) {
    const empId = document.getElementById(`emp-${fNo}`).value.trim();
    const taskCode = document.getElementById(`task-${fNo}`).value.trim();
    if (!empId || !taskCode) return alert("Fill credentials");
    const actives = getActiveSessions(fNo);
    if (actives.length > 0) {
        const modal = document.getElementById('conflict-modal');
        document.getElementById('active-mechanics-list').innerHTML = actives.map(a => `<li>${a.employeeId}</li>`).join('');
        document.getElementById('confirm-join').onclick = () => { modal.style.display = 'none'; executeStart(fNo, empId, taskCode); };
        modal.style.display = 'block';
    } else { executeStart(fNo, empId, taskCode); }
}

async function executeStart(fNo, empId, taskCode) {
    showLoader(true);
    try {
        await fetch(API, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'startManhour', sheetId: SHEET_ID, woId: APP_STATE.woId, findingId: fNo, employeeId: empId, taskCode: taskCode, startTime: new Date().toISOString() }) });
        setTimeout(fetchInitialData, 2000);
    } catch (e) { showLoader(false); }
}

function handleStopPrompt(fNo) {
    const actives = getActiveSessions(fNo);
    if (!actives.length) return alert("No active sessions");
    if (actives.length === 1) { processStop(fNo, actives[0].employeeId); }
    else {
        const modal = document.getElementById('stop-modal');
        const container = document.getElementById('stop-user-options');
        container.innerHTML = '';
        actives.forEach(a => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary'; btn.textContent = a.employeeId;
            btn.onclick = () => { modal.style.display = 'none'; processStop(fNo, a.employeeId); };
            container.appendChild(btn);
        });
        modal.style.display = 'block';
    }
}

function processStop(fNo, empId) {
    const actives = getActiveSessions(fNo);
    if (actives.length === 1) {
        document.getElementById('final-modal').style.display = 'block';
        document.getElementById('submit-finalize').onclick = () => finalizeStop(fNo, empId, true);
    } else { finalizeStop(fNo, empId, false); }
}

async function finalizeStop(fNo, empId, isLast) {
    const finalStatus = isLast ? document.getElementById('final-status-select').value : 'IN_PROGRESS';
    let evidenceBase64 = "";
    if (isLast && finalStatus === 'CLOSED') {
        const file = document.getElementById('evidence-file').files[0];
        if (!file) return alert("Evidence required");
        evidenceBase64 = await toBase64(file);
    }
    showLoader(true);
    try {
        await fetch(API, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'stopManhour', sheetId: SHEET_ID, woId: APP_STATE.woId, findingId: fNo, employeeId: empId, stopTime: new Date().toISOString(), finalStatus: finalStatus, evidenceBase64: evidenceBase64 }) });
        document.getElementById('final-modal').style.display = 'none';
        setTimeout(fetchInitialData, 2500);
    } catch (e) { showLoader(false); }
}

function getActiveSessions(fNo) {
    const logs = APP_STATE.logs.filter(l => l.findingNo == fNo);
    const activeMap = {};
    logs.forEach(l => { if (l.action === 'START') activeMap[l.employeeId] = l; else if (l.action === 'STOP') delete activeMap[l.employeeId]; });
    return Object.values(activeMap);
}

function startTimerEngine() {
    setInterval(() => {
        APP_STATE.findings.forEach(f => {
            const container = document.getElementById(`timers-${f.no}`);
            if (!container) return;
            const actives = getActiveSessions(f.no);
            container.innerHTML = actives.map(a => {
                const diff = Math.floor((new Date() - new Date(a.timestamp)) / 1000);
                const h = Math.floor(diff / 3600).toString().padStart(2,'0');
                const m = Math.floor((diff % 3600) / 60).toString().padStart(2,'0');
                const s = (diff % 60).toString().padStart(2,'0');
                return `<div class="timer-row"><span>${a.employeeId}</span><span class="timer-val">${h}:${m}:${s}</span></div>`;
            }).join('');
        });
    }, 1000);
}

function showLoader(show) { document.getElementById('loader').style.display = show ? 'flex' : 'none'; }
function toBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; }); }
// Add this to your code
const REFRESH_INTERVAL = 30000; // Refresh every 30 seconds (adjust as needed)

function startAutoRefresh() {
    setInterval(() => {
        // Fetch data in the background without showing the heavy loader
        fetchInitialData(true); 
    }, REFRESH_INTERVAL);
}
