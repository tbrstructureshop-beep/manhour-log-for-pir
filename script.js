// CONFIGURATION
const API = "https://script.google.com/macros/s/AKfycbyneQ_EO9rlekZQrinWWuy9jsEcdkjStvBBPsjr4WzMfDmQVsPpdobmt8Ctgcnr3QJusg/exec"; // REPLACE AFTER DEPLOYMENT
const urlParams = new URLSearchParams(window.location.search);
const SHEET_ID = urlParams.get('sheetId') || "1IyjNL723csoFdYA9Zo8_oMOhIxzPPpNOXw5YSJLGh-c";
const WO_ID = urlParams.get('woId');

// STATE
let woData = null;
let activeSessions = [];
let logs = [];
let timers = {};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    if (!WO_ID) {
        alert("Critical Error: Missing Work Order ID");
        return;
    }
    fetchData();
    setInterval(updateTimers, 1000);
});

async function fetchData() {
    showLoader(true);
    try {
        const response = await fetch(`${API}?action=getWOData&sheetId=${SHEET_ID}&woId=${WO_ID}`);
        const result = await response.json();
        
        if (result.success) {
            woData = result.data;
            renderHeader(woData.info);
            renderFindings(woData.findings, woData.materials);
            updateStatus('Connected', 'var(--success)');
            
            // Fetch live manhour data
            await fetchManhours();
        }
    } catch (err) {
        console.error(err);
        updateStatus('Offline / Error', 'var(--danger)');
    } finally {
        showLoader(false);
    }
}

async function fetchManhours() {
    try {
        const response = await fetch(`${API}?action=getManhourData&sheetId=${SHEET_ID}&woId=${WO_ID}`);
        const result = await response.json();
        if (result.success) {
            activeSessions = result.active;
            logs = result.logs;
            renderActiveSessions();
            renderLogs();
        }
    } catch (e) { console.error("Manhour fetch failed", e); }
}

function renderHeader(info) {
    document.getElementById('wo-title').innerText = `WO: ${info.woNo}`;
    document.getElementById('info-customer').innerText = info.customer;
    document.getElementById('info-reg').innerText = info.reg;
    document.getElementById('info-wo-no').innerText = info.woNo;
    document.getElementById('info-part-desc').innerText = info.partDesc;
    document.getElementById('info-part-no').innerText = info.partNo;
    document.getElementById('info-serial').innerText = info.serial;
}

function renderFindings(findings, materials) {
    const container = document.getElementById('findings-container');
    container.innerHTML = '';

    findings.forEach(finding => {
        const card = document.createElement('div');
        card.className = 'card finding-card';
        card.id = `finding-${finding.no}`;
        
        const matRows = materials
            .filter(m => m.findingNo == finding.no)
            .map(m => `<tr><td>${m.partNo}</td><td>${m.desc}</td><td>${m.qty} ${m.uom}</td><td>${m.status}</td></tr>`)
            .join('');

        const imgUrl = finding.imageUrl || 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Noimage.svg/250px-Noimage.svg.png';

        card.innerHTML = `
            <div class="finding-header" onclick="toggleFinding('${finding.no}')">
                <div class="finding-summary">
                    <h3>Finding ${finding.no}</h3>
                    <p>${finding.description}</p>
                </div>
                <div class="chevron">▼</div>
            </div>
            <div class="finding-content">
                <div class="section-title">A. Finding Details</div>
                <div class="action-text">${finding.action}</div>
                <img src="${imgUrl}" class="finding-img-thumb" onclick="openImage('${imgUrl}')">
                
                <div class="table-responsive">
                    <table>
                        <thead><tr><th>Part No</th><th>Desc</th><th>Qty</th><th>Availability</th></tr></thead>
                        <tbody>${matRows || '<tr><td colspan="4">No materials required</td></tr>'}</tbody>
                    </table>
                </div>

                <div class="section-title">B. Man-Hour Logic</div>
                <div class="manhour-controls">
                    <div class="active-mechanics-list" id="active-list-${finding.no}"></div>
                    
                    <div class="input-row">
                        <div class="input-group">
                            <label>Employee ID</label>
                            <input type="text" id="emp-${finding.no}" placeholder="ID...">
                        </div>
                        <div class="input-group">
                            <label>Task Code</label>
                            <input type="text" id="task-${finding.no}" placeholder="Code...">
                        </div>
                    </div>
                    <div class="input-row">
                        <button class="btn btn-start" onclick="handleStart('${finding.no}')">START JOB</button>
                        <button class="btn btn-stop" onclick="handleStopPrompt('${finding.no}')">STOP JOB</button>
                    </div>
                    
                    <span class="performing-log-toggle" onclick="toggleLog('${finding.no}')">View Performing Log</span>
                    <div id="log-table-${finding.no}" class="table-responsive hidden">
                        <table id="table-log-${finding.no}">
                            <thead><tr><th>Time</th><th>User</th><th>Task</th><th>Action</th></tr></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// LOGIC FUNCTIONS
function toggleFinding(no) {
    const card = document.getElementById(`finding-${no}`);
    card.classList.toggle('active');
}

function toggleLog(no) {
    document.getElementById(`log-table-${no}`).classList.toggle('hidden');
}

async function handleStart(findingId) {
    const empId = document.getElementById(`emp-${findingId}`).value.trim();
    const task = document.getElementById(`task-${findingId}`).value.trim();
    
    if (!empId || !task) return alert("Enter Employee ID and Task Code");

    const alreadyActive = activeSessions.filter(s => s.findingId == findingId);
    
    if (alreadyActive.length > 0) {
        document.getElementById('conflict-msg').innerText = `Finding is already being worked on by: ${alreadyActive.map(a => a.employeeId).join(', ')}`;
        showModal('modal-conflict');
        document.getElementById('btn-confirm-parallel').onclick = () => performStart(findingId, empId, task);
        document.getElementById('btn-cancel-parallel').onclick = () => hideModals();
    } else {
        performStart(findingId, empId, task);
    }
}

async function performStart(findingId, employeeId, taskCode) {
    hideModals();
    showLoader(true);
    try {
        const payload = {
            action: 'startManhour',
            sheetId: SHEET_ID,
            woId: WO_ID,
            findingId,
            employeeId,
            taskCode,
            startTime: new Date().toISOString()
        };
        
        const res = await fetch(API, { method: 'POST', body: JSON.stringify(payload) });
        const result = await res.json();
        if (result.success) await fetchData();
    } catch (e) { alert("Failed to start session"); }
    showLoader(false);
}

function handleStopPrompt(findingId) {
    const active = activeSessions.filter(s => s.findingId == findingId);
    if (active.length === 0) return alert("No active sessions for this finding");

    if (active.length === 1) {
        promptFinalStatus(findingId, active[0]);
    } else {
        const listContainer = document.getElementById('active-users-list');
        listContainer.innerHTML = '';
        active.forEach(sess => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.innerText = `Stop Session: ${sess.employeeId} (${sess.taskCode})`;
            btn.onclick = () => promptFinalStatus(findingId, sess);
            listContainer.appendChild(btn);
        });
        showModal('modal-select-user');
    }
}

function promptFinalStatus(findingId, session) {
    hideModals();
    const isLastUser = activeSessions.filter(s => s.findingId == findingId).length === 1;
    
    if (isLastUser) {
        showModal('modal-final');
        const statusSelect = document.getElementById('final-status-select');
        const evidenceSection = document.getElementById('evidence-upload-section');
        
        statusSelect.onchange = () => {
            evidenceSection.classList.toggle('hidden', statusSelect.value !== 'CLOSED');
        };

        document.getElementById('btn-submit-final').onclick = async () => {
            let base64 = "";
            if (statusSelect.value === 'CLOSED') {
                const fileInput = document.getElementById('evidence-file');
                if (fileInput.files.length === 0) return alert("Evidence photo is required for CLOSING");
                base64 = await toBase64(fileInput.files[0]);
            }
            performStop(findingId, session, statusSelect.value, base64);
        };
    } else {
        performStop(findingId, session, 'IN_PROGRESS', '');
    }
}

async function performStop(findingId, session, finalStatus, evidence) {
    hideModals();
    showLoader(true);
    const stopTime = new Date().toISOString();
    const duration = Math.floor((new Date(stopTime) - new Date(session.startTime)) / 1000);

    try {
        const payload = {
            action: 'stopManhour',
            sheetId: SHEET_ID,
            woId: WO_ID,
            findingId,
            employeeId: session.employeeId,
            stopTime,
            durationSeconds: duration,
            evidenceBase64: evidence,
            status: finalStatus
        };
        
        await fetch(API, { method: 'POST', body: JSON.stringify(payload) });
        await fetchData();
    } catch (e) { alert("Stop action failed"); }
    showLoader(false);
}

// UI HELPERS
function showLoader(show) { document.getElementById('global-loader').classList.toggle('hidden', !show); }
function showModal(id) { 
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}
function hideModals() { document.getElementById('modal-overlay').classList.add('hidden'); }
function updateStatus(text, color) { 
    const b = document.getElementById('connection-status');
    b.innerText = text; b.style.background = color; 
}
function openImage(url) {
    document.getElementById('full-image').src = url;
    showModal('modal-image');
}

function renderActiveSessions() {
    // Clear all active lists
    document.querySelectorAll('.active-mechanics-list').forEach(l => l.innerHTML = '');
    timers = {};

    activeSessions.forEach(sess => {
        const list = document.getElementById(`active-list-${sess.findingId}`);
        if (!list) return;

        const div = document.createElement('div');
        div.className = 'active-mechanic';
        div.innerHTML = `
            <span><strong>${sess.employeeId}</strong> (${sess.taskCode})</span>
            <span class="timer" id="timer-${sess.findingId}-${sess.employeeId}">00:00:00</span>
        `;
        list.appendChild(div);
        timers[`${sess.findingId}-${sess.employeeId}`] = sess.startTime;
    });
}

function renderLogs() {
    document.querySelectorAll('[id^="table-log-"] tbody').forEach(tb => tb.innerHTML = '');
    logs.forEach(log => {
        const tbody = document.querySelector(`#table-log-${log.findingId} tbody`);
        if (!tbody) return;
        const row = `<tr>
            <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
            <td><b>${log.employeeId}</b></td>
            <td>${log.taskCode}</td>
            <td>${log.action}</td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

function updateTimers() {
    for (let key in timers) {
        const el = document.getElementById(`timer-${key}`);
        if (!el) continue;
        const start = new Date(timers[key]);
        const diff = Math.floor((new Date() - start) / 1000);
        el.innerText = formatDuration(diff);
    }
}

function formatDuration(sec) {
    const h = Math.floor(sec / 3600).toString().padStart(2, '0');
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
});

document.querySelector('.close-btn').onclick = hideModals;
document.querySelectorAll('.close-modal-btn').forEach(b => b.onclick = hideModals);
