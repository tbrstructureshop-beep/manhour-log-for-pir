// script.js

/**
 * CONFIGURATION & STATE
 */
const CONFIG = {
    // Replace with your DEPLOYED Web App URL
    API_URL: 'https://script.google.com/macros/s/AKfycbyneQ_EO9rlekZQrinWWuy9jsEcdkjStvBBPsjr4WzMfDmQVsPpdobmt8Ctgcnr3QJusg/exec', // Placeholder
    sheetId: new URLSearchParams(window.location.search).get('sheetId'),
    woId: new URLSearchParams(window.location.search).get('woId'),
    pollInterval: 10000 // 10s auto-refresh if idle
};

const STATE = {
    findings: [],
    materials: [],
    logs: [],
    timers: {}, // findingId -> intervalId
    currentUser: { id: null, task: null },
    temp: {} // Temporary data for modals
};

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    if (!CONFIG.sheetId) {
        alert("Missing Sheet ID. Please access from Dashboard.");
        return;
    }
    init();
});

async function init() {
    UI.showLoader();
    try {
        await Data.fetchAll();
        UI.renderHeader();
        UI.renderFindings();
        TimerEngine.start();
    } catch (e) {
        console.error(e);
        alert("Error loading data: " + e.message);
    } finally {
        UI.hideLoader();
    }
}

/**
 * DATA LAYER (API Communication)
 */
const Data = {
    async fetchAll() {
        const params = new URLSearchParams({
            action: 'getAll',
            sheetId: CONFIG.sheetId,
            woId: CONFIG.woId
        });
        
        const response = await fetch(`${CONFIG.API_URL}?${params}`);
        const data = await response.json();
        
        STATE.info = data.info;
        STATE.findings = data.findings;
        STATE.materials = data.materials;
        STATE.logs = data.logs;
    },

    async post(action, payload) {
        const formData = new FormData();
        formData.append('action', action);
        formData.append('sheetId', CONFIG.sheetId);
        formData.append('woId', CONFIG.woId);
        formData.append('payload', JSON.stringify(payload));

        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            body: formData
        });
        return await response.json();
    }
};

/**
 * LOGIC LAYER
 */
const WorkFlow = {
    // Get active sessions for a specific finding
    getActiveSessions(findingId) {
        const findingLogs = STATE.logs.filter(l => l.findingId === findingId);
        // Group by user
        const userStatus = {};
        
        // Sort logs by time asc
        findingLogs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));

        findingLogs.forEach(log => {
            if (log.action === 'START') {
                userStatus[log.empId] = { 
                    status: 'ACTIVE', 
                    startTime: log.timestamp, 
                    task: log.task 
                };
            } else if (log.action === 'STOP') {
                if (userStatus[log.empId]) {
                    delete userStatus[log.empId];
                }
            }
        });

        return Object.keys(userStatus).map(empId => ({
            empId,
            ...userStatus[empId]
        }));
    },

    async attemptStart(findingId) {
        const empIdInput = document.querySelector(`#inp-emp-${findingId}`);
        const taskInput = document.querySelector(`#inp-task-${findingId}`);
        const empId = empIdInput.value.toUpperCase().trim();
        const taskCode = taskInput.value.toUpperCase().trim();

        if (!empId || !taskCode) {
            alert("Enter Employee ID and Task Code");
            return;
        }

        const activeSessions = this.getActiveSessions(findingId);
        const amIActive = activeSessions.find(s => s.empId === empId);

        if (amIActive) {
            alert("You are already working on this finding.");
            return;
        }

        STATE.currentUser = { id: empId, task: taskCode, findingId: findingId };

        if (activeSessions.length > 0) {
            // Conflict
            STATE.temp.conflictUsers = activeSessions;
            UI.showConflictModal();
        } else {
            // Start immediately
            await this.executeStart();
        }
    },

    async executeStart() {
        UI.showLoader();
        try {
            const { id, task, findingId } = STATE.currentUser;
            const res = await Data.post('start', {
                findingId,
                empId: id,
                taskCode: task,
                startTime: new Date().toISOString()
            });
            
            // Refresh state
            STATE.logs = res.logs;
            UI.renderFindings(); // Re-render to show active timer
        } catch (e) {
            alert("Start Failed: " + e.message);
        } finally {
            UI.hideLoader();
            UI.closeModal('modal-conflict');
        }
    },

    async attemptStop(findingId) {
        const activeSessions = this.getActiveSessions(findingId);
        
        if (activeSessions.length === 0) return;

        STATE.temp.findingId = findingId;
        STATE.temp.activeSessions = activeSessions;

        if (activeSessions.length === 1) {
            // Stop the only user
            STATE.currentUser = { id: activeSessions[0].empId, findingId };
            await this.checkFinalization();
        } else {
            // Multiple users, select who to stop
            UI.showUserSelectModal(activeSessions);
        }
    },

    async selectUserToStop(empId) {
        UI.closeModal('modal-select-user');
        STATE.currentUser = { id: empId, findingId: STATE.temp.findingId };
        await this.checkFinalization();
    },

    async checkFinalization() {
        const { findingId, id } = STATE.currentUser;
        const activeSessions = STATE.temp.activeSessions || this.getActiveSessions(findingId);
        const othersActive = activeSessions.filter(s => s.empId !== id).length > 0;

        if (othersActive) {
            // Just stop, status remains IN_PROGRESS
            await this.executeStop('IN_PROGRESS');
        } else {
            // Last user, ask for final status
            UI.showModal('modal-final-status');
        }
    },

    async finalize(status) {
        UI.closeModal('modal-final-status');
        STATE.temp.finalStatus = status;
        
        if (status === 'CLOSED') {
            UI.showModal('modal-evidence');
        } else {
            await this.executeStop(status);
        }
    },

    async submitEvidence() {
        const fileInput = document.getElementById('evidence-file');
        if (fileInput.files.length === 0) {
            alert("Please select an image");
            return;
        }
        
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = async function() {
            STATE.temp.evidence = reader.result.split(',')[1]; // Base64
            UI.closeModal('modal-evidence');
            await WorkFlow.executeStop('CLOSED');
        };
        reader.readAsDataURL(file);
    },

    async executeStop(status) {
        UI.showLoader();
        const { id, findingId } = STATE.currentUser;
        const activeSessions = this.getActiveSessions(findingId);
        const mySession = activeSessions.find(s => s.empId === id);
        
        if (!mySession) {
            UI.hideLoader();
            return; 
        }

        const stopTime = new Date();
        const startTime = new Date(mySession.startTime);
        const duration = Math.round((stopTime - startTime) / 1000);

        try {
            const res = await Data.post('stop', {
                findingId,
                empId: id,
                stopTime: stopTime.toISOString(),
                duration: duration,
                status: status,
                evidence: STATE.temp.evidence || ""
            });

            STATE.logs = res.logs;
            STATE.findings = res.findings; // Status might update
            UI.renderFindings();
        } catch (e) {
            alert("Stop Failed: " + e.message);
        } finally {
            UI.hideLoader();
            STATE.temp = {}; // Reset temp
        }
    }
};

/**
 * UI CONTROLLER
 */
const UI = {
    showLoader: () => document.getElementById('global-loader').classList.remove('hidden'),
    hideLoader: () => document.getElementById('global-loader').classList.add('hidden'),
    
    showModal: (id) => {
        document.getElementById(id).classList.add('show');
    },
    closeModal: (id) => {
        document.getElementById(id).classList.remove('show');
    },

    renderHeader() {
        const i = STATE.info;
        if (!i) return;
        document.getElementById('info-customer').innerText = i.customer;
        document.getElementById('info-acreg').innerText = i.acReg;
        document.getElementById('info-wono').innerText = i.woNo;
        document.getElementById('info-partdesc').innerText = i.partDesc;
        document.getElementById('info-partno').innerText = i.partNo;
        document.getElementById('info-serialno').innerText = i.serialNo;
    },

    renderFindings() {
        const container = document.getElementById('findings-container');
        // Remember scroll position or expanded states if partial update?
        // For simplicity, full redraw, but we try to keep expanded inputs values if possible.
        // Actually, pure JS re-render is safer for syncing.
        
        container.innerHTML = '';

        STATE.findings.forEach(finding => {
            const card = document.createElement('div');
            card.className = `finding-card status-${finding.status?.toLowerCase() || 'open'}`;
            if (WorkFlow.getActiveSessions(finding.id).length > 0) card.classList.add('active-work');

            const activeSessions = WorkFlow.getActiveSessions(finding.id);
            const isWorking = activeSessions.length > 0;

            // Zebra styling handled by CSS nth-child

            card.innerHTML = `
                <div class="card-header" onclick="UI.toggleCard(this)">
                    <div class="card-title">
                        <h4>${finding.id} <small style="color:#666; font-weight:normal">(${finding.status || 'OPEN'})</small></h4>
                        <p>${finding.desc}</p>
                    </div>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="card-body">
                    <!-- SECTION A: INFO -->
                    <div class="section-info">
                        <div class="details-toggle" onclick="UI.toggleDetails(this)">Show Finding Details</div>
                        <div class="info-content">
                            <p><strong>Action Given:</strong> ${finding.actionGiven}</p>
                            <img src="${finding.image || 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Noimage.svg/250px-Noimage.svg.png'}" 
                                 class="finding-img-thumb" 
                                 onclick="UI.showImage('${finding.image}')">
                            
                            <table class="material-table">
                                <thead>
                                    <tr><th>Part</th><th>Desc</th><th>Qty</th><th>Avail</th></tr>
                                </thead>
                                <tbody>
                                    ${this.getMaterialsHTML(finding.id)}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- SECTION B: LOG -->
                    <div class="section-log">
                        <div class="active-mechanics" id="active-mechanics-${finding.id}">
                            ${this.getActiveMechanicsHTML(activeSessions)}
                        </div>

                        <div class="input-group">
                            <input type="text" id="inp-emp-${finding.id}" placeholder="Emp ID" ${isWorking ? '' : ''}>
                            <input type="text" id="inp-task-${finding.id}" placeholder="Task Code">
                        </div>
                        
                        <div class="action-buttons">
                            <button class="btn-start" onclick="WorkFlow.attemptStart('${finding.id}')">START</button>
                            <button class="btn-stop" onclick="WorkFlow.attemptStop('${finding.id}')" ${!isWorking ? 'disabled' : ''}>STOP</button>
                        </div>

                        <div class="log-table-wrapper">
                            <table class="log-table">
                                <thead><tr><th>Time</th><th>Emp</th><th>Task</th><th>Act</th></tr></thead>
                                <tbody>
                                    ${this.getLogHistoryHTML(finding.id)}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    },

    getMaterialsHTML(findingId) {
        const mats = STATE.materials.filter(m => m.findingId === findingId);
        if (mats.length === 0) return '<tr><td colspan="4">No materials</td></tr>';
        return mats.map(m => `
            <tr>
                <td>${m.partNo}</td>
                <td>${m.desc}</td>
                <td>${m.qty} ${m.uom}</td>
                <td style="color:${m.avail === 'Yes' ? 'green' : 'red'}">${m.avail}</td>
            </tr>
        `).join('');
    },

    getActiveMechanicsHTML(sessions) {
        if (sessions.length === 0) return '';
        return sessions.map(s => `
            <div class="mechanic-badge">
                <span><strong>${s.empId}</strong>: ${s.task}</span>
                <span class="timer" data-start="${s.startTime}">00:00:00</span>
            </div>
        `).join('');
    },

    getLogHistoryHTML(findingId) {
        const logs = STATE.logs.filter(l => l.findingId === findingId)
            .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)); // Newest first
        
        return logs.map(l => `
            <tr>
                <td>${new Date(l.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                <td><strong>${l.empId}</strong></td>
                <td>${l.task}</td>
                <td style="color:${l.action === 'START' ? 'green' : 'red'}">${l.action}</td>
            </tr>
        `).join('');
    },

    toggleCard(header) {
        header.parentElement.classList.toggle('expanded');
    },

    toggleDetails(btn) {
        const content = btn.nextElementSibling;
        content.classList.toggle('show');
        btn.innerText = content.classList.contains('show') ? 'Hide Details' : 'Show Finding Details';
    },

    showImage(url) {
        if (!url) return;
        document.getElementById('modal-img-target').src = url;
        this.showModal('modal-image');
    },

    showConflictModal() {
        const list = document.getElementById('conflict-users-list');
        list.innerHTML = STATE.temp.conflictUsers.map(u => `<li>${u.empId} (${u.task})</li>`).join('');
        
        const btnYes = document.getElementById('btn-conflict-confirm');
        btnYes.onclick = () => WorkFlow.executeStart();
        
        this.showModal('modal-conflict');
    },

    showUserSelectModal(sessions) {
        const container = document.getElementById('stop-user-list');
        container.innerHTML = sessions.map(s => `
            <button class="user-select-btn" onclick="WorkFlow.selectUserToStop('${s.empId}')">
                ${s.empId}<br><small>${s.task}</small>
            </button>
        `).join('');
        this.showModal('modal-select-user');
    }
};

/**
 * TIMER ENGINE
 */
const TimerEngine = {
    start() {
        setInterval(() => {
            const timers = document.querySelectorAll('.timer');
            const now = new Date();
            timers.forEach(t => {
                const start = new Date(t.dataset.start);
                const diff = Math.floor((now - start) / 1000);
                if (diff >= 0) {
                    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
                    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
                    const s = (diff % 60).toString().padStart(2, '0');
                    t.innerText = `${h}:${m}:${s}`;
                }
            });
        }, 1000);
    }
};
