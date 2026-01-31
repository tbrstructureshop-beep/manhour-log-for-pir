/**
 * AIRCRAFT MAINTENANCE COLLABORATIVE WO SYSTEM
 * FRONTEND LOGIC
 */

const API = "https://script.google.com/macros/s/AKfycbyneQ_EO9rlekZQrinWWuy9jsEcdkjStvBBPsjr4WzMfDmQVsPpdobmt8Ctgcnr3QJusg/exec";
const urlParams = new URLSearchParams(window.location.search);
const SHEET_ID = "1IyjNL723csoFdYA9Zo8_oMOhIxzPPpNOXw5YSJLGh-c";
const WO_ID = urlParams.get('woId');

let APP_STATE = {
    info: {},
    findings: [],
    materials: [],
    logs: [],
    activeSessions: {}
};

// --- Initialization ---

window.addEventListener('DOMContentLoaded', () => {
    if (!WO_ID) {
        alert("Missing WO ID in URL.");
        return;
    }
    fetchInitialData();
    setupGlobalEvents();
    startTimerEngine();
});

function setupGlobalEvents() {
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        };
    });

    document.getElementById('final-status-select').onchange = (e) => {
        const uploadBox = document.getElementById('evidence-upload-section');
        if (e.target.value === 'CLOSED') {
            uploadBox.classList.remove('hidden');
        } else {
            uploadBox.classList.add('hidden');
        }
    };
}

async function fetchInitialData() {
    showLoader(true);
    try {
        const response = await fetch(`${API}?sheetId=${SHEET_ID}&woId=${WO_ID}&action=getWOData`);
        const result = await response.json();
        
        if (result.success) {
            APP_STATE.info = result.data.info;
            APP_STATE.findings = result.data.findings;
            APP_STATE.materials = result.data.materials;
            APP_STATE.logs = result.data.logs;
            
            renderHeader();
            renderFindings();
        } else {
            alert("Error: " + result.error);
        }
    } catch (e) {
        console.error(e);
        alert("System connection failure.");
    } finally {
        showLoader(false);
    }
}

// --- UI Rendering ---

function renderHeader() {
    document.getElementById('wo-title').textContent = `WO: ${APP_STATE.info.woNo}`;
    document.getElementById('header-reg').textContent = APP_STATE.info.reg;
    document.getElementById('header-customer').textContent = APP_STATE.info.customer;
    document.getElementById('info-desc').textContent = APP_STATE.info.description;
    document.getElementById('info-pn').textContent = APP_STATE.info.pn;
    document.getElementById('info-sn').textContent = APP_STATE.info.sn;
}

function renderFindings() {
    const container = document.getElementById('findings-container');
    container.innerHTML = '';

    APP_STATE.findings.forEach(finding => {
        const card = document.createElement('div');
        card.className = 'finding-card';
        card.id = `card-${finding.no}`;

        const statusClass = (finding.status || 'OPEN').toLowerCase().replace('_', '-');
        const imageUrl = formatDriveUrl(finding.imageUrl);

        card.innerHTML = `
            <div class="card-header" onclick="toggleCard('${finding.no}')">
                <div>
                    <h4>Finding #${finding.no}</h4>
                    <span class="summary-text">${finding.description}</span>
                </div>
                <span class="badge status-${statusClass}">${finding.status || 'OPEN'}</span>
            </div>
            <div id="body-${finding.no}" class="card-body hidden">
                <div class="section-title">Finding Information</div>
                <div class="description-box"><strong>Finding:</strong> ${finding.description}</div>
                <div class="description-box"><strong>Action Given:</strong> ${finding.actionGiven}</div>
                <img src="${imageUrl}" class="finding-thumb" onclick="previewImage('${imageUrl}')">
                
                <div class="section-title">Material List</div>
                <table class="material-table">
                    <thead><tr><th>P/N</th><th>Description</th><th>Qty</th><th>Status</th></tr></thead>
                    <tbody>${renderMaterialRows(finding.no)}</tbody>
                </table>

                <div class="section-title">Man-Hour Action</div>
                <div class="controls-row">
                    <div class="form-group">
                        <label>Employee ID</label>
                        <input type="text" id="emp-${finding.no}" placeholder="EMP123">
                    </div>
                    <div class="form-group">
                        <label>Task Code</label>
                        <input type="text" id="task-${finding.no}" placeholder="MNT">
                    </div>
                </div>
                <div class="controls-row">
                    <button class="btn btn-primary" onclick="handleStart('${finding.no}')">START</button>
                    <button class="btn btn-danger" onclick="handleStopPrompt('${finding.no}')">STOP</button>
                </div>

                <div class="active-timers-container" id="timers-${finding.no}"></div>

                <div class="section-title">Performing Log</div>
                <div class="log-scroll">
                    <table class="log-table">
                        <thead><tr><th>Time</th><th>User</th><th>Code</th><th>Action</th></tr></thead>
                        <tbody>${renderLogRows(finding.no)}</tbody>
                    </table>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderMaterialRows(fNo) {
    const filtered = APP_STATE.materials.filter(m => m.findingNo == fNo);
    if (!filtered.length) return '<tr><td colspan="4" style="text-align:center">No materials required</td></tr>';
    return filtered.map(m => `
        <tr>
            <td>${m.pn}</td>
            <td>${m.desc}</td>
            <td>${m.qty} ${m.uom}</td>
            <td style="color:${m.avail === 'Available' ? 'green' : 'red'}">${m.avail}</td>
        </tr>
    `).join('');
}

function renderLogRows(fNo) {
    const filtered = APP_STATE.logs.filter(l => l.findingNo == fNo).reverse();
    if (!filtered.length) return '<tr><td colspan="4" style="text-align:center">No records</td></tr>';
    return filtered.map(l => {
        const d = new Date(l.timestamp);
        return `
            <tr>
                <td>${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}</td>
                <td><b>${l.employeeId}</b></td>
                <td>${l.taskCode}</td>
                <td><small>${l.action}</small></td>
            </tr>
        `;
    }).join('');
}

// --- Logic & Actions ---

function toggleCard(fNo) {
    const body = document.getElementById(`body-${fNo}`);
    body.classList.toggle('hidden');
}

function formatDriveUrl(url) {
    if (!url || url.length < 10) return "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Noimage.svg/250px-Noimage.svg.png";
    const match = url.match(/[-\w]{25,}/);
    return match ? `https://drive.google.com/thumbnail?id=${match[0]}&sz=w800` : url;
}

function previewImage(url) {
    const modal = document.getElementById('image-modal');
    document.getElementById('modal-img-large').src = url;
    modal.style.display = 'block';
}

function handleStart(fNo) {
    const empId = document.getElementById(`emp-${fNo}`).value.trim();
    const taskCode = document.getElementById(`task-${fNo}`).value.trim();

    if (!empId || !taskCode) {
        alert("Please enter Employee ID and Task Code.");
        return;
    }

    // Check existing
    const actives = getActiveSessions(fNo);
    if (actives.length > 0) {
        showConflictModal(fNo, empId, taskCode, actives);
    } else {
        executeStart(fNo, empId, taskCode);
    }
}

function showConflictModal(fNo, empId, taskCode, actives) {
    const modal = document.getElementById('conflict-modal');
    const list = document.getElementById('active-mechanics-list');
    list.innerHTML = actives.map(a => `<li><b>${a.employeeId}</b> (Started: ${new Date(a.timestamp).toLocaleTimeString()})</li>`).join('');
    
    document.getElementById('confirm-join').onclick = () => {
        modal.style.display = 'none';
        executeStart(fNo, empId, taskCode);
    };
    modal.style.display = 'block';
}

async function executeStart(findingNo, employeeId, taskCode) {
    showLoader(true);
    const startTime = new Date().toISOString();
    
    try {
        const res = await fetch(API, {
            method: 'POST',
            mode: 'no-cors', // Apps Script web app post constraint
            body: JSON.stringify({
                action: 'startManhour',
                sheetId: SHEET_ID,
                woId: WO_ID,
                findingId: findingNo,
                employeeId: employeeId,
                taskCode: taskCode,
                startTime: startTime
            })
        });
        
        // Wait for server to process before refresh
        setTimeout(fetchInitialData, 2000);
    } catch (e) {
        alert("Error starting task.");
        showLoader(false);
    }
}

function handleStopPrompt(fNo) {
    const actives = getActiveSessions(fNo);
    if (actives.length === 0) {
        alert("No active sessions found for this finding.");
        return;
    }

    if (actives.length === 1) {
        processStop(fNo, actives[0].employeeId);
    } else {
        const modal = document.getElementById('stop-modal');
        const container = document.getElementById('stop-user-options');
        container.innerHTML = '';
        actives.forEach(a => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.textContent = `I am ${a.employeeId}`;
            btn.onclick = () => {
                modal.style.display = 'none';
                processStop(fNo, a.employeeId);
            };
            container.appendChild(btn);
        });
        modal.style.display = 'block';
    }
}

function processStop(fNo, empId) {
    const actives = getActiveSessions(fNo);
    const isLast = actives.length === 1;

    if (isLast) {
        const modal = document.getElementById('final-modal');
        document.getElementById('submit-finalize').onclick = () => finalizeStop(fNo, empId, true);
        modal.style.display = 'block';
    } else {
        finalizeStop(fNo, empId, false);
    }
}

async function finalizeStop(fNo, empId, isLast) {
    const finalStatus = isLast ? document.getElementById('final-status-select').value : 'IN_PROGRESS';
    const evidenceInput = document.getElementById('evidence-file');
    let evidenceBase64 = "";

    if (isLast && finalStatus === 'CLOSED') {
        if (!evidenceInput.files[0]) {
            alert("Closure evidence is mandatory.");
            return;
        }
        evidenceBase64 = await toBase64(evidenceInput.files[0]);
    }

    showLoader(true);
    const stopTime = new Date().toISOString();

    try {
        await fetch(API, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                action: 'stopManhour',
                sheetId: SHEET_ID,
                woId: WO_ID,
                findingId: fNo,
                employeeId: empId,
                stopTime: stopTime,
                finalStatus: finalStatus,
                evidenceBase64: evidenceBase64
            })
        });
        
        document.getElementById('final-modal').style.display = 'none';
        setTimeout(fetchInitialData, 2500);
    } catch (e) {
        alert("Error stopping task.");
        showLoader(false);
    }
}

// --- Utilities ---

function getActiveSessions(fNo) {
    const findingLogs = APP_STATE.logs.filter(l => l.findingNo == fNo);
    const activeMap = {};
    
    findingLogs.forEach(l => {
        if (l.action === 'START') {
            activeMap[l.employeeId] = l;
        } else if (l.action === 'STOP') {
            delete activeMap[l.employeeId];
        }
    });
    
    return Object.values(activeMap);
}

function startTimerEngine() {
    setInterval(() => {
        APP_STATE.findings.forEach(f => {
            const actives = getActiveSessions(f.no);
            const container = document.getElementById(`timers-${f.no}`);
            if (!container) return;
            
            if (actives.length === 0) {
                container.innerHTML = '';
            } else {
                container.innerHTML = actives.map(a => {
                    const diff = Math.floor((new Date() - new Date(a.timestamp)) / 1000);
                    const h = Math.floor(diff / 3600).toString().padStart(2,'0');
                    const m = Math.floor((diff % 3600) / 60).toString().padStart(2,'0');
                    const s = (diff % 60).toString().padStart(2,'0');
                    return `<div class="timer-row"><span>${a.employeeId}</span><span class="timer-val">${h}:${m}:${s}</span></div>`;
                }).join('');
            }
        });
    }, 1000);
}

function showLoader(show) {
    document.getElementById('loader').style.display = show ? 'flex' : 'none';
}

function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });
}
