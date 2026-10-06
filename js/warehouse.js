/**
 * TikTok Return Parcel Inspection System
 * Warehouse Mobile Engine (warehouse.js) - Ultra Fast & Hybrid JSONP/POST Sync
 */

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
        const maxDim = 720;
        
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
// 3. HYBRID JSONP / POST FETCHER (No 404 / No CORS)
// ==========================================
function fetchJSONP(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_wh_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    let timer = null;

    window[callbackName] = function(data) {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
    }

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP Timeout'));
    }, timeout);

    script.onerror = function() {
      cleanup();
      reject(new Error('JSONP Script Error'));
    };

    const separator = url.includes('?') ? '&' : '?';
    script.src = `${url}${separator}callback=${callbackName}&_t=${Date.now()}`;
    document.head.appendChild(script);
  });
}

async function apiFetchOrders() {
  // 1. Try JSONP (Zero CORS, Zero 404 redirect issues) with warehouse compact mode
  try {
    const data = await fetchJSONP(`${API_URL}?action=getOrders&mode=warehouse&limit=5000`, 5000);
    if (data && data.success) return data;
  } catch(e) {
    console.warn('JSONP fetch attempt failed, trying POST fallback:', e);
  }

  // 2. Fallback to POST fetch
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getOrders', mode: 'warehouse', limit: 5000 }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    return JSON.parse(text);
  } catch(e) {
    console.error('All fetch methods failed or timed out:', e);
    throw e;
  }
}

// ==========================================
// 4. AUTO-SYNC DATA FROM GOOGLE SHEETS
// ==========================================
async function syncDataFromSheet(showToast = false) {
  const syncStatusEl = document.getElementById('header-sync-status');
  const syncIcon = document.getElementById('sync-icon');
  
  if (syncIcon) syncIcon.classList.add('animate-spin');
  if (syncStatusEl && State.orders.length === 0) {
    syncStatusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> กำลังดึงข้อมูลล่าสุด...';
  }
  
  try {
    const data = await apiFetchOrders();
    
    if (data && data.success && data.orders) {
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
        syncStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> พร้อมสแกน (${State.orders.length} รายการ)`;
      }
    } else {
      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> ใช้งานโหมดออฟไลน์`;
      }
    }
  } finally {
    if (syncIcon) syncIcon.classList.remove('animate-spin');
  }
}

// ==========================================
// 5. ULTRA-FAST HARDWARE SCANNER ENGINE (60 FPS & TORCH)
// ==========================================
let nativeDetector = null;
let scanStream = null;
let scanAnimationId = null;
let isTorchActive = false;

async function startScanner() {
  const modal = document.getElementById('scanner-modal');
  modal.classList.remove('hidden');
  State.isScanning = true;

  const videoEl = document.getElementById('scanner-video');
  const readerEl = document.getElementById('reader');

  // 1. Check if Native BarcodeDetector is available (Android Chrome & modern Safari)
  const hasNativeBarcode = ('BarcodeDetector' in window);

  if (hasNativeBarcode) {
    try {
      if (!nativeDetector) {
        nativeDetector = new BarcodeDetector({
          formats: [
            'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'qr_code', 'upc_a', 'upc_e'
          ]
        });
      }

      if (videoEl) videoEl.classList.remove('hidden');
      if (readerEl) readerEl.classList.add('hidden');

      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          focusMode: "continuous"
        },
        audio: false
      };

      scanStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoEl) {
        videoEl.srcObject = scanStream;
        await videoEl.play();
        startNativeDetectionLoop(videoEl);
        return;
      }
    } catch (err) {
      console.warn('Native stream start failed, falling back to Html5Qrcode:', err);
    }
  }

  // 2. Fallback: Html5Qrcode with Optimized Settings
  if (videoEl) videoEl.classList.add('hidden');
  if (readerEl) readerEl.classList.remove('hidden');

  try {
    if (!State.html5QrCode) {
      State.html5QrCode = new Html5Qrcode("reader", {
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false
      });
    }

    const config = {
      fps: 30,
      qrbox: (w, h) => ({ width: Math.floor(w * 0.95), height: Math.floor(Math.max(160, h * 0.55)) }),
      aspectRatio: 1.333334,
      videoConstraints: {
        facingMode: "environment",
        focusMode: "continuous",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.QR_CODE
      ]
    };

    State.html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
      onScanSuccess(decodedText);
    });
  } catch (err) {
    Swal.fire('เปิดกล้องไม่สำเร็จ', 'กรุณาอนุญาตการใช้งานกล้องในเบราว์เซอร์', 'error');
    stopScanner();
  }
}

function startNativeDetectionLoop(videoEl) {
  let isProcessing = false;

  async function detectFrame() {
    if (!State.isScanning) return;

    if (videoEl && videoEl.readyState >= 2 && !isProcessing) {
      isProcessing = true;
      try {
        const barcodes = await nativeDetector.detect(videoEl);
        if (barcodes && barcodes.length > 0) {
          for (let b of barcodes) {
            let val = String(b.rawValue || '').trim();
            if (val) {
              onScanSuccess(val);
              return;
            }
          }
        }
      } catch (err) {
        // Frame detect error ignored
      } finally {
        isProcessing = false;
      }
    }

    if (State.isScanning) {
      scanAnimationId = requestAnimationFrame(detectFrame);
    }
  }

  scanAnimationId = requestAnimationFrame(detectFrame);
}

async function toggleTorch() {
  if (!scanStream) return;
  const track = scanStream.getVideoTracks()[0];
  if (!track) return;

  try {
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.torch) {
      isTorchActive = !isTorchActive;
      await track.applyConstraints({
        advanced: [{ torch: isTorchActive }]
      });
      const btn = document.getElementById('torch-btn');
      if (btn) {
        btn.className = isTorchActive 
          ? 'p-2.5 bg-amber-500 text-white rounded-full shadow-lg shadow-amber-500/50 transition-all ring-2 ring-white'
          : 'p-2.5 bg-white/20 hover:bg-white/30 text-white rounded-full transition-all';
      }
      triggerHaptic(30);
    } else {
      Swal.fire({ toast: true, position: 'top', icon: 'info', title: 'อุปกรณ์นี้ไม่รองรับการเปิดไฟฉายผ่านเว็บ', timer: 2000, showConfirmButton: false });
    }
  } catch (e) {
    console.warn('Torch error:', e);
  }
}

function stopScanner() {
  const modal = document.getElementById('scanner-modal');
  if (modal) modal.classList.add('hidden');
  State.isScanning = false;

  if (scanAnimationId) {
    cancelAnimationFrame(scanAnimationId);
    scanAnimationId = null;
  }

  if (scanStream) {
    scanStream.getTracks().forEach(track => track.stop());
    scanStream = null;
  }

  const videoEl = document.getElementById('scanner-video');
  if (videoEl) videoEl.srcObject = null;

  isTorchActive = false;
  const btn = document.getElementById('torch-btn');
  if (btn) btn.className = 'p-2.5 bg-white/20 hover:bg-white/30 text-white rounded-full transition-all';

  if (State.html5QrCode) {
    State.html5QrCode.stop().catch(() => {});
  }
}

function onScanSuccess(barcode) {
  if (!barcode) return;
  barcode = String(barcode).trim();
  
  stopScanner();
  handleSearch(barcode);
}

// ==========================================
// 6. SEARCH & DISPLAY INSPECTION
// ==========================================
async function handleSearch(query) {
  if (!query) return;
  query = String(query).trim().toLowerCase();

  // 1. ค้นหาในแคชของเครื่องทันที (0.001 วิ)
  let foundOrder = State.orders.find(o => {
    const tId = String(o.trackingId || '').toLowerCase().trim();
    const oId = String(o.orderId || '').toLowerCase().trim();
    return (tId && (tId === query || query.includes(tId) || tId.includes(query))) ||
           (oId && (oId === query || query.includes(oId)));
  });

  // 2. ถ้าไม่เจอในแคช ให้ลองค้นหาจากระบบรวดเร็ว (4s timeout)
  if (!foundOrder) {
    Swal.fire({
      title: 'กำลังค้นหาพัสดุ...',
      text: query,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      const data = await fetchJSONP(`${API_URL}?action=searchTracking&query=${encodeURIComponent(query)}`, 4000);
      Swal.close();
      if (data && data.success && data.found && data.order) {
        foundOrder = data.order;
      }
    } catch (e) {
      Swal.close();
    }
  }

  // 3. เมื่อเจอในระบบ ให้เปิดหน้าตรวจเช็ค
  if (foundOrder) {
    playBeep('success');
    triggerHaptic(80);
    displayInspectionForm(foundOrder);
  } else {
    // 4. หากไม่มี barcode ในระบบ -> ไม่ต้องทำอะไรต่อ อยู่หน้าเดิม แจ้งเตือนสั้นๆ
    playBeep('warning');
    triggerHaptic(200);

    Swal.fire({
      toast: true,
      position: 'top',
      icon: 'error',
      title: `❌ ไม่พบเลขพัสดุ: ${query}`,
      text: 'ไม่มีในระบบ กรุณาตรวจสอบอีกครั้ง',
      showConfirmButton: false,
      timer: 3000
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

  document.getElementById('inspect-tracking-id').innerText = order.trackingId || order.orderId;
  document.getElementById('inspect-order-id').innerText = order.orderId || '-';
  document.getElementById('inspect-carrier').innerText = order.carrier || 'TikTok Express';

  const badge = document.getElementById('inspect-status-badge');
  badge.innerText = order.checkStatus || 'ยังไม่ตรวจ';

  renderSkuChecklist(order.items || []);

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
    const skuText = State.currentOrder.sellerSku || 'สินค้า (1)';
    container.innerHTML = `
      <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
        <label class="flex items-center gap-3.5 cursor-pointer flex-1">
          <input type="checkbox" checked class="w-6 h-6 text-blue-600 rounded-lg border-slate-300">
          <span class="font-black text-slate-900 text-base break-words">${skuText}</span>
        </label>
        <span class="bg-blue-100 text-blue-900 font-black text-sm px-3 py-1.5 rounded-xl border border-blue-200 shadow-sm flex-shrink-0">
          จำนวน: ${State.currentOrder.totalQuantity || 1}
        </span>
      </div>
    `;
    return;
  }

  items.forEach((it, idx) => {
    it.checked = true;
    const skuCard = document.createElement('div');
    skuCard.className = 'p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3';
    skuCard.innerHTML = `
      <label class="flex items-center gap-3.5 cursor-pointer flex-1 min-w-0">
        <input type="checkbox" id="chk-item-${idx}" checked onchange="toggleItemCheck(${idx}, this.checked)" class="w-6 h-6 text-blue-600 rounded-lg border-slate-300 focus:ring-blue-500 flex-shrink-0">
        <div class="min-w-0">
          <div class="font-black text-slate-900 text-base break-words">${it.sku || 'SKU'}</div>
          ${it.variation ? `<div class="text-xs font-semibold text-slate-500 mt-0.5">${it.variation}</div>` : ''}
        </div>
      </label>
      <div class="text-right flex-shrink-0">
        <span class="inline-block bg-blue-100 text-blue-900 font-black text-sm px-3.5 py-1.5 rounded-xl border border-blue-200 shadow-sm">
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

// Media Handlers
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
// 7. SAVE INSPECTION RESULT
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
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).catch(e => console.warn('Background sync note:', e));

    const idx = State.orders.findIndex(o => (o.trackingId && o.trackingId === order.trackingId) || (o.orderId === order.orderId));
    if (idx !== -1) {
      State.orders[idx].checkStatus = finalStatus;
      State.orders[idx].staffNote = note;
    }

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
// 8. STAFF HISTORY & DASHBOARD
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
    <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3 text-sm">
      <div class="min-w-0">
        <div class="font-mono font-bold text-slate-900 text-sm break-all">${h.trackingId}</div>
        <div class="text-slate-600 font-medium text-xs truncate mt-0.5">${h.sellerSku}</div>
      </div>
      <div class="text-right flex-shrink-0">
        <span class="inline-block px-2.5 py-1 rounded-lg font-bold text-xs ${h.status === 'ครบถ้วน' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-200'}">
          ${h.status}
        </span>
        <div class="text-xs text-slate-400 font-medium mt-0.5">${h.time}</div>
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

// Initial Load (Instant 0.001s Ready)
document.addEventListener('DOMContentLoaded', () => {
  const syncStatusEl = document.getElementById('header-sync-status');
  const cached = localStorage.getItem('wh_cached_orders');
  if (cached) {
    try {
      State.orders = JSON.parse(cached);
      if (syncStatusEl && State.orders.length > 0) {
        syncStatusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> พร้อมสแกน (${State.orders.length} รายการ)`;
      }
    } catch(e) {}
  }

  syncDataFromSheet(false);
  renderStaffHistory();
});
