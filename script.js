// script.js

/**
 * CONFIGURATION
 */
const CONFIG = {
    // UPDATED WITH YOUR SPECIFIC URL
    API_URL: 'https://script.google.com/macros/s/AKfycbyneQ_EO9rlekZQrinWWuy9jsEcdkjStvBBPsjr4WzMfDmQVsPpdobmt8Ctgcnr3QJusg/exec',
    
    // Default sheetId from context or URL param
    sheetId: new URLSearchParams(window.location.search).get('sheetId') || '1IyjNL723csoFdYA9Zo8_oMOhIxzPPpNOXw5YSJLGh-c',
    
    woId: new URLSearchParams(window.location.search).get('woId') || 'WO-DEFAULT'
};

const STATE = {
    data: null,
    timers: {},
    currentUser: { id: null, findingId: null, task: null },
    temp: {}
};

// Init
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    UI.toggleLoader(true);
    try {
        await Data.fetch();
        UI.renderHeader();
        UI.renderFindings();
        setInterval(Timer.tick, 1000); // Start Global Timer Engine
    } catch (e) {
        console.error(e);
        alert("Connection Error: " + e.message);
    } finally {
        UI.toggleLoader(false);
    }
}

/**
 * DATA LAYER
 */
const Data = {
    async fetch() {
        const url = `${CONFIG.API_URL}?action=getAll&sheetId=${CONFIG.sheetId}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        STATE.data = json;
    },

    async post(action, payload) {
        const formData = new FormData();
        formData.append('action', action);
        formData.append('sheetId', CONFIG.sheetId);
        formData.append('payload', JSON.stringify(payload));

        const res = await fetch(CONFIG.API_URL, { method: 'POST', body: formData });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        
        // Update Local State with Server Response (Logs & Findings)
        STATE.data.logs = json.logs;
        if (json.findings) STATE.data.findings = json.findings;
        
        return json;
    }
};

/**
 * WORKFLOW LOGIC
 */
const WorkFlow = {
    getActiveSessions(findingId) {
        // Filter logs for this finding
        const logs = STATE.data.logs.filter(l => l.findingId == findingId)
            .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        const sessions = {};
        logs.forEach(l => {
            if (l.action === 'START') {
                sessions[l.empId] = { start: l.timestamp, task: l.task };
            } else if (l.action === 'STOP') {
                delete sessions[l.empId];
            }
        });
        
        return Object.entries(sessions).map(([id, val]) => ({ id, ...val }));
    },

    async start(findingId) {
        const empInput = document.getElementById(`emp-${findingId}`);
        const taskInput = document.getElementById(`task-${findingId}`);
        const empId = empInput.value.trim().toUpperCase();
        const task = taskInput.value.trim().toUpperCase();

        if (!empId || !task) return alert("Please enter Employee ID and Task Code");

        const active = this.getActiveSessions(findingId);
        
        // Check if I am already active
        if (active.find(s => s.id === empId)) {
            return alert("You are already active on this finding!");
        }

        // Setup current user intent
        STATE.currentUser = { id: empId, findingId, task };

        // Parallel Work Logic
        if (active.length > 0) {
            STATE.temp.conflictList = active;
            UI.showConflictModal();
        } else {
            await this.executeStart();
        }
    },

    async executeStart() {
        UI.closeModal('modal-conflict');
        UI.toggleLoader(true);
        try {
            const { id, findingId, task } = STATE.currentUser;
            await Data.post('start', {
                findingId, 
                empId: id, 
                taskCode: task, 
                startTime: new Date().toISOString()
            });
            UI.renderFindings();
        } catch(e) { 
            alert("Start failed: " + e.message); 
        } finally { 
            UI.toggleLoader(false); 
        }
    },

    async stop(findingId) {
        const active = this.getActiveSessions(findingId);
        if (active.length === 0) return;

        STATE.currentUser.findingId = findingId;

        if (active.length === 1) {
            // Only one user (must be me or someone I am stopping for)
            STATE.currentUser.id = active[0].id;
            this.checkStatusLogic(active, active[0].id);
        } else {
            // Multiple users - ask who is stopping
            UI.showUserSelect(active);
        }
    },

    selectUserStop(empId) {
        UI.closeModal('modal-select-user');
        STATE.currentUser.id = empId;
        const active = this.getActiveSessions(STATE.currentUser.findingId);
        this.checkStatusLogic(active, empId);
    },

    checkStatusLogic(allActive, myId) {
        const others = allActive.filter(s => s.id !== myId);
        if (others.length > 0) {
            // Others still working -> Status remains active (IN_PROGRESS)
            this.finalize('IN_PROGRESS');
        } else {
            // I am the last one -> Ask for final status
            UI.openModal('modal-final-status');
        }
    },

    finalize(status) {
        UI.closeModal('modal-final-status');
        STATE.temp.status = status;
        
        if (status === 'CLOSED') {
            UI.openModal('modal-evidence');
        } else {
            // Status is ON_HOLD or IN_PROGRESS
            this.executeStop(status, "");
        }
    },

    submitEvidence() {
        const file = document.getElementById('evidence-file').files[0];
        // Placeholder for evidence handling
        const fakeEvidence = file ? "IMAGE_UPLOADED" : "NO_IMAGE";
        UI.closeModal('modal-evidence');
        this.executeStop('CLOSED', fakeEvidence);
    },

    async executeStop(status, evidence) {
        UI.toggleLoader(true);
        try {
            const { id, findingId } = STATE.currentUser;
            const active = this.getActiveSessions(findingId);
            const session = active.find(s => s.id === id);
            
            // Calculate duration
            const start = session ? new Date(session.start) : new Date();
            const now = new Date();
            const duration = Math.round((now - start) / 1000);

            await Data.post('stop', {
                findingId, 
                empId: id, 
                stopTime: now.toISOString(),
                duration, 
                status, 
                evidence
            });
            UI.renderFindings();
        } catch(e) { 
            alert("Stop failed: " + e.message); 
        } finally { 
            UI.toggleLoader(false); 
        }
    }
};

/**
 * UI CONTROLLER
 */
const UI = {
    toggleLoader(show) {
        const loader = document.getElementById('global-loader');
        show ? loader.classList.remove('hidden') : loader.classList.add('hidden');
    },

    openModal: (id) => document.getElementById(id).classList.add('show'),
    closeModal: (id) => document.getElementById(id).classList.remove('show'),

    // Transforms Google Drive Share Link to High-Res Thumbnail
    getThumbnailUrl(rawUrl) {
        if (!rawUrl) return 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Noimage.svg/250px-Noimage.svg.png';
        const match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
            // sz=w1000 forces high resolution
            return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w800`;
        }
        return rawUrl; 
    },

    renderHeader() {
        if (!STATE.data || !STATE.data.info) return;
        const i = STATE.data.info;
        const map = {
            'customer': i.customer, 'acreg': i.acReg, 'wono': i.woNo,
            'partdesc': i.partDesc, 'partno': i.partNo, 'serialno': i.serialNo
        };
        for (const [k, v] of Object.entries(map)) {
            document.getElementById(`info-${k}`).innerText = v || '-';
        }
    },

    renderFindings() {
        const container = document.getElementById('findings-container');
        container.innerHTML = '';
        
        STATE.data.findings.forEach(f => {
            const sessions = WorkFlow.getActiveSessions(f.id);
            const isActive = sessions.length > 0;
            const statusClass = isActive ? 'active' : (f.status === 'CLOSED' ? 'closed' : (f.status === 'ON_HOLD' ? 'hold' : ''));
            const thumbUrl = this.getThumbnailUrl(f.image);
            
            const el = document.createElement('div');
            el.className = `finding-card ${statusClass}`;
            
            el.innerHTML = `
                <div class="card-header" onclick="UI.toggleCard(this)">
                    <div style="flex-grow:1">
                        <h4>${f.id} <span style="font-size:0.8em; font-weight:normal; color:#666">(${f.status || 'OPEN'})</span></h4>
                        <p class="preserve-text">${f.desc}</p>
                    </div>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="card-body">
                    <div class="info-section">
                        <div class="toggle-link" onclick="UI.toggleInfo(this)">Show Details (Image & Materials)</div>
                        <div class="info-details">
                            <p><strong>Action Given:</strong></p>
                            <div class="preserve-text" style="background:white; padding:10px; border:1px solid #eee; border-radius:4px; margin-bottom:10px;">${f.actionGiven}</div>
                            
                            <img src="${thumbUrl}" class="thumb-img" onclick="UI.showImg('${thumbUrl}')" alt="Finding Image">
                            
                            <table>
                                <thead><tr><th>Part</th><th>Qty</th><th>Avail</th></tr></thead>
                                <tbody>${UI.renderMaterials(f.id)}</tbody>
                            </table>
                        </div>
                    </div>

                    <div class="control-panel">
                        <div class="active-users-list">
                            ${sessions.length > 0 ? '<div style="font-size:0.8rem; color:#666; margin-bottom:5px">Active Mechanics:</div>' : ''}
                            ${sessions.map(s => `
                                <div class="user-badge ${s.id === STATE.currentUser.id ? 'mine' : ''}">
                                    <span>👤 <strong>${s.id}</strong> (${s.task})</span>
                                    <span class="timer-display" data-start="${s.start}">00:00:00</span>
                                </div>
                            `).join('')}
                        </div>

                        <div class="input-row">
                            <input id="emp-${f.id}" placeholder="Employee ID" value="${isActive && sessions.some(s=>s.id === STATE.currentUser.id) ? STATE.currentUser.id : ''}">
                            <input id="task-${f.id}" placeholder="Task Code">
                        </div>
                        <div class="btn-row">
                            <button class="btn-start" onclick="WorkFlow.start('${f.id}')">START</button>
                            <button class="btn-stop" onclick="WorkFlow.stop('${f.id}')" ${!isActive ? 'disabled' : ''}>STOP</button>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(el);
        });
    },

    renderMaterials(fid) {
        const mats = STATE.data.materials.filter(m => m.findingId == fid);
        if (!mats.length) return '<tr><td colspan="3">No materials</td></tr>';
        return mats.map(m => `
            <tr>
                <td><strong>${m.partNo}</strong><br><small>${m.desc}</small></td>
                <td>${m.qty} ${m.uom}</td>
                <td style="font-weight:bold; color:${m.avail=='Yes'?'green':'red'}">${m.avail}</td>
            </tr>
        `).join('');
    },

    toggleCard: (h) => h.parentElement.classList.toggle('expanded'),
    
    toggleInfo: (e) => {
        const d = e.nextElementSibling;
        d.classList.toggle('show');
        e.innerText = d.classList.contains('show') ? 'Hide Details' : 'Show Details';
    },
    
    showImg: (src) => {
        // Request even larger size for modal
        const highRes = src.replace('sz=w800', 'sz=w2000');
        document.getElementById('modal-img-target').src = highRes;
        UI.openModal('modal-image');
    },

    showConflictModal() {
        const list = document.getElementById('conflict-users-list');
        list.innerHTML = STATE.temp.conflictList.map(u => `<li><strong>${u.id}</strong> - ${u.task}</li>`).join('');
        
        const btn = document.getElementById('btn-conflict-confirm');
        // Clear previous listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.onclick = () => WorkFlow.executeStart();
        
        UI.openModal('modal-conflict');
    },

    showUserSelect(users) {
        const div = document.getElementById('stop-user-list');
        div.innerHTML = users.map(u => `
            <button class="select-user-btn" onclick="WorkFlow.selectUserStop('${u.id}')">
                <strong style="font-size:1.1em">${u.id}</strong><br>${u.task}
            </button>
        `).join('');
        UI.openModal('modal-select-user');
    }
};

const Timer = {
    tick() {
        document.querySelectorAll('.timer-display').forEach(el => {
            const start = new Date(el.dataset.start);
            const diff = Math.floor((new Date() - start) / 1000);
            if (diff >= 0) {
                const h = String(Math.floor(diff/3600)).padStart(2,'0');
                const m = String(Math.floor((diff%3600)/60)).padStart(2,'0');
                const s = String(diff%60).padStart(2,'0');
                el.innerText = `${h}:${m}:${s}`;
            }
        });
    }
};
