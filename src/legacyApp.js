import { initializeApp } from 'firebase/app'
import { getDatabase, ref, update, remove, onValue } from 'firebase/database'

let initialized = false

export function initLegacyApp() {
  if (initialized) return
  initialized = true
// 1. Config & Constants
    const CONFIG = {
        FIREBASE: {
            apiKey: "AIzaSyB8HvxU7VhR9mWiSvyFu3XXXbmLfoKz9M0",
            authDomain: "aion2boss.firebaseapp.com",
            databaseURL: "https://aion2boss-default-rtdb.firebaseio.com",
            projectId: "aion2boss",
            storageBucket: "aion2boss.firebasestorage.app",
            messagingSenderId: "985334026286",
            appId: "1:985334026286:web:4959921d864700b5cf0fbf"
        },
        MAP: {
            FLY_SCALE: 1.5,
            ANIMATION_DURATION: 500,
            MIN_SCALE: 0.2,
            MAX_SCALE: 5
        },
        UI: {
            COOLDOWN_MS: 60000,
            WARNING_MS: 300000
        },
        LIMITS: {
            NAME: 20,
            LOC: 100,
            INFO: 400
        }
    };

    // 2. Application State
    const state = {
        roomId: null,
        role: 'guest',
        bosses: {},
        undoStack: [],
        redoStack: [],
        editingKey: null,
        lastNearestBoss: null,
        map: {
            scale: 1,
            pointX: 0,
            pointY: 0,
            isDragging: false,
            startX: 0,
            startY: 0,
            isInitialized: false
        }
    };

    // 3. Service Layer (Firebase)
    const app = initializeApp(CONFIG.FIREBASE);
    const db = getDatabase(app);

    const BossService = {
        listenToRoom(roomId, callback) {
            const roomRef = ref(db, `${roomId}/bosses`);
            onValue(roomRef, (snapshot) => {
                state.bosses = snapshot.val() || {};
                callback(state.bosses);
            });
        },
        updateBoss(key, data) {
            return update(ref(db, `${state.roomId}/bosses/${key}`), data);
        },
        removeBoss(key) {
            return remove(ref(db, `${state.roomId}/bosses/${key}`));
        },
        saveOrder(updates) {
            return update(ref(db), updates);
        }
    };

    // 4. Utility Functions
    const Utils = {
        padZero: (num) => String(num).padStart(2, '0'),
        
        formatTimeDisplay: (timestamp) => {
            if (!timestamp) return '-';
            const d = new Date(timestamp);
            return `${d.getMonth() + 1}/${d.getDate()} ${Utils.padZero(d.getHours())}:${Utils.padZero(d.getMinutes())}`;
        },

        toInputValue: (timestamp) => {
            if (!timestamp) return "";
            const d = new Date(timestamp);
            return `${d.getFullYear()}-${Utils.padZero(d.getMonth() + 1)}-${Utils.padZero(d.getDate())}T${Utils.padZero(d.getHours())}:${Utils.padZero(d.getMinutes())}:${Utils.padZero(d.getSeconds())}`;
        },

        getSpawnInfo: (boss) => {
            if (!boss.nextSpawnTimestamp || !boss.interval) return { time: null, label: '', count: 0 };
            
            const now = Date.now();
            let nextTime = boss.nextSpawnTimestamp;
            let count = 1;
            const intervalMs = boss.interval * 3600000;

            if (nextTime <= now) {
                const diff = now - nextTime;
                const cyclesToAdd = Math.floor(diff / intervalMs) + 1;
                nextTime += cyclesToAdd * intervalMs;
                count += cyclesToAdd;
            }

            const label = count > 1 ? ` (${count}차)` : '';
            return { time: nextTime, label: label, count: count };
        }
    };

    // 5. Map Controller
    const MapController = {
        elements: {
            wrapper: document.getElementById('map-wrapper'),
            viewport: document.getElementById('map-viewport'),
            img: document.getElementById('boss-map-img'),
            btn: document.getElementById('btn-toggle-map'),
            help: document.getElementById('map-help'),
            scrollTarget: document.getElementById('timer-box')
        },

        init() {
            this.elements.btn.addEventListener('click', () => this.toggle());
            this.elements.viewport.addEventListener('wheel', (e) => this.handleZoom(e));
            this.elements.viewport.addEventListener('mousedown', (e) => this.startDrag(e));
            window.addEventListener('mousemove', (e) => this.drag(e));
            window.addEventListener('mouseup', () => this.endDrag());
        },

        toggle(forceOpen = false) {
            const isOpen = this.elements.viewport.style.display === 'block';
            if (forceOpen || !isOpen) {
                this.elements.viewport.style.display = 'block';
                this.elements.help.style.display = 'block';
                this.elements.btn.innerText = '🗺️ 지도 닫기';
                if (!state.map.isInitialized) this.centerMap();
            } else {
                this.elements.viewport.style.display = 'none';
                this.elements.help.style.display = 'none';
                this.elements.btn.innerText = '🗺️ 지도 열기';
            }
        },

        centerMap() {
            const { viewport, img } = this.elements;
            if (!img.complete) {
                img.onload = () => this.centerMap();
                return;
            }
            // Reset to fit viewport or specific ratio
            if (img.naturalWidth && img.naturalHeight) {
                // Remove fixed height, let aspect-ratio handle it
                viewport.style.height = 'auto';
                viewport.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
            }

            state.map.scale = 1;
            state.map.pointX = (viewport.clientWidth - img.naturalWidth) / 2;
            state.map.pointY = (viewport.clientHeight - img.naturalHeight) / 2;
            state.map.isInitialized = true;
            this.updateTransform();
        },

        flyTo(normX, normY) {
            this.toggle(true);
            this.elements.scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });

            const { viewport, img } = this.elements;
            const targetScale = CONFIG.MAP.FLY_SCALE;
            
            const targetX = (viewport.clientWidth / 2) - (normX * img.naturalWidth * targetScale);
            const targetY = (viewport.clientHeight / 2) - (normY * img.naturalHeight * targetScale);

            img.classList.add('fly-animation');
            state.map.scale = targetScale;
            state.map.pointX = targetX;
            state.map.pointY = targetY;
            
            this.applyConstraints(); 
            this.renderTransform();

            setTimeout(() => img.classList.remove('fly-animation'), CONFIG.MAP.ANIMATION_DURATION);
        },

        handleZoom(e) {
            e.preventDefault();
            this.elements.img.classList.add('smooth-zoom');
            
            const rect = this.elements.viewport.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const xs = (centerX - state.map.pointX) / state.map.scale;
            const ys = (centerY - state.map.pointY) / state.map.scale;
            
            const delta = -e.deltaY;
            if (delta > 0) state.map.scale *= 1.2;
            else state.map.scale /= 1.2;
            
            state.map.scale = Math.min(Math.max(CONFIG.MAP.MIN_SCALE, state.map.scale), CONFIG.MAP.MAX_SCALE);
            
            state.map.pointX = centerX - xs * state.map.scale;
            state.map.pointY = centerY - ys * state.map.scale;

            this.updateTransform();
        },

        startDrag(e) {
            state.map.isDragging = true;
            this.elements.img.classList.remove('smooth-zoom', 'fly-animation');
            state.map.startX = e.clientX - state.map.pointX;
            state.map.startY = e.clientY - state.map.pointY;
            this.elements.viewport.style.cursor = 'grabbing';
        },

        drag(e) {
            if (!state.map.isDragging) return;
            e.preventDefault();
            state.map.pointX = e.clientX - state.map.startX;
            state.map.pointY = e.clientY - state.map.startY;
            this.updateTransform();
        },

        endDrag() {
            state.map.isDragging = false;
            this.elements.viewport.style.cursor = 'grab';
        },

        updateTransform() {
            this.applyConstraints();
            this.renderTransform();
        },

        applyConstraints() {
            const { viewport, img } = this.elements;
            const currW = img.naturalWidth * state.map.scale;
            const currH = img.naturalHeight * state.map.scale;
            const vpW = viewport.clientWidth;
            const vpH = viewport.clientHeight;

            if (currW <= vpW) state.map.pointX = (vpW - currW) / 2;
            else state.map.pointX = Math.min(0, Math.max(vpW - currW, state.map.pointX));

            if (currH <= vpH) state.map.pointY = (vpH - currH) / 2;
            else state.map.pointY = Math.min(0, Math.max(vpH - currH, state.map.pointY));
        },

        renderTransform() {
            this.elements.img.style.transform = `translate(${state.map.pointX}px, ${state.map.pointY}px) scale(${state.map.scale})`;
        }
    };

    // 6. UI Controller
    const UIManager = {
        dom: {
            login: document.getElementById('login-screen'),
            app: document.getElementById('main-app'),
            roomDisplay: document.getElementById('current-room-display'),
            tableBody: document.getElementById('table-body'),
            form: document.getElementById('form-container'),
            formInputs: {
                name: document.getElementById('input-name'),
                color: document.getElementById('input-color'),
                loc: document.getElementById('input-location'),
                drop: document.getElementById('input-drop'),
                interval: document.getElementById('input-interval'),
                mapX: document.getElementById('input-map-x'),
                mapY: document.getElementById('input-map-y')
            },
            btnAdd: document.getElementById('btn-add'),
            btnDelete: document.getElementById('btn-form-delete'),
            btnToggleForm: document.getElementById('btn-toggle-form'),
            undoBtn: document.getElementById('btn-undo'),
            redoBtn: document.getElementById('btn-redo'),
            panels: {
                prev: document.getElementById('panel-prev'),
                next: document.getElementById('panel-next'),
                main: {
                    name: document.getElementById('timer-boss-name'),
                    time: document.getElementById('timer-display'),
                    loc: document.getElementById('timer-boss-location'),
                    drop: document.getElementById('timer-boss-drop'),
                    btn: document.getElementById('btn-main-kill')
                }
            }
        },

        init() {
            // Populate interval select
            const select = this.dom.formInputs.interval;
            for (let i = 1; i <= 24; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.innerText = `${i}시간`;
                select.appendChild(opt);
            }
            
            // Event delegation for table
            this.dom.tableBody.addEventListener('click', (e) => this.handleTableClick(e));
            this.dom.tableBody.addEventListener('change', (e) => this.handleTableInput(e));
            
            // Event delegation for panel buttons (new logic for quick kill buttons)
            document.getElementById('timer-panels').addEventListener('click', (e) => this.handlePanelClick(e));

            // Other UI bindings
            this.dom.btnToggleForm.addEventListener('click', () => this.toggleForm());
        },

        switchScreen() {
            this.dom.login.classList.add('hidden');
            this.dom.app.classList.remove('hidden');
            this.dom.roomDisplay.innerText = `ROOM: ${state.roomId} (${state.role === 'admin' ? '관리자' : '손님'})`;
            
            const adminElements = document.querySelectorAll('.admin-element');
            adminElements.forEach(el => {
                if (state.role === 'guest') el.classList.add('hidden');
                else el.classList.remove('hidden');
            });
            
            // Explicitly sync button state
            this.updateUndoUI();
        },

        renderTable(bosses) {
            const sortedBosses = Object.entries(bosses).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
            const isAdmin = state.role === 'admin';
            
            // Use DocumentFragment for performance
            const fragment = document.createDocumentFragment();

            sortedBosses.forEach(([key, boss]) => {
                const tr = document.createElement('tr');
                if (isAdmin) {
                    tr.className = 'draggable-row';
                    tr.setAttribute('draggable', 'true');
                }
                tr.setAttribute('data-key', key);

                const spawnInfo = Utils.getSpawnInfo(boss);
                const nextTimeStr = spawnInfo.time ? 
                    `${Utils.formatTimeDisplay(spawnInfo.time)} <span style="font-size:0.8em; color:#ffd6a5;">${spawnInfo.label}</span>` : '-';
                
                // Button generation logic
                const hasMapData = boss.mapX && boss.mapY;
                const locBtnClass = hasMapData ? 'btn-fly-map btn-active-map' : 'btn-location-disabled';
                const locBtnAttrs = hasMapData ? `data-x="${boss.mapX}" data-y="${boss.mapY}"` : 'disabled';
                
                const locBtn = `<button class="btn-icon-toggle ${locBtnClass}" ${locBtnAttrs}>📍</button>`;

                let timeCell, actionCell;
                
                if (isAdmin) {
                    timeCell = `<input type="datetime-local" class="input-time-edit" step="1" data-key="${key}" data-interval="${boss.interval}" value="${Utils.toInputValue(boss.lastKillTimestamp)}">`;
                    actionCell = `
                        <div class="action-btn-group">
                            <button class="btn-success btn-kill" data-key="${key}" data-interval="${boss.interval}" data-last-kill="${boss.lastKillTimestamp || 0}">컷</button>
                            <button class="btn-edit btn-modify" data-key="${key}">수정</button>
                        </div>`;
                } else {
                    timeCell = `<div class="read-only-time">${boss.lastKillTimestamp ? Utils.formatTimeDisplay(boss.lastKillTimestamp) : '-'}</div>`;
                    actionCell = `<span style="font-size:0.8em; color:#5c5e66;">보기 전용</span>`;
                }

                tr.innerHTML = `
                    <td style="font-weight: bold; color: ${boss.color || '#ffadad'};">${boss.name}</td>
                    <td style="text-align:center;">
                        ${locBtn}
                        <div class="info-text-box">${boss.location || '위치 미설정'}</div>
                    </td>
                    <td style="text-align:center;">
                        <button class="btn-icon-toggle" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'block' ? 'none' : 'block'">i</button>
                        <div class="info-text-box">${boss.drop || '정보 없음'}</div>
                    </td>
                    <td style="text-align:center;">${boss.interval ? boss.interval + 'h' : '-'}</td>
                    <td class="col-time">${timeCell}</td>
                    <td class="col-next">${nextTimeStr}</td>
                    <td class="col-action">${actionCell}</td>
                `;
                fragment.appendChild(tr);
            });

            this.dom.tableBody.innerHTML = '';
            this.dom.tableBody.appendChild(fragment);
            
            if (isAdmin) App.initDragAndDrop();
            this.updateCooldowns();
        },

        // Efficiently update button styles without re-rendering table
        updateCooldowns() {
            const now = Date.now();
            // Update table buttons AND panel buttons
            const killBtns = document.querySelectorAll('.btn-kill');
            killBtns.forEach(btn => {
                const lastKill = parseInt(btn.getAttribute('data-last-kill'));
                if (!lastKill) return;
                const diff = now - lastKill;
                
                if (diff < CONFIG.UI.COOLDOWN_MS) {
                    btn.classList.add('btn-disabled');
                    btn.innerText = `컷 (${Math.floor(diff / 1000)}초 전)`;
                } else {
                    if (btn.classList.contains('btn-disabled')) {
                        btn.classList.remove('btn-disabled');
                        btn.innerText = '컷';
                    }
                }
            });
        },

        updateTimerDisplay() {
            if (!state.roomId) return;
            const now = Date.now();
            
            // 1. Prepare data
            const list = Object.values(state.bosses).map(b => ({
                ...b, ...Utils.getSpawnInfo(b),
                effectiveTime: Utils.getSpawnInfo(b).time || 9999999999999,
                key: Object.keys(state.bosses).find(key => state.bosses[key] === b) // Find key for actions
            })).sort((a, b) => a.effectiveTime - b.effectiveTime);

            const [main, next] = list;
            const prev = list.length > 0 ? list[list.length - 1] : null;

            // 2. Render Main
            const mainBtn = this.dom.panels.main.btn;
            if (main && main.effectiveTime < 9999999999999) {
                const diff = main.effectiveTime - now;
                this.dom.panels.main.name.innerText = `[${main.name}] 젠까지${main.label}`;
                this.dom.panels.main.name.style.color = '#00a8fc';
                this.renderLocationButton(this.dom.panels.main.loc, main, false);
                this.dom.panels.main.drop.innerText = main.drop ? `ℹ️ ${main.drop}` : '';

                // Map Auto-Move Logic
                if (state.lastNearestBoss !== main.name) {
                    state.lastNearestBoss = main.name;
                    if (main.mapX && main.mapY) MapController.flyTo(parseFloat(main.mapX), parseFloat(main.mapY));
                }

                // Time formatting
                const h = Math.floor(diff / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                const s = Math.floor((diff % 60000) / 1000);
                this.dom.panels.main.time.innerText = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                
                this.dom.panels.main.time.classList.toggle('timer-warning', diff < CONFIG.UI.WARNING_MS);

                // Update Main Cut Button
                if (state.role === 'admin') {
                    mainBtn.classList.remove('hidden');
                    mainBtn.setAttribute('data-key', main.key);
                    mainBtn.setAttribute('data-interval', main.interval);
                    mainBtn.setAttribute('data-last-kill', main.lastKillTimestamp || 0);
                } else {
                    mainBtn.classList.add('hidden');
                }

            } else {
                this.resetMainTimer();
                mainBtn.classList.add('hidden');
            }

            // 3. Render Side Panels
            this.renderSidePanel(this.dom.panels.prev, prev, now);
            this.renderSidePanel(this.dom.panels.next, next, now);
        },

        resetMainTimer() {
            this.dom.panels.main.name.innerText = "대기 중...";
            this.dom.panels.main.name.style.color = '#949BA4';
            this.dom.panels.main.time.innerText = "--:--:--";
            this.dom.panels.main.time.classList.remove('timer-warning');
            this.dom.panels.main.loc.innerText = '';
            this.dom.panels.main.drop.innerText = '';
            state.lastNearestBoss = null;
        },

        renderSidePanel(el, boss, now) {
            const btn = el.querySelector('.btn-kill-quick');
            if (boss && boss.effectiveTime < 9999999999999 && boss.name !== state.lastNearestBoss) {
                const diff = boss.effectiveTime - now;
                el.querySelector('.side-boss-name').innerText = boss.name;
                el.querySelector('.side-boss-time').innerText = 
                    `${String(Math.floor(diff/3600000)).padStart(2,'0')}:${String(Math.floor((diff%3600000)/60000)).padStart(2,'0')}:${String(Math.floor((diff%60000)/1000)).padStart(2,'0')}`;
                
                this.renderLocationButton(el.querySelector('.side-boss-loc'), boss, true);
                
                // Update Side Cut Button
                if (state.role === 'admin') {
                    btn.classList.remove('hidden');
                    btn.setAttribute('data-key', boss.key);
                    btn.setAttribute('data-interval', boss.interval);
                    btn.setAttribute('data-last-kill', boss.lastKillTimestamp || 0);
                } else {
                    btn.classList.add('hidden');
                }

                el.style.opacity = 1;
            } else {
                el.style.opacity = 0;
                btn.classList.add('hidden');
            }
        },

        renderLocationButton(container, boss, isSide) {
            // optimization: check if needs update
            const existingBtn = container.querySelector('button');
            if (existingBtn && existingBtn.dataset.boss === boss.name && existingBtn.dataset.mx === boss.mapX) return;

            container.innerHTML = '';
            if (!boss.location) {
                container.innerText = isSide ? '-' : '';
                return;
            }

            const btn = document.createElement('button');
            btn.className = 'btn-secondary';
            btn.innerHTML = `📍 ${boss.location}`;
            btn.style.color = '#ffd6a5';
            btn.dataset.boss = boss.name;
            btn.dataset.mx = boss.mapX;

            if (isSide) {
                Object.assign(btn.style, { fontSize: '0.9em', padding: '2px 6px', marginTop: '2px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' });
            } else {
                Object.assign(btn.style, { fontSize: '1.1rem', marginTop: '10px' });
            }

            if (boss.mapX && boss.mapY) {
                btn.onclick = (e) => { e.stopPropagation(); MapController.flyTo(parseFloat(boss.mapX), parseFloat(boss.mapY)); };
                btn.title = "지도 보기";
                btn.style.cursor = 'pointer';
                btn.classList.add('btn-active-map');
            } else {
                btn.disabled = true;
                btn.style.cursor = 'default';
                btn.classList.add('btn-location-disabled');
            }
            container.appendChild(btn);
        },

        handleTableClick(e) {
            const btn = e.target;
            // Handle fly map button
            if (btn.classList.contains('btn-fly-map')) {
                const textBox = btn.nextElementSibling;
                if(textBox) textBox.style.display = textBox.style.display === 'block' ? 'none' : 'block';
                MapController.flyTo(parseFloat(btn.dataset.x), parseFloat(btn.dataset.y));
                return;
            }

            // Handle actions (kill/modify/delete)
            const key = btn.dataset.key;
            if (!key) return;

            if (btn.classList.contains('btn-kill')) {
                if (btn.classList.contains('btn-disabled')) return;
                App.handleKill(key, parseInt(btn.dataset.interval));
            } else if (btn.classList.contains('btn-modify')) {
                this.setEditMode(key);
            } else if (btn.classList.contains('btn-del')) {
                App.handleDelete(key);
            }
        },

        // Handler for panel cut buttons
        handlePanelClick(e) {
            const btn = e.target;
            if (btn.classList.contains('btn-kill')) {
                if (btn.classList.contains('btn-disabled')) return;
                const key = btn.getAttribute('data-key');
                const interval = parseInt(btn.getAttribute('data-interval'));
                if (key && interval) App.handleKill(key, interval);
            }
        },

        handleTableInput(e) {
            if (e.target.classList.contains('input-time-edit')) {
                const key = e.target.dataset.key;
                const interval = parseInt(e.target.dataset.interval);
                const date = new Date(e.target.value);
                if (!isNaN(date.getTime())) App.handleTimeUpdate(key, interval, date.getTime());
                else alert("유효하지 않은 시간입니다.");
            }
        },

        toggleForm() {
            const isHidden = this.dom.form.classList.contains('hidden');
            if (isHidden) {
                this.dom.form.classList.remove('hidden');
                this.dom.btnToggleForm.innerText = '[-] 닫기';
                this.resetForm();
            } else {
                this.dom.form.classList.add('hidden');
                this.dom.btnToggleForm.innerText = '[+] 보스 추가하기';
                this.resetForm();
            }
        },

        setEditMode(key) {
            // Toggle Logic
            if (state.editingKey === key) {
                this.toggleForm(); // Close
                return;
            }

            const data = state.bosses[key];
            if (!data) return;

            state.editingKey = key;
            this.dom.form.classList.remove('hidden');
            this.dom.btnToggleForm.innerText = '[-] 닫기';
            
            // Fill Inputs
            this.dom.formInputs.name.value = data.name;
            this.dom.formInputs.color.value = data.color || '#ffadad';
            this.dom.formInputs.loc.value = data.location || '';
            this.dom.formInputs.drop.value = data.drop || '';
            this.dom.formInputs.interval.value = data.interval || '';
            this.dom.formInputs.mapX.value = data.mapX || '';
            this.dom.formInputs.mapY.value = data.mapY || '';

            // Update Buttons
            this.dom.btnAdd.innerText = "수정";
            this.dom.btnAdd.className = "btn-edit";
            this.dom.btnDelete.classList.remove('hidden');
            
            this.dom.form.scrollIntoView({ behavior: 'smooth' });
        },

        resetForm() {
            state.editingKey = null;
            this.dom.btnAdd.innerText = "등록";
            this.dom.btnAdd.className = "btn-primary";
            this.dom.btnDelete.classList.add('hidden');
            
            Object.values(this.dom.formInputs).forEach(input => input.value = '');
            this.dom.formInputs.color.value = '#ffadad';
        },

        updateUndoUI() {
            if (state.role !== 'admin') return;
            this.dom.undoBtn.disabled = state.undoStack.length === 0;
            this.dom.redoBtn.disabled = state.redoStack.length === 0;
            // Opacity handling removed, CSS handles it based on disabled attribute
        }
    };

    // 7. Main Application Logic
    const App = {
        init() {
            MapController.init();
            UIManager.init();
            this.bindEvents();
            this.checkUrlParams();
            
            // Loop for timer
            setInterval(() => {
                UIManager.updateTimerDisplay();
                UIManager.updateCooldowns();
            }, 1000);
        },

        checkUrlParams() {
            const params = new URLSearchParams(window.location.search);
            const room = params.get('room');
            if (room) document.getElementById('room-input').value = room;
        },

        bindEvents() {
            // Login & Room Entry
            document.getElementById('btn-enter-room').addEventListener('click', () => this.handleLogin());
            document.getElementById('room-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleLogin();
            });

            // Global Actions
            document.getElementById('btn-share-url').addEventListener('click', () => {
                navigator.clipboard.writeText(window.location.href)
                    .then(() => alert("주소가 복사되었습니다!"));
            });
            
            document.getElementById('btn-leave-room').addEventListener('click', () => {
                if (confirm("정말 나가시겠습니까?")) window.location.href = window.location.pathname;
            });

            document.getElementById('btn-sort').addEventListener('click', () => this.handleSort());
            document.getElementById('btn-undo').addEventListener('click', () => this.handleUndo());
            document.getElementById('btn-redo').addEventListener('click', () => this.handleRedo());
            
            // Form Actions
            UIManager.dom.btnAdd.addEventListener('click', () => this.handleFormSubmit());
            UIManager.dom.btnDelete.addEventListener('click', () => {
                if (state.editingKey) this.handleDelete(state.editingKey);
            });
        },

        handleLogin() {
            const room = document.getElementById('room-input').value.trim();
            if (!room) return alert("방 이름을 입력해주세요.");
            
            state.roomId = room;
            state.role = document.querySelector('input[name="role"]:checked').value;
            
            // Reset stacks
            state.undoStack = [];
            state.redoStack = [];

            // Update URL
            const newUrl = `${window.location.pathname}?room=${encodeURIComponent(room)}`;
            window.history.pushState({path: newUrl}, '', newUrl);

            UIManager.switchScreen();
            BossService.listenToRoom(room, (bosses) => UIManager.renderTable(bosses));
        },

        pushHistory(key, data) {
            state.undoStack.push({ key, data: { ...data } });
            state.redoStack = [];
            UIManager.updateUndoUI();
        },

        handleFormSubmit() {
            const inputs = UIManager.dom.formInputs;
            const name = inputs.name.value.trim();
            const interval = inputs.interval.value;
            
            // Validation
            if (!name) return alert('보스명을 입력해주세요.');
            if (name.length > CONFIG.LIMITS.NAME) return alert(`보스명은 ${CONFIG.LIMITS.NAME}자 이내여야 합니다.`);
            if (!interval) return alert('젠 주기를 선택해주세요.');
            if (inputs.loc.value.length > CONFIG.LIMITS.LOC) return alert('위치 정보가 너무 깁니다.');
            if (inputs.drop.value.length > CONFIG.LIMITS.INFO) return alert('정보 내용이 너무 깁니다.');

            const payload = {
                name: name,
                color: inputs.color.value,
                location: inputs.loc.value.trim(),
                drop: inputs.drop.value.trim(),
                interval: interval,
                mapX: inputs.mapX.value,
                mapY: inputs.mapY.value
            };

            if (state.editingKey) {
                // Edit Logic
                const oldData = state.bosses[state.editingKey];
                
                // If rename, delete old
                if (name !== state.editingKey) BossService.removeBoss(state.editingKey);
                
                // Recalculate if interval changed
                let { lastKillTimestamp, nextSpawnTimestamp } = oldData;
                if (lastKillTimestamp && parseInt(interval) !== parseInt(oldData.interval)) {
                    nextSpawnTimestamp = lastKillTimestamp + (parseInt(interval) * 3600000);
                }

                BossService.updateBoss(name, {
                    ...payload,
                    lastKillTimestamp,
                    nextSpawnTimestamp,
                    order: oldData.order
                });
                alert('수정 완료');
            } else {
                // Add Logic
                BossService.updateBoss(name, {
                    ...payload,
                    order: Date.now()
                });
            }
            UIManager.toggleForm(); // Close & Reset
        },

        handleKill(key, interval) {
            if (!interval) return alert("젠 주기가 없습니다.");
            
            this.pushHistory(key, state.bosses[key]);
            
            const now = Date.now();
            const next = now + (interval * 3600000);
            
            BossService.updateBoss(key, {
                lastKillTimestamp: now,
                nextSpawnTimestamp: next
            });
        },

        handleTimeUpdate(key, interval, timestamp) {
            this.pushHistory(key, state.bosses[key]);
            const next = timestamp + (interval * 3600000);
            BossService.updateBoss(key, {
                lastKillTimestamp: timestamp,
                nextSpawnTimestamp: next
            });
        },

        handleDelete(key) {
            if (confirm(`정말로 [${key}] 보스를 삭제하시겠습니까?`)) {
                BossService.removeBoss(key);
                if (state.editingKey) UIManager.toggleForm();
            }
        },

        handleSort() {
            const list = Object.entries(state.bosses);
            list.sort((a, b) => {
                const tA = Utils.getSpawnInfo(a[1]).time || 9999999999999;
                const tB = Utils.getSpawnInfo(b[1]).time || 9999999999999;
                return tA - tB;
            });
            
            const updates = {};
            list.forEach((entry, idx) => {
                updates[`${state.roomId}/bosses/${entry[0]}/order`] = idx;
            });
            BossService.saveOrder(updates);
        },

        handleUndo() {
            if (!state.undoStack.length) return;
            const action = state.undoStack.pop();
            state.redoStack.push({ key: action.key, data: { ...state.bosses[action.key] } });
            
            BossService.updateBoss(action.key, {
                lastKillTimestamp: action.data.lastKillTimestamp,
                nextSpawnTimestamp: action.data.nextSpawnTimestamp
            });
            UIManager.updateUndoUI();
        },

        handleRedo() {
            if (!state.redoStack.length) return;
            const action = state.redoStack.pop();
            state.undoStack.push({ key: action.key, data: { ...state.bosses[action.key] } });
            
            BossService.updateBoss(action.key, {
                lastKillTimestamp: action.data.lastKillTimestamp,
                nextSpawnTimestamp: action.data.nextSpawnTimestamp
            });
            UIManager.updateUndoUI();
        },

        initDragAndDrop() {
            const container = UIManager.dom.tableBody;
            const draggables = container.querySelectorAll('.draggable-row');
            
            draggables.forEach(draggable => {
                draggable.addEventListener('dragstart', () => draggable.classList.add('dragging'));
                draggable.addEventListener('dragend', () => {
                    draggable.classList.remove('dragging');
                    this.saveNewOrder();
                });
            });

            container.addEventListener('dragover', e => {
                e.preventDefault();
                const afterElement = this.getDragAfterElement(container, e.clientY);
                const draggable = document.querySelector('.dragging');
                if (afterElement == null) container.appendChild(draggable);
                else container.insertBefore(draggable, afterElement);
            });
        },

        getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.draggable-row:not(.dragging)')];
            return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
                else return closest;
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        },

        saveNewOrder() {
            const updates = {};
            document.querySelectorAll('#table-body tr').forEach((row, index) => {
                updates[`${state.roomId}/bosses/${row.dataset.key}/order`] = index;
            });
            BossService.saveOrder(updates);
        }
    };

  App.init()
}
