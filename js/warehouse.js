/**
 * TikTok Return Parcel Inspection System
 * Warehouse Mobile Engine (warehouse.js)
 */

// URL หลักของ Google Apps Script Web App (ฝังถาวร)
const API_URL = "https://script.google.com/macros/s/AKfycbxs3LzbtEOj2036lhcXrZOtr9hkh0Dg2349rSjQ0H-hX3maVZUgrVEt3N_3FsreWFeb/exec";

const State = {
  currentView: 'scanner', // 'scanner' | 'dashboard'
  orders: [],
  currentOrder: null,
  recentHistory: JSON.parse(localStorage.getItem('wh_recent_history') || '[]'),
  
  html5QrCode: null,
  isScanning: false,
  
  photoBase64: null,
  videoBase64: null,
  
  audioCtx: null
};

// ==========================================
// 1. SOUND & HAPTIC FEEDBACK
// ==========================================
function playBeep(type = 'success') {
  try {
    if (!State.audioCtx) {
      State.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = State.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {}
}

function triggerHaptic(ms = 60) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// ==========================================
// 2. IMAGE COMPRESSION (720p Lightweight)
// ==========================================
async function compressImage720p(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxDim = 720; // 720p resolution
        
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        resolve({
          dataUrl: dataUrl,
          base64: dataUrl.split(',')[1]
        });
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

// ==========================================
// 3. AUTO-SYNC DATA FROM GOOGLE SHEETS
// ==========================================
async function syncDataFromSheet(showToast = false) {
  const syncStatusEl = document.getElementById('header-sync-status');
  const syncIcon = document.getElementById('sync-icon');
  
  if (syncIcon) syncIcon.classList.add('animate-spin');
  if (syncStatusEl) syncStatusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> กำลังดึงข้อมูลล่าสุด...';
  
  try {
    const res = await fetch(`${API_URL}?action=getOrders&limit=3000&_t=${Date.now()}`);
    const data = await res.json();
    
    if (data.success && data.orders) {
      State.orders = data.orders;
      localStorage.setItem('wh_cached_orders', JSON.stringify(data.orders));
      
      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> พร้อมสแกน (${data.orders.length} รายการ)`;
      }
      if (showToast) {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: `อัปเดตข้อมูลแล้ว ${data.orders.length} รายการ`,
          showConfirmButton: false,
          timer: 1500
        });
      }
    }
  } catch (err) {
    console.warn('Sync failed, using offline cache:', err);
    const cached = localStorage.getItem('wh_cached_orders');
    if (cached) {
      State.orders = JSON.parse(cached);
      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-300"></span> ออฟไลน์ (${State.orders.length} รายการ)`;
      }
    } else {
      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-400"></span> ไม่สามารถติดต่อระบบได้`;
      }
    }
  } finally {
    if (syncIcon) syncIcon.classList.remove('animate-spin');
  }
}

// ==========================================
// 4. SCANNER & CAMERA CONTROLLER
// ==========================================
async function startScanner() {
  const modal = document.getElementById('scanner-modal');
  modal.classList.remove('hidden');
  State.isScanning = true;

  try {
    const devices = await Html5Qrcode.getCameras();
    if (!devices || devices.length === 0) {
      Swal.fire('ไม่พบกล้อง', 'กรุณาอนุญาตการเข้าถึงกล้องในเบราว์เซอร์', 'error');
      stopScanner();
      return;
    }

    let backCam = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear') || d.label.toLowerCase().includes('environment'));
    let camId = backCam ? backCam.id : devices[0].id;

    if (!State.html5QrCode) {
      State.html5QrCode = new Html5Qrcode("reader");
    }

    const config = {
      fps: 20,
      qrbox: { width: 260, height: 160 },
      aspectRatio: 1.333334,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_39
      ]
    };

    State.html5QrCode.start(camId, config, (decodedText) => {
      onScanSuccess(decodedText);
    }).catch(err => {
      console.error('Camera start error:', err);
      stopScanner();
    });
  } catch (err) {
    Swal.fire('เปิดกล้องไม่สำเร็จ', 'กรุณาอนุญาตการใช้งานกล้อง', 'error');
    stopScanner();
  }
}

function stopScanner() {
  const modal = document.getElementById('scanner-modal');
  if (modal) modal.classList.add('hidden');
  State.isScanning = false;
  
  if (State.html5QrCode) {
    State.html5QrCode.stop().catch(() => {});
  }
}

function onScanSuccess(barcode) {
  if (!barcode) return;
  barcode = String(barcode).trim();
  
  playBeep('success');
  triggerHaptic(80);
  stopScanner();
  
  handleSearch(barcode);
}

// ==========================================
// 5. SEARCH & DISPLAY INSPECTION
// ==========================================
async function handleSearch(query) {
  if (!query) return;
  query = String(query).trim().toLowerCase();

  // 1. ค้นหาในแคชของเครื่องทันที (0.01 วิ)
  let foundOrder = State.orders.find(o => 
    (o.trackingId && o.trackingId.toLowerCase() === query) ||
    (o.orderId && o.orderId.toLowerCase() === query) ||
    (o.trackingId && o.trackingId.toLowerCase().includes(query))
  );

  // 2. ถ้าไม่เจอในแคช ให้ลองดึงจาก Google Apps Script
  if (!foundOrder) {
    Swal.fire({
      title: 'กำลังค้นหาพัสดุ...',
      text: query,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const res = await fetch(`${API_URL}?action=searchTracking&query=${encodeURIComponent(query)}&_t=${Date.now()}`);
      const data = await res.json();
      Swal.close();
      if (data.success && data.found && data.order) {
        foundOrder = data.order;
      }
    } catch (e) {
      Swal.close();
    }
  }

  if (foundOrder) {
    displayInspectionForm(foundOrder);
  } else {
    playBeep('warning');
    triggerHaptic(120);

    Swal.fire({
      icon: 'warning',
      title: 'ไม่พบข้อมูลในระบบ',
      html: `
        <div class="text-left text-sm text-slate-600">
          <p>เลขพัสดุ: <b class="text-blue-600">${query}</b></p>
          <p class="mt-1">อาจยังไม่ได้นำเข้าไฟล์ Excel TikTok หรือเป็นพัสดุนอกระบบ</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'ตรวจเช็คเป็นพัสดุนอกระบบ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#2563EB'
    }).then(res => {
      if (res.isConfirmed) {
        const unknown = {
          orderId: 'OUTSIDE_' + Date.now().toString().slice(-6),
          trackingId: query,
          sellerSku: 'พัสดุนอกระบบ',
          items: [{ sku: 'พัสดุนอกระบบ', quantity: 1, checked: true }],
          carrier: 'ไม่ระบุ',
          checkStatus: 'ไม่พบในระบบ'
        };
        displayInspectionForm(unknown);
      }
    });
  }
}

function displayInspectionForm(order) {
  State.currentOrder = order;
  State.photoBase64 = null;
  State.videoBase64 = null;

  document.getElementById('scan-trigger-card').classList.add('hidden');
  const inspectBox = document.getElementById('inspection-box');
  inspectBox.classList.remove('hidden');

  // Set Info
  document.getElementById('inspect-tracking-id').innerText = order.trackingId || order.orderId;
  document.getElementById('inspect-order-id').innerText = order.orderId || '-';
  document.getElementById('inspect-carrier').innerText = order.carrier || 'TikTok Express';

  const badge = document.getElementById('inspect-status-badge');
  badge.innerText = order.checkStatus || 'ยังไม่ตรวจ';

  // Render ONLY SKU + Quantity Checklist
  renderSkuChecklist(order.items || []);

  // Reset photos/videos preview
  removePhoto();
  removeVideo();
  document.getElementById('inspect-note-input').value = '';
  document.getElementById('inspect-status-select').value = 'AUTO';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSkuChecklist(items) {
  const container = document.getElementById('items-checklist-container');
  container.innerHTML = '';

  if (!items || items.length === 0) {
    // ถ้าไม่มี items แยก ให้ดึงจาก sellerSku
    const skuText = State.currentOrder.sellerSku || 'สินค้า (1)';
    container.innerHTML = `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
        <label class="flex items-center gap-3 cursor-pointer flex-1">
          <input type="checkbox" checked class="w-5 h-5 text-blue-600 rounded border-slate-300">
          <span class="font-bold text-slate-800 text-sm">${skuText}</span>
        </label>
      </div>
    `;
    return;
  }

  items.forEach((it, idx) => {
    it.checked = true; // default checked
    const skuCard = document.createElement('div');
    skuCard.className = 'p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-2';
    skuCard.innerHTML = `
      <label class="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
        <input type="checkbox" id="chk-item-${idx}" checked onchange="toggleItemCheck(${idx}, this.checked)" class="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500">
        <div class="min-w-0">
          <div class="font-bold text-slate-800 text-sm truncate">${it.sku || 'SKU'}</div>
          ${it.variation ? `<div class="text-[11px] text-slate-400 truncate">${it.variation}</div>` : ''}
        </div>
      </label>
      <div class="text-right">
        <span class="inline-block bg-blue-100 text-blue-800 font-bold text-xs px-2.5 py-1 rounded-lg border border-blue-200">
          จำนวน: ${it.quantity || 1}
        </span>
      </div>
    `;
    container.appendChild(skuCard);
  });
}

function toggleItemCheck(idx, isChecked) {
  if (State.currentOrder && State.currentOrder.items[idx]) {
    State.currentOrder.items[idx].checked = isChecked;
    triggerHaptic(30);
  }
}

function checkAllItems(check = true) {
  if (!State.currentOrder || !State.currentOrder.items) return;
  State.currentOrder.items.forEach((it, idx) => {
    it.checked = check;
    const el = document.getElementById(`chk-item-${idx}`);
    if (el) el.checked = check;
  });
  triggerHaptic(40);
  playBeep('success');
}

// Media Capture (720p)
async function handlePhotoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const compressed = await compressImage720p(file);
    State.photoBase64 = compressed.base64;
    
    document.getElementById('photo-img').src = compressed.dataUrl;
    document.getElementById('photo-preview-box').classList.remove('hidden');
    document.getElementById('photo-box-btn').classList.add('hidden');
    
    playBeep('success');
  } catch (e) {
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถบันทึกภาพถ่ายได้', 'error');
  }
}

async function handleVideoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => {
    const dataUrl = reader.result;
    State.videoBase64 = dataUrl.split(',')[1];
    
    const player = document.getElementById('video-player');
    player.src = dataUrl;
    document.getElementById('video-preview-box').classList.remove('hidden');
    document.getElementById('video-box-btn').classList.add('hidden');
    
    playBeep('success');
  };
}

function removePhoto() {
  State.photoBase64 = null;
  document.getElementById('photo-preview-box').classList.add('hidden');
  document.getElementById('photo-box-btn').classList.remove('hidden');
  document.getElementById('photo-input').value = '';
}

function removeVideo() {
  State.videoBase64 = null;
  document.getElementById('video-preview-box').classList.add('hidden');
  document.getElementById('video-box-btn').classList.remove('hidden');
  document.getElementById('video-input').value = '';
}

function cancelInspection() {
  State.currentOrder = null;
  document.getElementById('inspection-box').classList.add('hidden');
  document.getElementById('scan-trigger-card').classList.remove('hidden');
  document.getElementById('manual-input').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// 6. SAVE INSPECTION RESULT
// ==========================================
async function saveInspectionResult() {
  if (!State.currentOrder) return;
  const order = State.currentOrder;

  const statusSelect = document.getElementById('inspect-status-select').value;
  const note = document.getElementById('inspect-note-input').value.trim();

  let finalStatus = statusSelect;
  if (statusSelect === 'AUTO') {
    const allChecked = (order.items || []).every(it => it.checked !== false);
    finalStatus = allChecked ? 'ครบถ้วน' : 'สินค้าไม่ครบ';
  }

  Swal.fire({
    title: 'กำลังบันทึกข้อมูล...',
    text: 'อัปเดต Google Sheet และอัปโหลดรูปภาพ',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const payload = {
    action: 'updateInspection',
    orderId: order.orderId,
    trackingId: order.trackingId,
    checkStatus: finalStatus,
    receivedItems: order.items,
    staffNote: note,
    checkedBy: 'พนักงานคลัง',
    photoBase64: State.photoBase64,
    videoBase64: State.videoBase64
  };

  try {
    // ส่งข้อมูลไปยัง Google Apps Script
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).catch(e => console.warn('Background sync note:', e));

    // อัปเดตข้อมูลในเครื่องทันที
    const idx = State.orders.findIndex(o => (o.trackingId && o.trackingId === order.trackingId) || (o.orderId === order.orderId));
    if (idx !== -1) {
      State.orders[idx].checkStatus = finalStatus;
      State.orders[idx].staffNote = note;
    }

    // บันทึกลงประวัติพนักงาน
    const record = {
      trackingId: order.trackingId || order.orderId,
      sellerSku: order.sellerSku || (order.items && order.items[0] ? order.items[0].sku : 'SKU'),
      status: finalStatus,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    };
    State.recentHistory.unshift(record);
    if (State.recentHistory.length > 50) State.recentHistory.pop();
    localStorage.setItem('wh_recent_history', JSON.stringify(State.recentHistory));

    playBeep('success');
    triggerHaptic(100);

    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ!',
      text: `${order.trackingId || order.orderId} : ${finalStatus}`,
      timer: 1500,
      showConfirmButton: false
    });

    cancelInspection();
    renderStaffHistory();
  } catch (err) {
    Swal.fire('บันทึกไม่สำเร็จ', err.message, 'error');
  }
}

// ==========================================
// 7. STAFF HISTORY & DASHBOARD
// ==========================================
function renderStaffHistory() {
  const listEl = document.getElementById('staff-history-list');
  const countEl = document.getElementById('staff-history-count');
  const todayEl = document.getElementById('staff-stat-today');
  const issuesEl = document.getElementById('staff-stat-issues');

  if (!listEl) return;

  const history = State.recentHistory;
  countEl.innerText = `${history.length} รายการ`;

  let todayCount = history.length;
  let issuesCount = history.filter(h => h.status !== 'ครบถ้วน').length;

  todayEl.innerText = todayCount;
  issuesEl.innerText = issuesCount;

  if (history.length === 0) {
    listEl.innerHTML = '<div class="text-xs text-slate-400 py-6 text-center">ยังไม่มีประวัติการสแกนในวันนี้</div>';
    return;
  }

  listEl.innerHTML = history.slice(0, 15).map(h => `
    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
      <div class="min-w-0">
        <div class="font-mono font-bold text-slate-800">${h.trackingId}</div>
        <div class="text-slate-500 truncate mt-0.5">${h.sellerSku}</div>
      </div>
      <div class="text-right">
        <span class="inline-block px-2 py-0.5 rounded-full font-bold text-[10px] ${h.status === 'ครบถ้วน' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
          ${h.status}
        </span>
        <div class="text-[10px] text-slate-400 mt-0.5">${h.time}</div>
      </div>
    </div>
  `).join('');
}

function switchView(viewName) {
  State.currentView = viewName;
  
  if (viewName === 'scanner') {
    document.getElementById('view-scanner').classList.remove('hidden');
    document.getElementById('view-dashboard').classList.add('hidden');
    
    document.getElementById('tab-btn-scanner').className = 'flex flex-col items-center justify-center text-blue-600 font-bold transition-all';
    document.getElementById('tab-btn-dashboard').className = 'flex flex-col items-center justify-center text-slate-400 font-medium transition-all';
  } else {
    document.getElementById('view-scanner').classList.add('hidden');
    document.getElementById('view-dashboard').classList.remove('hidden');
    
    document.getElementById('tab-btn-scanner').className = 'flex flex-col items-center justify-center text-slate-400 font-medium transition-all';
    document.getElementById('tab-btn-dashboard').className = 'flex flex-col items-center justify-center text-blue-600 font-bold transition-all';
    
    renderStaffHistory();
  }
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  // 1. โหลดข้อมูลแคชเดิมทันที
  const cached = localStorage.getItem('wh_cached_orders');
  if (cached) {
    try { State.orders = JSON.parse(cached); } catch(e) {}
  }

  // 2. ดึงข้อมูลล่าสุดจาก Google Sheets แบบเบื้องหลัง
  syncDataFromSheet(false);

  // 3. Render ประวัติ
  renderStaffHistory();
});
