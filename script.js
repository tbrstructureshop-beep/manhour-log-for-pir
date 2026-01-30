/**
 * AIRCRAFT MAINTENANCE COLLABORATIVE WO SYSTEM
 * Vanilla JS Implementation
 */

// Replace with your Google Apps Script Web App URL
const API = "https://script.google.com/macros/s/AKfycbyneQ_EO9rlekZQrinWWuy9jsEcdkjStvBBPsjr4WzMfDmQVsPpdobmt8Ctgcnr3QJusg/exec";
const SHEET_ID = "1IyjNL723csoFdYA9Zo8_oMOhIxzPPpNOXw5YSJLGh-c";

// State management
let state = {
    woId: new URLSearchParams(window.location.search).get('woId') || 'WO-DEFAULT',
    header: {},
    findings: [],
    materials: [],
    manhours: [],
    timers: {}
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    if (!state.woId) {
        document.body.innerHTML = "<h1>Error: No WO ID specified.</h1>";
        return;
    }
    fetchData();
    startTimerEngine();
});

async function fetchData() {
    try {
        const response = await fetch(`${API}?action=getWOData&sheetId=${SHEET_ID}&woId=${state.woId}`);
        const data = await response.json();
        
        state.header = data.info;
        state.findings = data.findings;
        state.materials = data.materials;
        state.manhours = data.manhours;
        
        renderHeader();
        renderFindings();
    } catch (e) {
        console.error("Fetch error:", e);
    }
}

function renderHeader() {
    document.getElementById('wo-no').textContent = state.header.woNo || 'N/A';
    document.getElementById('ac-reg').textContent = state.header.acReg || '--';
    document.getElementById('customer').textContent = state.header.customer || '--';
    document.getElementById('part-desc').textContent = state.header.partDesc || '--';
    document.getElementById('part-no').textContent = state.header.partNo || '--';
    document.getElementById('serial-no').textContent = state.header.serialNo || '--';
}

function renderFindings() {
    const container = document.getElementById('findings-container');
    container.innerHTML = '';

    state.findings.forEach(finding => {
        const activeSessions = state.manhours.filter(m => m.findingId === finding.id && !m.stopTime);
        const historySessions = state.manhours.filter(m => m.findingId === finding.id && m.stopTime);
        const card = document.createElement('div');
        card.className = 'finding-card';
        card.innerHTML = `
            <div class="card-header" onclick="toggleCard(this)">
                <div class="finding-summary">
                    <h3>Finding ${finding.id}</h3>
                    <p>${finding.description}</p>
                </div>
                <div class="chevron"></div>
            </div>
            <div class="card-content">
                <div class="section-title">A. Finding Info</div>
                <img class="finding-img-thumb" src="${formatDriveUrl(finding.imageUrl)}" onclick="openImage('${finding.imageUrl}')">
                <p><strong>Action:</strong> ${finding.action}</p>
                
                <div class="table-container">
                    <table>
                        <thead><tr><th>Part No</th><th>Desc</th><th>Qty</th><th>Status</th></tr></thead>
                        <tbody>${renderMaterials(finding.id)}</tbody>
                    </table>
                </div>

                <div class="section-title">B. Man-Hour Log</div>
                <div class="mh-controls">
                    <input type="text" placeholder="Emp ID" id="emp-${finding.id}">
                    <input type="text" placeholder="Task" id="task-${finding.id}">
                    <button class="btn btn-success" onclick="handleStart('${finding.id}')">START</button>
                    <button class="btn btn-danger" onclick="handleStop('${finding.id}')">STOP</button>
                </div>

                <div id="active-list-${finding.id}">
                    ${activeSessions.map(s => `
                        <div class="active-session">
                            <div><strong>${s.employeeId}</strong> (${s.taskCode})</div>
                            <div class="timer" data-start="${s.startTime}">00:00:00</div>
                        </div>
                    `).join('')}
                </div>

                <details>
                    <summary>View Performing Log (${historySessions.length})</summary>
                    <div class="table-container">
                        <table>
                            <thead><tr><th>Employee</th><th>Action</th><th>Duration</th></tr></thead>
                            <tbody>
                                ${historySessions.map(s => `
                                    <tr>
                                        <td><strong>${s.employeeId}</strong></td>
                                        <td>${s.taskCode}</td>
                                        <td>${s.duration}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </details>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderMaterials(findingId) {
    const mats = state.materials.filter(m => m.findingNo == findingId);
    if (!mats.length) return '<tr><td colspan="4">No materials required.</td></tr>';
    return mats.map(m => `
        <tr>
            <td>${m.partNo}</td>
            <td>${m.description}</td>
            <td>${m.qty} ${m.uom}</td>
            <td style="color:${m.availability === 'Available' ? 'green' : 'red'}">${m.availability}</td>
        </tr>
    `).join('');
}

// Logic Functions
function toggleCard(el) {
    el.parentElement.classList.toggle('expanded');
}

function handleStart(findingId) {
    const empId = document.getElementById(`emp-${findingId}`).value;
    const task = document.getElementById(`task-${findingId}`).value;
    if (!empId || !task) return alert("Emp ID and Task required");

    const active = state.manhours.filter(m => m.findingId === findingId && !m.stopTime);
    if (active.length > 0) {
        showConflictModal(findingId, empId, task, active.map(a => a.employeeId));
    } else {
        submitStart(findingId, empId, task);
    }
}

async function submitStart(findingId, empId, task) {
    const startTime = new Date().toISOString();
    await callAPI('startManhour', { findingId, empId, task, startTime });
    fetchData();
}

function handleStop(findingId) {
    const active = state.manhours.filter(m => m.findingId === findingId && !m.stopTime);
    if (active.length === 0) return alert("No active sessions");
    
    state.activeStopSession = { findingId, active };
    showStopModal();
}

async function finalizeSession(status) {
    const { findingId, selectedEmp } = state.activeStopSession;
    if (status === 'CLOSED') {
        document.getElementById('status-selection').classList.add('hidden');
        document.getElementById('photo-upload').classList.remove('hidden');
        return;
    }
    completeStop(findingId, selectedEmp, status, null);
}

async function completeStop(findingId, empId, status, evidence) {
    const stopTime = new Date().toISOString();
    await callAPI('stopManhour', { findingId, empId, stopTime, status, evidence });
    closeModals();
    fetchData();
}

// Timer Engine
function startTimerEngine() {
    setInterval(() => {
        document.querySelectorAll('.timer').forEach(el => {
            const start = new Date(el.dataset.start);
            const diff = Math.floor((new Date() - start) / 1000);
            el.textContent = formatTime(diff);
        });
    }, 1000);
}

function formatTime(sec) {
    const h = Math.floor(sec / 3600).toString().padStart(2, '0');
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

// Helpers
function formatDriveUrl(url) {
    if (!url || url === 'N/A') return 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Noimage.svg/250px-Noimage.svg.png';
    const idMatch = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return idMatch ? `https://lh3.googleusercontent.com/u/0/d/${idMatch[1]}` : url;
}

async function callAPI(action, params) {
    const body = { action, sheetId: SHEET_ID, woId: state.woId, ...params };
    const response = await fetch(API, {
        method: 'POST',
        mode: 'no-cors', // In GAS, post often needs redirect or no-cors handling
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    // Wait slightly for GAS to process since no-cors doesn't return body
    return new Promise(res => setTimeout(res, 1000));
}

// Modal Handlers
function openImage(url) {
    document.getElementById('full-size-img').src = formatDriveUrl(url);
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('image-modal').classList.remove('hidden');
}

function showConflictModal(findingId, empId, task, activeEmps) {
    document.getElementById('conflict-msg').textContent = `This finding is currently active by: ${activeEmps.join(', ')}`;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('conflict-modal').classList.remove('hidden');
    
    document.getElementById('btn-parallel-yes').onclick = () => {
        submitStart(findingId, empId, task);
        closeModals();
    };
    document.getElementById('btn-parallel-no').onclick = closeModals;
}

function showStopModal() {
    const { active } = state.activeStopSession;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('stop-modal').classList.remove('hidden');
    
    const userList = document.getElementById('active-user-list');
    userList.innerHTML = active.map(s => `
        <button class="btn btn-primary" style="margin-bottom:5px; width:100%" onclick="selectUserForStop('${s.employeeId}')">
            ${s.employeeId} - Stop Work
        </button>
    `).join('');
    
    document.getElementById('user-selection').classList.remove('hidden');
    document.getElementById('status-selection').classList.add('hidden');
    document.getElementById('photo-upload').classList.add('hidden');
}

function selectUserForStop(empId) {
    state.activeStopSession.selectedEmp = empId;
    const isLast = state.activeStopSession.active.length === 1;
    
    if (isLast) {
        document.getElementById('user-selection').classList.add('hidden');
        document.getElementById('status-selection').classList.remove('hidden');
    } else {
        completeStop(state.activeStopSession.findingId, empId, 'IN PROGRESS', null);
    }
}

function closeModals() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

document.getElementById('btn-submit-close').onclick = async () => {
    const file = document.getElementById('evidence-file').files[0];
    if (!file) return alert("Photo evidence required for closure");
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = e.target.result;
        await completeStop(state.activeStopSession.findingId, state.activeStopSession.selectedEmp, 'CLOSED', base64);
    };
    reader.readAsDataURL(file);
};
