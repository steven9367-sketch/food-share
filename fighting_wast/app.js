import { dbService, getSavedFirebaseConfig, saveFirebaseConfig } from './firebase-config.js';

// Global application state
const state = {
  items: [],
  currentFilter: {
    keyword: '',
    category: 'all',
    freshness: 'all',
    expiry: 'all',
  },
  activeTab: 'public-hub', // public-hub, admin-panel
  editingItemId: null,
  capturedImageData: null, // Holds the current base64 image during YOLO scanning
  cameraStream: null
};

// Simulated YOLO AI Object presets for convenience food
const YOLO_PRESETS = [
  { name: "御飯糰-鮪魚肉鬆", freshnessRange: [85, 98], shelfLifeHours: 24, notes: "包裝無破損，海苔緊實脆綠。" },
  { name: "超商經典三明治", freshnessRange: [75, 95], shelfLifeHours: 18, notes: "蔬菜吐司狀態完好，冷藏保存中。" },
  { name: "鮮乳大盒裝", freshnessRange: [80, 96], shelfLifeHours: 72, notes: "瓶蓋密封無膨脹，標籤完整。" },
  { name: "香烤雞肉生鮮沙拉", freshnessRange: [60, 92], shelfLifeHours: 12, notes: "蔬菜色澤翠綠無出水，附醬包。" },
  { name: "經典熱狗大亨堡", freshnessRange: [85, 97], shelfLifeHours: 36, notes: "麵包蓬鬆，包裝密封完整。" }
];

// Initialize application on load
window.addEventListener('DOMContentLoaded', async () => {
  showToast('系統初始化中...', 'info');
  
  // 1. Initial connection setup
  await dbService.initialize();
  
  // 2. Fetch and render items
  await refreshData();
  
  // 3. Bind UI event listeners
  setupEventListeners();

  // 4. Populate Firebase config in settings modal input
  populateConfigInputs();
  
  // Subscribe to live local updates (if any fallback triggers)
  dbService.subscribe(async () => {
    await refreshData();
  });
  
  showToast(dbService.isLiveFirebase ? '已成功連線至 Firebase!' : '目前以本地展示模式運作', 'info');
});

// Fetch and display latest listings and update stats
async function refreshData() {
  state.items = await dbService.getItems();
  renderPublicListings();
  renderAdminTable();
  updateStatsAndCharts();
}

// Renders public list cards
function renderPublicListings() {
  const container = document.getElementById('listings-container');
  if (!container) return;

  const filtered = filterItems(state.items);
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-secondary); background: var(--bg-card); border-radius: var(--border-radius); border: 1px solid var(--border-color);">
        <i class="fas fa-box-open" style="font-size: 3rem; margin-bottom: 1rem; color: var(--text-muted);"></i>
        <p>目前沒有符合篩選條件的食物項目</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    // Determine category badge class
    let badgeClass = 'badge-expiring';
    let catText = '超商即期';
    if (item.category === 'bento') { badgeClass = 'badge-bento'; catText = '餐廳便當'; }
    else if (item.category === 'waste') { badgeClass = 'badge-waste'; catText = '餐廳廚餘'; }
    else if (item.category === 'event') { badgeClass = 'badge-event'; catText = '活動餐盒'; }

    // Freshness color ring class
    let freshnessClass = '';
    if (item.freshness < 50) freshnessClass = 'critical';
    else if (item.freshness < 80) freshnessClass = 'warning';

    // Claim button status
    const isClaimed = item.status === 'claimed';
    const isDisposed = item.status === 'disposed';
    const btnText = isClaimed ? '已被索取' : (isDisposed ? '已作處置' : '立即索取');
    const isBtnDisabled = isClaimed || isDisposed;

    return `
      <div class="food-card" data-id="${item.id}">
        <div class="card-img-wrapper">
          <img class="card-img" src="${item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400'}" alt="${item.name}">
          <span class="card-badge ${badgeClass}">${catText}</span>
          ${item.category === 'expiring' && item.freshness ? `
            <div class="card-freshness-ring ${freshnessClass}">
              <span>${item.freshness}%</span>
              <span style="font-size: 0.5rem; font-weight: 500; margin-top:-2px;">新鮮</span>
            </div>
          ` : ''}
        </div>
        <div class="card-content">
          <h3 class="card-title">${escapeHTML(item.name)}</h3>
          <div class="card-meta-list">
            <div class="card-meta-item">
              <i class="far fa-calendar-alt"></i>
              <span>保存期限: ${item.expDate}</span>
            </div>
            <div class="card-meta-item">
              <i class="fas fa-heartbeat"></i>
              <span>健康/新鮮度: ${item.freshness ? item.freshness + '%' : '一般'}</span>
            </div>
            <div class="card-meta-item">
              <i class="fas fa-map-marker-alt"></i>
              <span>處置狀態: ${getDisposalText(item.status)}</span>
            </div>
          </div>
          ${item.notes ? `<div class="card-notes">${escapeHTML(item.notes)}</div>` : ''}
          <div class="card-footer">
            <button class="btn btn-secondary card-detail-btn" onclick="window.viewItemDetails('${item.id}')">
              詳細資料
            </button>
            <button class="btn" ${isBtnDisabled ? 'disabled' : ''} onclick="window.claimFoodItem('${item.id}')">
              <i class="fas ${isClaimed ? 'fa-check-circle' : 'fa-hand-holding-heart'}"></i> ${btnText}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Renders back-end management table
function renderAdminTable() {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;

  if (state.items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          目前尚無登錄任何食物紀錄
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.items.map(item => {
    let catBadge = '';
    if (item.category === 'expiring') catBadge = '<span class="card-badge badge-expiring" style="position:static; padding:0.15rem 0.5rem; font-size:0.7rem;">超商即期</span>';
    else if (item.category === 'bento') catBadge = '<span class="card-badge badge-bento" style="position:static; padding:0.15rem 0.5rem; font-size:0.7rem;">餐廳便當</span>';
    else if (item.category === 'waste') catBadge = '<span class="card-badge badge-waste" style="position:static; padding:0.15rem 0.5rem; font-size:0.7rem;">餐廳廚餘</span>';
    else if (item.category === 'event') catBadge = '<span class="card-badge badge-event" style="position:static; padding:0.15rem 0.5rem; font-size:0.7rem;">活動餐盒</span>';

    let statusBadge = '';
    if (item.status === 'available') statusBadge = '<span class="card-status status-available">可索取</span>';
    else if (item.status === 'claimed') statusBadge = '<span class="card-status status-claimed">已索取</span>';
    else if (item.status === 'disposed') statusBadge = '<span class="card-status status-disposed">已處置</span>';

    return `
      <tr>
        <td><strong>${escapeHTML(item.name)}</strong></td>
        <td>${catBadge}</td>
        <td>
          <div style="font-size: 0.85rem;">期限: ${item.expDate}</div>
          <div style="font-size: 0.85rem; color: var(--primary);">新鮮度: ${item.freshness}%</div>
        </td>
        <td>${statusBadge}</td>
        <td>
          <div class="admin-action-btns">
            <button class="btn-icon edit" onclick="window.editAdminItem('${item.id}')" title="編輯項目">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon" onclick="window.toggleItemStatus('${item.id}')" title="變更處置狀態">
              <i class="fas fa-sync-alt"></i>
            </button>
            <button class="btn-icon delete" onclick="window.deleteAdminItem('${item.id}')" title="刪除紀錄">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Update statistics and chart percentages
function updateStatsAndCharts() {
  const totalWeightNode = document.getElementById('stat-total-weight');
  const itemsSavedNode = document.getElementById('stat-items-saved');
  const bentoCountNode = document.getElementById('stat-bento-count');
  const wasteCountNode = document.getElementById('stat-waste-count');

  let totalWeight = 0;
  let itemsSaved = 0;
  let bentoCount = 0;
  let wasteCount = 0;

  // Counts by category for the CSS chart
  const counts = { expiring: 0, bento: 0, waste: 0, event: 0 };

  state.items.forEach(item => {
    counts[item.category] = (counts[item.category] || 0) + 1;

    if (item.category === 'waste') {
      // Extract weight from note or default to 5kg
      const weightMatch = item.notes ? item.notes.match(/(\d+(\.\d+)?)\s*(kg|公斤)/i) : null;
      totalWeight += weightMatch ? parseFloat(weightMatch[1]) : 5;
      wasteCount++;
    } else {
      if (item.status === 'claimed') {
        itemsSaved++;
      }
      if (item.category === 'bento') {
        bentoCount++;
      }
    }
  });

  if (totalWeightNode) totalWeightNode.textContent = totalWeight.toFixed(1) + ' kg';
  if (itemsSavedNode) itemsSavedNode.textContent = itemsSaved + ' 件';
  if (bentoCountNode) bentoCountNode.textContent = bentoCount + ' 個';
  if (wasteCountNode) wasteCountNode.textContent = wasteCount + ' 筆';

  // Update progress bars
  const total = state.items.length || 1;
  const categories = ['expiring', 'bento', 'waste', 'event'];
  categories.forEach(cat => {
    const fillEl = document.getElementById(`chart-fill-${cat}`);
    const valEl = document.getElementById(`chart-val-${cat}`);
    if (fillEl && valEl) {
      const pct = Math.round((counts[cat] / total) * 100);
      fillEl.style.width = `${pct}%`;
      valEl.textContent = `${counts[cat]} 筆`;
    }
  });
}

// Filtering algorithm
function filterItems(items) {
  return items.filter(item => {
    // 1. Keyword search (name / notes)
    if (state.currentFilter.keyword) {
      const kw = state.currentFilter.keyword.toLowerCase();
      const nameMatch = item.name.toLowerCase().includes(kw);
      const notesMatch = item.notes && item.notes.toLowerCase().includes(kw);
      if (!nameMatch && !notesMatch) return false;
    }

    // 2. Category filter
    if (state.currentFilter.category !== 'all') {
      if (item.category !== state.currentFilter.category) return false;
    }

    // 3. Freshness Filter
    if (state.currentFilter.freshness !== 'all') {
      const freshnessVal = parseInt(item.freshness) || 100;
      if (state.currentFilter.freshness === 'high' && freshnessVal < 80) return false;
      if (state.currentFilter.freshness === 'medium' && (freshnessVal < 50 || freshnessVal >= 80)) return false;
      if (state.currentFilter.freshness === 'low' && freshnessVal >= 50) return false;
    }

    // 4. Expiry Filter
    if (state.currentFilter.expiry !== 'all') {
      const today = new Date();
      today.setHours(0,0,0,0);
      const expDate = new Date(item.expDate);
      expDate.setHours(0,0,0,0);

      const diffTime = expDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (state.currentFilter.expiry === 'today' && diffDays !== 0) return false;
      if (state.currentFilter.expiry === 'tomorrow' && diffDays !== 1) return false;
      if (state.currentFilter.expiry === '3days' && (diffDays < 0 || diffDays > 3)) return false;
    }

    return true;
  });
}

// Event Listeners Registration
function setupEventListeners() {
  // Navigation Tabs switching
  document.querySelectorAll('[data-target-section]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = btn.getAttribute('data-target-section');
      switchTab(target);
    });
  });

  // Logo link back to homepage
  const logo = document.querySelector('.logo');
  if (logo) {
    logo.addEventListener('click', () => switchTab('public-hub'));
  }

  // Search Filter triggers
  const searchInput = document.getElementById('search-keyword');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.currentFilter.keyword = e.target.value;
      renderPublicListings();
    });
  }

  const filterCategory = document.getElementById('filter-category');
  if (filterCategory) {
    filterCategory.addEventListener('change', (e) => {
      state.currentFilter.category = e.target.value;
      renderPublicListings();
    });
  }

  const filterFreshness = document.getElementById('filter-freshness');
  if (filterFreshness) {
    filterFreshness.addEventListener('change', (e) => {
      state.currentFilter.freshness = e.target.value;
      renderPublicListings();
    });
  }

  const filterExpiry = document.getElementById('filter-expiry');
  if (filterExpiry) {
    filterExpiry.addEventListener('change', (e) => {
      state.currentFilter.expiry = e.target.value;
      renderPublicListings();
    });
  }

  // Admin New Item Form submission
  const adminForm = document.getElementById('admin-food-form');
  if (adminForm) {
    adminForm.addEventListener('submit', handleAdminFormSubmit);
  }

  // Admin Form Reset button / Category switch listener
  const foodCategorySelect = document.getElementById('food-category');
  const expiringFoodFields = document.getElementById('expiring-food-fields');
  
  if (foodCategorySelect && expiringFoodFields) {
    foodCategorySelect.addEventListener('change', (e) => {
      if (e.target.value === 'expiring') {
        expiringFoodFields.style.display = 'block';
      } else {
        expiringFoodFields.style.display = 'none';
      }
    });
  }

  // Mobile camera upload logic
  const cameraTrigger = document.getElementById('camera-trigger');
  if (cameraTrigger) {
    cameraTrigger.addEventListener('click', openCameraModal);
  }

  const imageFileInput = document.getElementById('image-file-input');
  if (imageFileInput) {
    imageFileInput.addEventListener('change', handleFileSelect);
  }

  // Firebase Config panel save
  const firebaseForm = document.getElementById('firebase-config-form');
  if (firebaseForm) {
    firebaseForm.addEventListener('submit', handleFirebaseConfigSubmit);
  }
}

// Dynamic tab switching
function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.remove('active');
  });
  const targetSec = document.getElementById(tabId);
  if (targetSec) targetSec.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-target-section') === tabId) {
      btn.classList.add('active');
    }
  });

  // Close camera preview stream if switching away from admin
  if (tabId !== 'admin-panel') {
    closeCameraStream();
  }
}

// Modal open/close actions
window.openModal = function(modalId) {
  const overlay = document.getElementById(modalId);
  if (overlay) overlay.classList.add('active');
};

window.closeModal = function(modalId) {
  const overlay = document.getElementById(modalId);
  if (overlay) {
    overlay.classList.remove('active');
    if (modalId === 'camera-modal') {
      closeCameraStream();
    }
  }
};

// Item Details view
window.viewItemDetails = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  const detailBody = document.getElementById('detail-modal-body');
  if (!detailBody) return;

  detailBody.innerHTML = `
    <img class="modal-detail-img" src="${item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400'}" alt="${item.name}">
    <h2 class="card-title" style="font-size:1.5rem; margin-bottom:1rem;">${escapeHTML(item.name)}</h2>
    
    <div class="detail-grid">
      <div class="detail-item">
        <span>食品類別</span>
        <span>${getCategoryText(item.category)}</span>
      </div>
      <div class="detail-item">
        <span>新鮮度評級</span>
        <span style="color:${item.freshness > 80 ? 'var(--primary)' : 'var(--cat-bento)'}; font-weight:bold;">
          ${item.freshness ? item.freshness + '%' : '一般'}
        </span>
      </div>
      <div class="detail-item">
        <span>製造日期</span>
        <span>${item.mfgDate || '未標示'}</span>
      </div>
      <div class="detail-item">
        <span>保存期限</span>
        <span>${item.expDate}</span>
      </div>
      <div class="detail-item">
        <span>當前狀態</span>
        <span>${getDisposalText(item.status)}</span>
      </div>
      <div class="detail-item">
        <span>登錄時間</span>
        <span>${new Date(item.createdAt).toLocaleString()}</span>
      </div>
    </div>
    
    <div class="detail-item" style="margin-top:0.5rem; margin-bottom:1rem;">
      <span>管理編號</span>
      <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${item.id}</span>
    </div>

    <span>備註說明</span>
    <div class="detail-notes-box">${escapeHTML(item.notes || '無額外備註。')}</div>
  `;

  // Action Claim button in modal
  const modalFooter = document.getElementById('detail-modal-footer');
  if (modalFooter) {
    const isClaimed = item.status === 'claimed';
    const isDisposed = item.status === 'disposed';
    modalFooter.innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal('detail-modal')">關閉</button>
      <button class="btn" ${isClaimed || isDisposed ? 'disabled' : ''} onclick="window.claimFoodItem('${item.id}'); closeModal('detail-modal');">
        <i class="fas fa-hand-holding-heart"></i> ${isClaimed ? '已被索取' : '立即索取'}
      </button>
    `;
  }

  openModal('detail-modal');
};

// Customer claim action
window.claimFoodItem = async function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  if (confirm(`確定要索取「${item.name}」嗎？`)) {
    showToast('正在變更狀態...', 'info');
    const success = await dbService.updateItem(id, { status: 'claimed' });
    if (success) {
      showToast('索取成功！請儘速至指定地點取用！');
      await refreshData();
    } else {
      showToast('更新失敗，請再試一次', 'error');
    }
  }
};

// Toggle status of item (Admin action)
window.toggleItemStatus = async function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  // Lifecycle status: available -> claimed -> disposed -> available
  let nextStatus = 'available';
  if (item.status === 'available') nextStatus = 'claimed';
  else if (item.status === 'claimed') nextStatus = 'disposed';

  showToast('更新項目狀態...', 'info');
  const success = await dbService.updateItem(id, { status: nextStatus });
  if (success) {
    showToast(`已變更項目狀態為: ${getDisposalText(nextStatus)}`);
    await refreshData();
  } else {
    showToast('更新失敗', 'error');
  }
};

// Edit admin item info
window.editAdminItem = function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  state.editingItemId = id;
  
  // Fill inputs
  document.getElementById('food-name').value = item.name;
  document.getElementById('food-category').value = item.category;
  document.getElementById('food-mfg-date').value = item.mfgDate || '';
  document.getElementById('food-exp-date').value = item.expDate;
  document.getElementById('food-freshness').value = item.freshness || 80;
  document.getElementById('food-status').value = item.status;
  document.getElementById('food-notes').value = item.notes || '';
  
  // Show expiring group if category matches
  const expiringFoodFields = document.getElementById('expiring-food-fields');
  if (item.category === 'expiring') {
    expiringFoodFields.style.display = 'block';
  } else {
    expiringFoodFields.style.display = 'none';
  }

  // Display image preview
  if (item.imageUrl) {
    state.capturedImageData = item.imageUrl;
    showImagePreview(item.imageUrl);
  }

  // Change submit button text
  const submitBtn = document.getElementById('submit-food-btn');
  if (submitBtn) {
    submitBtn.innerHTML = '<i class="fas fa-save"></i> 儲存修改內容';
  }

  showToast('已載入該食品資料至左側編輯區');
  // Auto scroll form into view on mobile
  document.getElementById('admin-food-form').scrollIntoView({ behavior: 'smooth' });
};

// Delete item
window.deleteAdminItem = async function(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  if (confirm(`警告：確定要永久刪除「${item.name}」的紀錄嗎？`)) {
    showToast('刪除紀錄中...', 'info');
    const success = await dbService.deleteItem(id);
    if (success) {
      showToast('紀錄已成功刪除');
      // If we were editing this item, reset form
      if (state.editingItemId === id) {
        resetAdminForm();
      }
      await refreshData();
    } else {
      showToast('刪除失敗', 'error');
    }
  }
};

// Reset management form
function resetAdminForm() {
  state.editingItemId = null;
  state.capturedImageData = null;
  
  const form = document.getElementById('admin-food-form');
  if (form) form.reset();

  const previewZone = document.getElementById('camera-trigger');
  if (previewZone) {
    previewZone.classList.remove('has-photo');
    previewZone.innerHTML = `
      <i class="fas fa-camera-retro"></i>
      <p>搭配手機鏡頭拍照辨識 (YOLO AI)</p>
      <span style="font-size: 0.75rem; color: var(--text-muted);">或點選上傳本地食品照片</span>
    `;
  }

  const submitBtn = document.getElementById('submit-food-btn');
  if (submitBtn) {
    submitBtn.innerHTML = '<i class="fas fa-plus"></i> 新增食物項目';
  }
}

// Add/Update Submit Handler
async function handleAdminFormSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('food-name').value.trim();
  const category = document.getElementById('food-category').value;
  const mfgDate = document.getElementById('food-mfg-date').value;
  const expDate = document.getElementById('food-exp-date').value;
  const freshness = parseInt(document.getElementById('food-freshness').value) || 80;
  const status = document.getElementById('food-status').value;
  const notes = document.getElementById('food-notes').value.trim();

  if (!name || !expDate) {
    showToast('請填寫食品名稱與保存期限！', 'error');
    return;
  }

  showToast(state.editingItemId ? '更新中...' : '新增中...', 'info');

  let imageUrl = state.capturedImageData;
  
  // If we have captured base64 image, upload it
  if (state.capturedImageData && state.capturedImageData.startsWith('data:image')) {
    imageUrl = await dbService.uploadImage(state.capturedImageData, `${name.replace(/\s+/g, '_')}.jpg`);
  }

  const payload = {
    name,
    category,
    mfgDate,
    expDate,
    freshness,
    status,
    notes,
    imageUrl: imageUrl || getDefaultCategoryImage(category)
  };

  let success = false;
  if (state.editingItemId) {
    success = await dbService.updateItem(state.editingItemId, payload);
    if (success) showToast('食品資料已成功更新！');
  } else {
    const newItem = await dbService.addItem(payload);
    success = !!newItem;
    if (success) showToast('新食品項目已成功登錄！');
  }

  if (success) {
    resetAdminForm();
    await refreshData();
  } else {
    showToast('資料提交失敗，請檢查網路連線', 'error');
  }
}

// --- YOLO CAMERA & SIMULATION MODULE ---

async function openCameraModal() {
  openModal('camera-modal');
  
  const video = document.getElementById('yolo-video');
  const canvas = document.getElementById('yolo-photo-canvas');
  const startBtn = document.getElementById('camera-start-btn');
  const captureBtn = document.getElementById('camera-capture-btn');
  const resultPanel = document.getElementById('yolo-result-panel');
  const boxOverlay = document.getElementById('yolo-box-overlay');

  if (boxOverlay) boxOverlay.style.display = 'none';
  if (resultPanel) resultPanel.classList.remove('active');
  if (canvas) canvas.style.display = 'none';
  if (video) video.style.display = 'block';
  
  if (captureBtn) captureBtn.disabled = true;

  try {
    // Access camera with rear camera preferred on phones
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    
    if (video) {
      video.srcObject = state.cameraStream;
      video.play();
    }
    
    if (captureBtn) captureBtn.disabled = false;
    showToast('相機啟動成功', 'info');
  } catch (err) {
    console.error("Camera access denied or unavailable", err);
    showToast('無法存取相機鏡頭，請使用本地上傳功能或授予網頁相機權限', 'error');
    closeModal('camera-modal');
    // Trigger file chooser immediately as fallback
    document.getElementById('image-file-input').click();
  }
}

// Capture current video frame and run YOLO simulation
window.capturePhoto = function() {
  const video = document.getElementById('yolo-video');
  const canvas = document.getElementById('yolo-photo-canvas');
  const captureBtn = document.getElementById('camera-capture-btn');
  const container = document.querySelector('.yolo-camera-box');
  
  if (!video || !canvas || !state.cameraStream) return;

  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  // Draw snapshot onto canvas
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // Freeze camera
  video.style.display = 'none';
  canvas.style.display = 'block';
  if (captureBtn) captureBtn.disabled = true;

  // Convert to Base64 image
  state.capturedImageData = canvas.toDataURL('image/jpeg');

  // Trigger simulated YOLO scanning animation
  runYOLOSimulation(canvas.width, canvas.height);
};

// Simulation algorithm for YOLO AI Freshness Detection
function runYOLOSimulation(imgWidth, imgHeight) {
  const container = document.querySelector('.yolo-camera-box');
  container.classList.add('yolo-scanning');
  
  showToast('YOLOv8 深度學習網路載入中...', 'info');

  // Simulate scanning for 1.8 seconds
  setTimeout(() => {
    container.classList.remove('yolo-scanning');
    
    // Choose a random preset for food item
    const preset = YOLO_PRESETS[Math.floor(Math.random() * YOLO_PRESETS.length)];
    const freshness = Math.floor(Math.random() * (preset.freshnessRange[1] - preset.freshnessRange[0] + 1)) + preset.freshnessRange[0];
    
    // Auto-calculate dates based on preset shelf life
    const now = new Date();
    const mfgDateString = now.toISOString().split('T')[0];
    
    const expDate = new Date(now.getTime() + 1000 * 60 * 60 * preset.shelfLifeHours);
    const expDateString = expDate.toISOString().split('T')[0];

    // Bounding box mapping coordinates (simulated percentage)
    const boxLeft = 20; 
    const boxTop = 25;
    const boxWidth = 60;
    const boxHeight = 50;

    // Display Simulated YOLO Box
    const boxOverlay = document.getElementById('yolo-box-overlay');
    const labelSpan = document.getElementById('yolo-label-span');
    
    if (boxOverlay && labelSpan) {
      boxOverlay.style.left = `${boxLeft}%`;
      boxOverlay.style.top = `${boxTop}%`;
      boxOverlay.style.width = `${boxWidth}%`;
      boxOverlay.style.height = `${boxHeight}%`;
      boxOverlay.style.display = 'block';
      labelSpan.textContent = `${preset.name} - YOLO v8 (Freshness: ${freshness}%)`;
    }

    // Populate dynamic results panel in modal
    const resultPanel = document.getElementById('yolo-result-panel');
    const resultText = document.getElementById('yolo-result-text');
    if (resultPanel && resultText) {
      let freshPill = 'fresh';
      let freshText = '新鮮無虞';
      if (freshness < 70) { freshPill = 'bad'; freshText = '即將過期，儘速食用'; }
      else if (freshness < 85) { freshPill = 'warning'; freshText = '稍有存放，新鮮中等'; }

      resultText.innerHTML = `
        <strong>識別結果：</strong> ${preset.name} <span class="yolo-pill ${freshPill}">${freshness}% 新鮮度 (${freshText})</span><br>
        <strong>建議保存期限：</strong> ${expDateString} (建議置於冷藏)<br>
        <strong>備註摘要：</strong> ${preset.notes}
      `;
      resultPanel.classList.add('active');
    }

    // Temporarily save details to form fields
    window.tempYoloResults = {
      name: preset.name,
      mfgDate: mfgDateString,
      expDate: expDateString,
      freshness: freshness,
      notes: `${preset.notes} (由 YOLOv8 AI 智慧辨識識別)`
    };

    showToast('YOLO 辨識完成！', 'info');
  }, 1800);
}

// User confirms yolo recognition results to autofill forms
window.applyYOLOResults = function() {
  if (!window.tempYoloResults) return;

  const results = window.tempYoloResults;
  document.getElementById('food-name').value = results.name;
  document.getElementById('food-category').value = 'expiring';
  document.getElementById('food-mfg-date').value = results.mfgDate;
  document.getElementById('food-exp-date').value = results.expDate;
  document.getElementById('food-freshness').value = results.freshness;
  document.getElementById('food-notes').value = results.notes;

  // Toggle fields visibility
  document.getElementById('expiring-food-fields').style.display = 'block';

  // Show captured image preview inside trigger zone
  if (state.capturedImageData) {
    showImagePreview(state.capturedImageData);
  }

  closeModal('camera-modal');
  showToast('已為您自動填入食品辨識資訊！');
  
  // Clean up
  window.tempYoloResults = null;
};

// Handle file chooser input fallback
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    state.capturedImageData = event.target.result;
    
    // Simulate opening the camera frame but placing the picture there
    openCameraModal().then(() => {
      // Force mock rendering since video isn't capturing
      const video = document.getElementById('yolo-video');
      const canvas = document.getElementById('yolo-photo-canvas');
      const captureBtn = document.getElementById('camera-capture-btn');
      
      closeCameraStream(); // Don't need real stream since we upload file
      
      if (video) video.style.display = 'none';
      if (captureBtn) captureBtn.disabled = true;
      
      if (canvas) {
        canvas.style.display = 'block';
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = function() {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          runYOLOSimulation(canvas.width, canvas.height);
        };
        img.src = event.target.result;
      }
    });
  };
  reader.readAsDataURL(file);
}

// Display uploaded/captured image preview in the UI form
function showImagePreview(base64Data) {
  const triggerZone = document.getElementById('camera-trigger');
  if (triggerZone) {
    triggerZone.classList.add('has-photo');
    triggerZone.innerHTML = `
      <img class="camera-preview-thumb" src="${base64Data}" alt="Food Preview">
      <p style="margin-top: 0.5rem; color: var(--primary); font-size: 0.85rem;">
        <i class="fas fa-check-circle"></i> 已上傳/擷取相片 (點選重新拍照)
      </p>
    `;
  }
}

// Close and release mobile camera resource
function closeCameraStream() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  const video = document.getElementById('yolo-video');
  if (video) video.srcObject = null;
}

// --- FIREBASE SETTINGS CONFIGURATION ---

function populateConfigInputs() {
  const saved = getSavedFirebaseConfig();
  if (saved) {
    document.getElementById('fb-api-key').value = saved.apiKey || '';
    document.getElementById('fb-auth-domain').value = saved.authDomain || '';
    document.getElementById('fb-project-id').value = saved.projectId || '';
    document.getElementById('fb-storage-bucket').value = saved.storageBucket || '';
    document.getElementById('fb-messaging-sender-id').value = saved.messagingSenderId || '';
    document.getElementById('fb-app-id').value = saved.appId || '';
  }
}

async function handleFirebaseConfigSubmit(e) {
  e.preventDefault();

  const config = {
    apiKey: document.getElementById('fb-api-key').value.trim(),
    authDomain: document.getElementById('fb-auth-domain').value.trim(),
    projectId: document.getElementById('fb-project-id').value.trim(),
    storageBucket: document.getElementById('fb-storage-bucket').value.trim(),
    messagingSenderId: document.getElementById('fb-messaging-sender-id').value.trim(),
    appId: document.getElementById('fb-app-id').value.trim()
  };

  if (!config.apiKey || !config.projectId) {
    // Clear config to reset to demo
    saveFirebaseConfig(null);
    showToast('Firebase 配置已清除，回到 LocalStorage 演示模式。', 'info');
    closeModal('settings-modal');
    setTimeout(() => window.location.reload(), 1000);
    return;
  }

  saveFirebaseConfig(config);
  showToast('Firebase 設定已儲存！重載中...', 'info');
  closeModal('settings-modal');
  
  // Reload site to re-init firebase adapter with new configurations
  setTimeout(() => window.location.reload(), 1500);
}

// --- UTILITY LOGICS ---

// Show toast notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'fa-check-circle';
  if (type === 'error') icon = 'fa-exclamation-triangle';
  else if (type === 'info') icon = 'fa-info-circle';

  toast.innerHTML = `
    <i class="fas ${icon}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  
  // Trigger layout for transition
  setTimeout(() => toast.classList.add('active'), 50);

  // Auto remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => {
      toast.remove();
    }, 450);
  }, 3000);
}

// Category string mapping helper
function getCategoryText(cat) {
  switch (cat) {
    case 'expiring': return '超商即期食品';
    case 'bento': return '餐廳未售完便當';
    case 'waste': return '餐廳廚餘物資';
    case 'event': return '學校活動餐盒剩餘';
    default: return '一般食品';
  }
}

// Status text mapping helper
function getDisposalText(status) {
  switch (status) {
    case 'available': return '尚有餘量 (可索取)';
    case 'claimed': return '已全數索取';
    case 'disposed': return '已完成廢棄處置';
    default: return '未知';
  }
}

// Default image generator for categories
function getDefaultCategoryImage(cat) {
  switch (cat) {
    case 'expiring':
      return "https://images.unsplash.com/photo-1618040981136-1e6cfa3f20d1?auto=format&fit=crop&q=80&w=400";
    case 'bento':
      return "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=400";
    case 'waste':
      return "https://images.unsplash.com/photo-1606787366850-de6330128bfc?auto=format&fit=crop&q=80&w=400";
    case 'event':
      return "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&q=80&w=400";
    default:
      return "https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&q=80&w=400";
  }
}

// Simple HTML escaping helper to prevent XSS
function escapeHTML(str) {
  if (!str) return '';
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
