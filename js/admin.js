/**
 * TikTok Return Parcel Inspection System
 * Admin Portal Engine (admin.js)
 */

const API_URL = "https://script.google.com/macros/s/AKfycbxs3LzbtEOj2036lhcXrZOtr9hkh0Dg2349rSjQ0H-hX3maVZUgrVEt3N_3FsreWFeb/exec";

const AdminState = {
  currentTab: 'dashboard', // 'dashboard' | 'import'
  orders: [],
  filteredOrders: [],
  page: 1,
  pageSize: 20,
  searchQuery: '',
  statusFilter: 'ALL',
  
  importedOrders: []
};

// ==========================================
// 1. NAVIGATION & TAB SWITCHING
// ==========================================
function switchAdminTab(tabName) {
  AdminState.currentTab = tabName;
  
  const tabDashboard = document.getElementById('admin-tab-dashboard');
  const tabImport = document.getElementById('admin-tab-import');
  
  const navDashboard = document.getElementById('nav-tab-dashboard');
  const navImport = document.getElementById('nav-tab-import');

  if (tabName === 'dashboard') {
    tabDashboard.classList.remove('hidden');
    tabImport.classList.add('hidden');
    
    navDashboard.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5 transition-all';
    navImport.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 transition-all';
    
    renderDashboard();
  } else {
    tabDashboard.classList.add('hidden');
    tabImport.classList.remove('hidden');
    
    navDashboard.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 transition-all';
    navImport.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5 transition-all';
  }
}

// ==========================================
// 2. DATA SYNC FROM GOOGLE SHEETS (HYBRID JSONP / POST)
// ==========================================
function fetchJSONP(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_admin_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
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

async function apiFetchAdminOrders() {
  // 1. Try JSONP (Zero CORS, Zero 404 redirect issues)
  try {
    const data = await fetchJSONP(`${API_URL}?action=getOrders&limit=5000`, 10000);
    if (data && data.success) return data;
  } catch(e) {
    console.warn('JSONP fetch attempt failed, trying POST fallback:', e);
  }

  // 2. Fallback to POST fetch
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getOrders', limit: 5000 })
    });
    const text = await res.text();
    return JSON.parse(text);
  } catch(e) {
    console.error('All fetch methods failed:', e);
    throw e;
  }
}

async function refreshOrdersFromSheet(showToast = false) {
  const icon = document.getElementById('admin-refresh-icon');
  if (icon) icon.classList.add('animate-spin');

  try {
    const data = await apiFetchAdminOrders();

    if (data && data.success && data.orders) {
      AdminState.orders = data.orders;
      localStorage.setItem('admin_cached_orders', JSON.stringify(data.orders));
      applyFilters();
      
      if (showToast) {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: `ดึงข้อมูลแล้ว ${data.orders.length} รายการ`,
          showConfirmButton: false,
          timer: 1500
        });
      }
    }
  } catch (err) {
    console.warn('Failed to fetch orders, using cache:', err);
    const cached = localStorage.getItem('admin_cached_orders');
    if (cached) {
      AdminState.orders = JSON.parse(cached);
      applyFilters();
    }
  } finally {
    if (icon) icon.classList.remove('animate-spin');
  }
}

// ==========================================
// 3. DASHBOARD RENDERING & FILTERS
// ==========================================
function applyFilters() {
  const q = (document.getElementById('admin-search-input')?.value || '').trim().toLowerCase();
  const st = document.getElementById('admin-status-filter')?.value || 'ALL';

  AdminState.searchQuery = q;
  AdminState.statusFilter = st;

  AdminState.filteredOrders = AdminState.orders.filter(o => {
    // Status Filter
    if (st !== 'ALL') {
      const status = String(o.checkStatus || 'ยังไม่ตรวจ');
      if (st === 'PENDING' && status !== 'ยังไม่ตรวจ' && status !== '') return false;
      if (st === 'COMPLETED' && !status.includes('ครบ')) return false;
      if (st === 'ISSUES' && (status === 'ยังไม่ตรวจ' || status.includes('ครบ'))) return false;
    }

    // Search Query
    if (q) {
      const match = (o.orderId && o.orderId.toLowerCase().includes(q)) ||
                    (o.trackingId && o.trackingId.toLowerCase().includes(q)) ||
                    (o.sellerSku && o.sellerSku.toLowerCase().includes(q)) ||
                    (o.productSummary && o.productSummary.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  AdminState.page = 1;
  renderDashboard();
}

function renderDashboard() {
  const orders = AdminState.orders;
  const filtered = AdminState.filteredOrders;

  // Stats Counters
  let total = orders.length;
  let completed = 0;
  let issues = 0;
  let pending = 0;

  orders.forEach(o => {
    const s = String(o.checkStatus || 'ยังไม่ตรวจ');
    if (s === 'ยังไม่ตรวจ' || !s) {
      pending++;
    } else if (s.includes('ครบ')) {
      completed++;
    } else {
      issues++;
    }
  });

  const percent = total > 0 ? Math.round(((completed + issues) / total) * 100) : 0;

  document.getElementById('stat-total').innerText = total.toLocaleString();
  document.getElementById('stat-completed').innerText = completed.toLocaleString();
  document.getElementById('stat-issues').innerText = issues.toLocaleString();
  document.getElementById('stat-pending').innerText = pending.toLocaleString();
  document.getElementById('stat-progress-bar').style.width = `${percent}%`;
  document.getElementById('stat-progress-text').innerText = `${percent}% (${completed + issues}/${total})`;

  // Pagination & Table
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / AdminState.pageSize));
  if (AdminState.page > totalPages) AdminState.page = 1;

  const startIdx = (AdminState.page - 1) * AdminState.pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + AdminState.pageSize);

  const tbody = document.getElementById('admin-table-body');
  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400 text-sm">ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(o => `
      <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-sm">
        <td class="py-3 px-4 font-mono font-bold text-slate-800">${o.trackingId || '-'}</td>
        <td class="py-3 px-4 font-mono text-xs text-slate-500">${o.orderId}</td>
        <td class="py-3 px-4 font-medium text-slate-700">${o.sellerSku || '-'}</td>
        <td class="py-3 px-4 text-xs text-slate-600 max-w-xs truncate" title="${o.productSummary || ''}">${o.productSummary || '-'}</td>
        <td class="py-3 px-4 text-center font-bold text-slate-800">${o.totalQuantity || 1}</td>
        <td class="py-3 px-4">
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
            !o.checkStatus || o.checkStatus === 'ยังไม่ตรวจ' ? 'bg-amber-100 text-amber-800' :
            o.checkStatus.includes('ครบ') ? 'bg-emerald-100 text-emerald-800' :
            'bg-rose-100 text-rose-800'
          }">
            ${o.checkStatus || 'ยังไม่ตรวจ'}
          </span>
        </td>
        <td class="py-3 px-4 text-center">
          <button onclick="viewDetails('${o.orderId}')" class="px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-semibold transition-colors">
            ดูรายละเอียด
          </button>
        </td>
      </tr>
    `).join('');
  }

  document.getElementById('admin-page-info').innerText = `หน้า ${AdminState.page} จาก ${totalPages} (ทั้งหมด ${totalFiltered.toLocaleString()} รายการ)`;
  document.getElementById('btn-prev').disabled = AdminState.page <= 1;
  document.getElementById('btn-next').disabled = AdminState.page >= totalPages;
}

function changePage(delta) {
  AdminState.page += delta;
  renderDashboard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setAdminFilter(status) {
  const select = document.getElementById('admin-status-filter');
  if (select) {
    select.value = status;
    applyFilters();
  }
}

function getDriveThumbnailUrl(url, size = 'w800') {
  if (!url) return '';
  const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=${size}`;
  }
  return url;
}

function getDriveViewUrl(url) {
  if (!url) return '';
  const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/file/d/${match[1]}/view?usp=sharing`;
  }
  return url;
}

// ==========================================
// 4. ORDER DETAIL MODAL
// ==========================================
function viewDetails(orderId) {
  const order = AdminState.orders.find(o => o.orderId === orderId);
  if (!order) return;

  const modal = document.getElementById('order-modal');
  modal.classList.remove('hidden');

  document.getElementById('modal-tracking-id').innerText = order.trackingId || '-';
  document.getElementById('modal-order-id').innerText = order.orderId;
  document.getElementById('modal-status').innerText = order.checkStatus || 'ยังไม่ตรวจ';
  document.getElementById('modal-carrier').innerText = order.carrier || '-';
  document.getElementById('modal-reason').innerText = order.returnReason || '-';
  document.getElementById('modal-staff').innerText = order.checkedBy ? `${order.checkedBy} (${order.checkedAt || '-'})` : '-';
  document.getElementById('modal-note').innerText = order.staffNote || '-';

  const itemsContainer = document.getElementById('modal-items-list');
  itemsContainer.innerHTML = (order.items || []).map(it => `
    <div class="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-sm flex items-center justify-between">
      <div>
        <span class="font-bold text-blue-600">[${it.sku}]</span> ${it.productName || ''}
      </div>
      <span class="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border">x${it.quantity}</span>
    </div>
  `).join('');

  const photoEl = document.getElementById('modal-photo');
  const noPhotoEl = document.getElementById('modal-no-photo');
  if (order.photoUrl) {
    const thumbUrl = getDriveThumbnailUrl(order.photoUrl, 'w1000');
    photoEl.src = thumbUrl;
    photoEl.onclick = () => window.open(getDriveViewUrl(order.photoUrl), '_blank');
    photoEl.title = "คลิกเพื่อดูรูปขนาดเต็ม";
    photoEl.classList.remove('hidden');
    photoEl.classList.add('cursor-pointer', 'hover:opacity-90', 'transition-opacity');
    noPhotoEl.classList.add('hidden');
  } else {
    photoEl.classList.add('hidden');
    noPhotoEl.classList.remove('hidden');
  }

  const videoEl = document.getElementById('modal-video');
  const noVideoEl = document.getElementById('modal-no-video');
  if (order.videoUrl) {
    videoEl.src = order.videoUrl;
    videoEl.classList.remove('hidden');
    noVideoEl.classList.add('hidden');
  } else {
    videoEl.classList.add('hidden');
    noVideoEl.classList.remove('hidden');
  }
}

function closeModal() {
  document.getElementById('order-modal').classList.add('hidden');
}

// ==========================================
// 5. EXPORT TO EXCEL
// ==========================================
function exportToExcel() {
  if (!AdminState.orders || AdminState.orders.length === 0) {
    Swal.fire('ไม่มีข้อมูล', 'ยังไม่มีรายการสำหรับส่งออก', 'info');
    return;
  }

  const rows = AdminState.orders.map(o => ({
    'Order ID': o.orderId,
    'Tracking ID': o.trackingId,
    'Seller SKU': o.sellerSku,
    'Product Summary': o.productSummary,
    'Total Quantity': o.totalQuantity,
    'Order Status': o.orderStatus,
    'Return Reason': o.returnReason,
    'Check Status': o.checkStatus,
    'Staff Note': o.staffNote,
    'Checked By': o.checkedBy,
    'Checked At': o.checkedAt,
    'Photo URL': o.photoUrl,
    'Video URL': o.videoUrl
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TikTokReturns');
  XLSX.writeFile(wb, `TikTok_Returns_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ==========================================
// 6. EXCEL MERGE & IMPORT ENGINE
// ==========================================
async function processSelectedFiles() {
  const fOrders = document.getElementById('file-all-orders').files[0];
  const fReturns = document.getElementById('file-returns').files[0];

  if (!fOrders && !fReturns) {
    Swal.fire('กรุณาเลือกไฟล์', 'กรุณาเลือกไฟล์คำสั่งซื้อ หรือไฟล์การส่งคืนอย่างน้อย 1 ไฟล์', 'warning');
    return;
  }

  Swal.fire({
    title: 'กำลังประมวลผลไฟล์ Excel...',
    text: 'กำลังรวมข้อมูลและกรอง Order ID ซ้ำ',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const readWorkbook = async (file) => {
    const data = await file.arrayBuffer();
    return XLSX.read(data, { type: 'array' });
  };

  try {
    const ordersMap = new Map();

    // 1. Parse All Orders
    if (fOrders) {
      const wb = await readWorkbook(fOrders);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (rows.length > 0) {
        const h = rows[0].map(c => String(c || '').trim());
        let startRow = 1;
        if (rows.length > 1 && String(rows[1][0] || '').includes('Platform unique order ID')) startRow = 2;

        const cOrderId = h.indexOf('Order ID');
        const cTracking = h.indexOf('Tracking ID');
        const cSku = h.indexOf('Seller SKU');
        const cProd = h.indexOf('Product Name');
        const cVar = h.indexOf('Variation');
        const cQty = h.indexOf('Quantity');
        const cStatus = h.indexOf('Order Status');
        const cCarrier = h.indexOf('Shipping Provider Name');
        const cBuyer = h.indexOf('Buyer Username');

        for (let i = startRow; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[cOrderId]) continue;
          const orderId = String(r[cOrderId]).trim();
          const trackingId = cTracking !== -1 && r[cTracking] ? String(r[cTracking]).trim() : '';
          const sku = cSku !== -1 && r[cSku] ? String(r[cSku]).trim() : '';
          const prodName = cProd !== -1 && r[cProd] ? String(r[cProd]).trim() : '';
          const varName = cVar !== -1 && r[cVar] ? String(r[cVar]).trim() : '';
          const qty = cQty !== -1 && !isNaN(parseInt(r[cQty])) ? parseInt(r[cQty]) : 1;
          const status = cStatus !== -1 && r[cStatus] ? String(r[cStatus]).trim() : '';
          const carrier = cCarrier !== -1 && r[cCarrier] ? String(r[cCarrier]).trim() : '';
          const buyer = cBuyer !== -1 && r[cBuyer] ? String(r[cBuyer]).trim() : '';

          const item = { sku, productName: prodName, variation: varName, quantity: qty, checked: true };

          if (!ordersMap.has(orderId)) {
            ordersMap.set(orderId, {
              orderId, trackingId, orderStatus: status, carrier, buyerUsername: buyer,
              returnReason: '', returnStatus: '', items: [item], checkStatus: 'ยังไม่ตรวจ'
            });
          } else {
            const rec = ordersMap.get(orderId);
            if (trackingId && !rec.trackingId) rec.trackingId = trackingId;
            rec.items.push(item);
          }
        }
      }
    }

    // 2. Parse Returns File
    if (fReturns) {
      const wb = await readWorkbook(fReturns);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (rows.length > 0) {
        const h = rows[0].map(c => String(c || '').trim());
        const cOrderId = h.indexOf('Order ID');
        const cTracking = h.indexOf('Return Logistics Tracking ID');
        const cSku = h.indexOf('Seller SKU');
        const cProd = h.indexOf('Product Name');
        const cQty = h.indexOf('Return Quantity');
        const cReason = h.indexOf('Return Reason');
        const cStatus = h.indexOf('Return Status');

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[cOrderId]) continue;
          const orderId = String(r[cOrderId]).trim();
          const retTracking = cTracking !== -1 && r[cTracking] ? String(r[cTracking]).trim() : '';
          const sku = cSku !== -1 && r[cSku] ? String(r[cSku]).trim() : '';
          const prodName = cProd !== -1 && r[cProd] ? String(r[cProd]).trim() : '';
          const qty = cQty !== -1 && !isNaN(parseInt(r[cQty])) ? parseInt(r[cQty]) : 1;
          const reason = cReason !== -1 && r[cReason] ? String(r[cReason]).trim() : '';
          const status = cStatus !== -1 && r[cStatus] ? String(r[cStatus]).trim() : '';

          const item = { sku, productName: prodName, variation: '', quantity: qty, checked: true };

          if (ordersMap.has(orderId)) {
            const rec = ordersMap.get(orderId);
            if (retTracking && !rec.trackingId) rec.trackingId = retTracking;
            if (reason) rec.returnReason = reason;
            if (status) rec.returnStatus = status;
            if (sku && !rec.items.some(it => it.sku === sku)) rec.items.push(item);
          } else {
            ordersMap.set(orderId, {
              orderId, trackingId: retTracking, orderStatus: '', carrier: '', buyerUsername: '',
              returnReason: reason, returnStatus: status, items: [item], checkStatus: 'ยังไม่ตรวจ'
            });
          }
        }
      }
    }

    // Format Aggregated List & Deduplicate Against Existing Database
    const existingOrderIds = new Set(AdminState.orders.map(o => String(o.orderId || '').trim()));
    const newOrders = [];
    let duplicateCount = 0;

    ordersMap.forEach((data, orderId) => {
      const skusSummary = data.items.map(it => `${it.sku || 'N/A'} (x${it.quantity})`).join(', ');
      const productSummary = data.items.map(it => `${it.productName || 'สินค้า'} x ${it.quantity}`).join(' | ');
      const totalQty = data.items.reduce((s, it) => s + it.quantity, 0);

      const record = {
        orderId,
        trackingId: data.trackingId || '',
        sellerSku: skusSummary,
        productSummary,
        items: data.items,
        totalQuantity: totalQty,
        orderStatus: data.orderStatus,
        returnReason: data.returnReason,
        returnStatus: data.returnStatus,
        carrier: data.carrier,
        buyerUsername: data.buyerUsername,
        checkStatus: data.checkStatus,
        staffNote: '', checkedBy: '', checkedAt: '', photoUrl: '', videoUrl: ''
      };

      if (existingOrderIds.has(String(orderId).trim())) {
        duplicateCount++;
      } else {
        newOrders.push(record);
      }
    });

    AdminState.importedOrders = newOrders;
    Swal.close();

    if (newOrders.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'ไม่มีข้อมูลใหม่',
        text: `คำสั่งซื้อทั้งหมด ${ordersMap.size} รายการ มีอยู่ในระบบแล้ว (ระบบข้ามข้อมูลซ้ำทั้งหมด)`
      });
      return;
    }

    // Render Preview
    document.getElementById('import-preview-section').classList.remove('hidden');
    document.getElementById('import-preview-count').innerHTML = `
      <span class="text-emerald-600 font-bold">${newOrders.length.toLocaleString()} รายการใหม่</span>
      ${duplicateCount > 0 ? `<span class="text-slate-400 font-normal text-xs ml-2">(มีอยู่แล้วในระบบ ${duplicateCount} รายการ - จะถูกข้าม)</span>` : ''}
    `;

    document.getElementById('import-preview-tbody').innerHTML = newOrders.slice(0, 10).map(o => `
      <tr class="border-b border-slate-100 text-xs">
        <td class="py-2 px-3 font-mono font-bold text-slate-800">${o.trackingId || '-'}</td>
        <td class="py-2 px-3 font-mono">${o.orderId}</td>
        <td class="py-2 px-3 font-medium">${o.sellerSku || '-'}</td>
        <td class="py-2 px-3 truncate max-w-xs">${o.productSummary || '-'}</td>
        <td class="py-2 px-3 text-center font-bold">${o.totalQuantity}</td>
      </tr>
    `).join('');

  } catch (err) {
    Swal.fire('ข้อผิดพลาด', err.message, 'error');
  }
}

async function uploadToGoogleSheets() {
  if (!AdminState.importedOrders || AdminState.importedOrders.length === 0) return;
  const orders = AdminState.importedOrders;

  Swal.fire({
    title: 'กำลังส่งข้อมูลเข้า Google Sheets...',
    text: `กำลังบันทึก ${orders.length} ออเดอร์`,
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const chunkSize = 250;
  const totalChunks = Math.ceil(orders.length / chunkSize);
  let totalInserted = 0;
  let totalUpdated = 0;

  try {
    for (let i = 0; i < totalChunks; i++) {
      const chunk = orders.slice(i * chunkSize, (i + 1) * chunkSize);
      
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'bulkUpsertOrders',
          orders: chunk
        })
      });

      const text = await res.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch(e) {
        throw new Error('Google Apps Script ตอบกลับผิดพลาด: ' + text.slice(0, 100));
      }

      if (!result.success) throw new Error(result.error || 'การส่งข้อมูลขัดข้อง');
      totalInserted += (result.insertedCount || 0);
      totalUpdated += (result.updatedCount || 0);
    }

    AdminState.orders = orders;
    localStorage.setItem('admin_cached_orders', JSON.stringify(orders));

    Swal.fire({
      icon: 'success',
      title: 'นำเข้าข้อมูลสำเร็จ!',
      text: `เพิ่มใหม่ ${totalInserted} รายการ, อัปเดต ${totalUpdated} รายการ`,
      confirmButtonText: 'ไปที่แดชบอร์ด',
      confirmButtonColor: '#2563EB'
    }).then(() => {
      switchAdminTab('dashboard');
    });

  } catch (err) {
    Swal.fire('นำเข้าไม่สำเร็จ', err.message, 'error');
  }
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('admin-search-input');
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(applyFilters, 300);
    });
  }

  const cached = localStorage.getItem('admin_cached_orders');
  if (cached) {
    try {
      AdminState.orders = JSON.parse(cached);
      applyFilters();
    } catch(e) {}
  }

  refreshOrdersFromSheet(false);
});
