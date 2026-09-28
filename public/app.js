// Application State
let visitorId = 'anonymous_device';
let pendingTransactionId = null;
let otpInterval = null;
let activePollInterval = null;

// Initialize FingerprintJS & Lucide Icons
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  calculatePreviewFee();

  try {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    visitorId = result.visitorId;
    console.log('Visitor Fingerprint:', visitorId);
  } catch (e) {
    console.warn('FingerprintJS load error:', e);
  }

  checkBotStatus();
});

// Calculate live Escrow fee
function calculatePreviewFee() {
  const amountInput = parseFloat(document.getElementById('amount')?.value) || 0;
  const feePayer = document.getElementById('feePayer')?.value || 'BUYER';

  const rawFee = (amountInput * 1.5) / 100;
  const feeAmount = Math.max(rawFee, 5000);

  let totalBuyerPay = amountInput;
  if (feePayer === 'BUYER') {
    totalBuyerPay = amountInput + feeAmount;
  } else if (feePayer === 'SPLIT_50_50') {
    totalBuyerPay = amountInput + (feeAmount / 2);
  }

  document.getElementById('preview-amount').innerText = `Rp ${amountInput.toLocaleString('id-ID')}`;
  document.getElementById('preview-fee').innerText = `Rp ${feeAmount.toLocaleString('id-ID')}`;
  document.getElementById('preview-payer').innerText = 
    feePayer === 'BUYER' ? 'Pembeli' : feePayer === 'SELLER' ? 'Penjual' : 'Dibagi 50:50';
  document.getElementById('preview-total').innerText = `Rp ${totalBuyerPay.toLocaleString('id-ID')}`;
}

function updateRoleLabels() {
  const role = document.querySelector('input[name="initiatorRole"]:checked')?.value;
  const initLabel = document.getElementById('label-initiator-phone');
  const partLabel = document.getElementById('label-partner-phone');

  if (role === 'BUYER') {
    initLabel.innerText = 'No. WhatsApp Anda (Pembeli)';
    partLabel.innerText = 'No. WhatsApp Penjual';
  } else {
    initLabel.innerText = 'No. WhatsApp Anda (Penjual)';
    partLabel.innerText = 'No. WhatsApp Pembeli';
  }
}

// Handle Form Submission -> Request Transaction & OTP
async function handleInitiateSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.classList.add('opacity-50');

  const initiatorRole = document.querySelector('input[name="initiatorRole"]:checked')?.value;
  const initiatorPhone = document.getElementById('initiatorPhone').value.trim();
  const partnerPhone = document.getElementById('partnerPhone').value.trim();
  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();
  const amount = parseFloat(document.getElementById('amount').value);
  const feePayer = document.getElementById('feePayer').value;

  const sellerBankCode = document.getElementById('sellerBankCode').value.trim();
  const sellerAccountNumber = document.getElementById('sellerAccountNumber').value.trim();
  const sellerAccountName = document.getElementById('sellerAccountName').value.trim();

  try {
    const res = await fetch('/api/transactions/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Visitor-Id': visitorId,
      },
      body: JSON.stringify({
        initiatorRole,
        initiatorPhone,
        partnerPhone,
        title,
        description,
        amount,
        feePayer,
        sellerBankCode,
        sellerAccountNumber,
        sellerAccountName,
        visitorId,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(`Error: ${data.message || 'Gagal membuat transaksi'}`);
      return;
    }

    pendingTransactionId = data.data.transactionId;
    openOtpModal(data.data.initiatorPhone);
  } catch (error) {
    alert('Terjadi kesalahan koneksi server.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('opacity-50');
  }
}

// OTP Modal & Timer
function openOtpModal(phone) {
  document.getElementById('otp-target-phone').innerText = phone;
  document.getElementById('otp-input').value = '';
  document.getElementById('otp-modal').classList.remove('hidden');
  document.getElementById('otp-modal').classList.add('flex');
  lucide.createIcons();

  startOtpTimer(180);
}

function closeOtpModal() {
  document.getElementById('otp-modal').classList.add('hidden');
  document.getElementById('otp-modal').classList.remove('flex');
  clearInterval(otpInterval);
}

function startOtpTimer(duration) {
  clearInterval(otpInterval);
  let timer = duration;
  const timerDisplay = document.getElementById('otp-timer');

  otpInterval = setInterval(() => {
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    if (--timer < 0) {
      clearInterval(otpInterval);
      timerDisplay.textContent = 'EXPIRED';
    }
  }, 1000);
}

// Verify OTP
async function submitVerifyOtp() {
  const otp = document.getElementById('otp-input').value.trim();
  const btn = document.getElementById('btn-verify-otp');

  if (otp.length !== 6) {
    alert('Masukkan 6-digit kode OTP.');
    return;
  }

  btn.disabled = true;
  btn.innerText = 'Memverifikasi...';

  try {
    const res = await fetch('/api/transactions/verify-and-start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Visitor-Id': visitorId,
      },
      body: JSON.stringify({
        transactionId: pendingTransactionId,
        otp,
        visitorId,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.message || 'Verifikasi OTP gagal.');
      btn.disabled = false;
      btn.innerText = 'Verifikasi & Buat Grup Escrow';
      return;
    }

    closeOtpModal();
    // Load and track transaction
    loadTransactionView(data.data.shortCode);
  } catch (error) {
    alert('Terjadi kesalahan jaringan saat verifikasi.');
    btn.disabled = false;
    btn.innerText = 'Verifikasi & Buat Grup Escrow';
  }
}

// Lookup Transaction
function lookupTransaction() {
  const code = document.getElementById('lookup-code').value.trim();
  if (!code) {
    alert('Masukkan kode transaksi.');
    return;
  }
  loadTransactionView(code);
}

// Load and render transaction real-time details
async function loadTransactionView(identifier) {
  clearInterval(activePollInterval);

  const fetchAndRender = async () => {
    try {
      const res = await fetch(`/api/transactions/${identifier}`);
      const data = await res.json();

      if (!res.ok || !data.data) {
        alert('Transaksi tidak ditemukan.');
        return;
      }

      renderTransactionDashboard(data.data);
    } catch (e) {
      console.error('Failed to poll transaction:', e);
    }
  };

  await fetchAndRender();
  // Poll every 4 seconds for real-time updates
  activePollInterval = setInterval(fetchAndRender, 4000);
}

function renderTransactionDashboard(trx) {
  const container = document.getElementById('transaction-detail-section');
  container.classList.remove('hidden');

  const steps = [
    { key: 'PENDING_VERIFICATION', label: 'Verifikasi' },
    { key: 'GROUP_CREATED', label: 'Grup WA Dibuat' },
    { key: 'WAITING_PAYMENT', label: 'Menunggu Bayar' },
    { key: 'PAID_HELD', label: 'Dana Diamankan' },
    { key: 'IN_DELIVERY', label: 'Pengiriman' },
    { key: 'COMPLETED', label: 'Selesai' },
  ];

  const statusMap = {
    PENDING_VERIFICATION: { label: 'Menunggu Verifikasi OTP', color: 'text-amber-400 bg-amber-950/60 border-amber-800' },
    GROUP_CREATED: { label: 'Grup WhatsApp Terbentuk', color: 'text-cyan-400 bg-cyan-950/60 border-cyan-800' },
    WAITING_PAYMENT: { label: 'Menunggu Pembayaran', color: 'text-amber-400 bg-amber-950/60 border-amber-800' },
    PAID_HELD: { label: 'Dana Terkunci di Rekber', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-800' },
    IN_DELIVERY: { label: 'Barang Sedang Diserahkan', color: 'text-indigo-400 bg-indigo-950/60 border-indigo-800' },
    COMPLETED: { label: 'Transaksi Selesai', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-800' },
    DISPUTED: { label: 'Dalam Sengketa (Dispute)', color: 'text-rose-400 bg-rose-950/60 border-rose-800' },
    REFUNDED: { label: 'Dana Dikembalikan (Refund)', color: 'text-purple-400 bg-purple-950/60 border-purple-800' },
  };

  const currentStatusInfo = statusMap[trx.status] || { label: trx.status, color: 'text-slate-300' };

  container.innerHTML = `
    <div class="glass-card rounded-2xl p-6 sm:p-8 border-brand-500/30 shadow-2xl">
      <!-- Top Bar -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Tracking Escrow</span>
            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold border ${currentStatusInfo.color}">${currentStatusInfo.label}</span>
          </div>
          <h2 class="text-2xl font-extrabold text-slate-100 flex items-center gap-2">
            <span>${trx.title}</span>
            <span class="text-xs font-mono px-2 py-1 bg-slate-900 rounded border border-slate-700 text-brand-400">${trx.shortCode}</span>
          </h2>
        </div>

        <div class="text-right">
          <div class="text-xs text-slate-400">Total Nominal</div>
          <div class="text-2xl font-extrabold text-emerald-400">Rp ${Number(trx.totalAmount).toLocaleString('id-ID')}</div>
        </div>
      </div>

      <!-- State Progress Bar -->
      <div class="py-6 border-b border-slate-800">
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center text-xs">
          ${steps.map((s, idx) => {
            const isPassed = getStepOrder(trx.status) >= idx;
            const isCurrent = trx.status === s.key;
            return `
              <div class="p-2 rounded-xl border ${isCurrent ? 'bg-brand-500/20 border-brand-500 text-brand-400 font-bold' : isPassed ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-950/50 border-slate-800 text-slate-600'}">
                <div class="text-xs">${idx + 1}. ${s.label}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Action & Info Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-6">
        <!-- Col 1: WA Group Access -->
        <div class="p-5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
          <h4 class="text-xs font-bold uppercase text-slate-400 flex items-center gap-2">
            <i data-lucide="message-square" class="w-4 h-4 text-emerald-400"></i>
            WhatsApp Group Rekber
          </h4>
          <p class="text-xs text-slate-300">Grup dibuat otomatis dengan bot sebagai admin tunggal.</p>
          
          ${trx.waGroupInviteLink ? `
            <a href="${trx.waGroupInviteLink}" target="_blank" class="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition">
              <i data-lucide="external-link" class="w-4 h-4"></i>
              <span>Buka Grup WhatsApp</span>
            </a>
          ` : `
            <div class="text-xs text-amber-400 font-mono py-2">⏳ Bot sedang mempersiapkan grup...</div>
          `}

          <div class="text-xs text-slate-400 pt-2 space-y-1">
            <div>Pembeli: <span class="text-slate-200 font-mono">${trx.buyerPhone}</span> ${trx.buyerJoined ? '✅' : '⏳'}</div>
            <div>Penjual: <span class="text-slate-200 font-mono">${trx.sellerPhone}</span> ${trx.sellerJoined ? '✅' : '⏳'}</div>
          </div>
        </div>

        <!-- Col 2: Payment Gateway & Mock Trigger -->
        <div class="p-5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
          <h4 class="text-xs font-bold uppercase text-slate-400 flex items-center gap-2">
            <i data-lucide="credit-card" class="w-4 h-4 text-cyan-400"></i>
            Informasi Pembayaran
          </h4>
          
          <div class="text-xs space-y-1 text-slate-300">
            <div>Status: <span class="font-bold text-slate-100">${trx.paymentStatus || 'BELUM TERBIT'}</span></div>
            ${trx.paymentVaNumber ? `<div>No VA: <span class="font-mono text-cyan-400">${trx.paymentVaNumber}</span></div>` : ''}
          </div>

          ${trx.paymentQrString ? `
            <div class="p-3 bg-white rounded-lg text-slate-950 text-center font-mono text-[10px] break-all">
              [QRIS STRING: ${trx.paymentQrString.substring(0, 40)}...]
            </div>
          ` : ''}

          <!-- Live Mock Simulation Button for Testing -->
          ${trx.status === 'WAITING_PAYMENT' || trx.status === 'GROUP_CREATED' ? `
            <button onclick="simulatePayment('${trx.paymentId || 'INV-' + trx.shortCode}', ${trx.totalAmount})" class="w-full py-2.5 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition shadow-md">
              <i data-lucide="check-circle" class="w-4 h-4"></i>
              <span>Simulasi Bayar Lunas (Mock Webhook)</span>
            </button>
          ` : ''}
        </div>

        <!-- Col 3: Dispute & Commands -->
        <div class="p-5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
          <h4 class="text-xs font-bold uppercase text-slate-400 flex items-center gap-2">
            <i data-lucide="shield-alert" class="w-4 h-4 text-rose-400"></i>
            Perintah Bot & Bantuan
          </h4>
          <div class="text-xs text-slate-300 space-y-1">
            <div>Ketik <code class="bg-slate-950 text-amber-300 px-1 py-0.5 rounded">/kirim</code> di grup setelah serah barang.</div>
            <div>Ketik <code class="bg-slate-950 text-emerald-300 px-1 py-0.5 rounded">/selesai</code> untuk konfirmasi cair dana.</div>
            <div>Ketik <code class="bg-slate-950 text-rose-300 px-1 py-0.5 rounded">/dispute</code> jika ada kendala.</div>
          </div>

          <button onclick="raiseDisputePrompt('${trx.id}')" class="w-full py-2 px-3 rounded-lg border border-rose-800/80 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-medium flex items-center justify-center gap-2 transition">
            <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>
            <span>Laporkan Sengketa (Dispute)</span>
          </button>
        </div>
      </div>
    </div>
  `;

  lucide.createIcons();
}

function getStepOrder(status) {
  const map = {
    PENDING_VERIFICATION: 0,
    GROUP_CREATED: 1,
    WAITING_PAYMENT: 2,
    PAID_HELD: 3,
    IN_DELIVERY: 4,
    COMPLETED: 5,
    DISPUTED: 4,
    REFUNDED: 5,
  };
  return map[status] ?? 0;
}

// Simulate Payment via Mock Webhook
async function simulatePayment(paymentId, amount) {
  if (!confirm('Simulasikan pembayaran lunas (settlement) melalui webhook?')) return;

  try {
    const res = await fetch('/api/webhooks/mock-simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentId,
        status: 'settlement',
        grossAmount: String(amount),
      }),
    });

    const data = await res.json();
    alert(data.message || 'Simulasi webhook diproses.');
  } catch (e) {
    alert('Gagal memproses simulasi webhook.');
  }
}

// Dispute Prompt
async function raiseDisputePrompt(trxId) {
  const reason = prompt('Masukkan alasan pengajuan dispute:');
  const phone = prompt('Masukkan nomor WhatsApp Anda:');

  if (!reason || !phone) return;

  try {
    const res = await fetch('/api/disputes/raise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionId: trxId,
        initiatorPhone: phone,
        reason,
      }),
    });

    const data = await res.json();
    alert(data.message || 'Sengketa telah diajukan.');
  } catch (e) {
    alert('Gagal mengajukan sengketa.');
  }
}

// Bot Status Modal Check
async function openBotModal() {
  const modal = document.getElementById('bot-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  await checkBotStatus();
}

function closeBotModal() {
  document.getElementById('bot-modal').classList.add('hidden');
  document.getElementById('bot-modal').classList.remove('flex');
}

async function checkBotStatus() {
  try {
    const res = await fetch('/api/transactions/bot/status');
    const data = await res.json();

    const dot = document.getElementById('bot-status-dot');
    const text = document.getElementById('bot-status-text');
    const content = document.getElementById('bot-modal-content');

    if (data.data.isReady) {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      text.innerText = 'Bot Online';
      if (content) {
        content.innerHTML = `
          <div class="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
            <i data-lucide="check-circle-2" class="w-6 h-6"></i>
          </div>
          <div class="text-sm font-bold text-slate-100">WhatsApp Gateway Terhubung</div>
          <p class="text-xs text-slate-400">Bot Baileys multi-device aktif dan siap menerima transaksi otomatis.</p>
        `;
      }
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
      text.innerText = data.data.hasQr ? 'Scan QR' : 'Bot Standby';

      if (content) {
        if (data.data.qrCode) {
          content.innerHTML = `
            <div class="text-xs text-slate-300 font-semibold mb-2">Scan QR Code ini dengan WhatsApp:</div>
            <div class="bg-white p-4 rounded-xl inline-block">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.data.qrCode)}" alt="QR Code" class="w-48 h-48 mx-auto" />
            </div>
            <p class="text-[11px] text-slate-400">Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat</p>
          `;
        } else {
          content.innerHTML = `
            <div class="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
              <i data-lucide="loader" class="w-6 h-6 animate-spin"></i>
            </div>
            <div class="text-sm font-bold text-slate-100">Menghubungkan ke WhatsApp...</div>
            <p class="text-xs text-slate-400">Jika server baru dijalankan, QR Code akan muncul di terminal atau di sini.</p>
          `;
        }
      }
    }
    lucide.createIcons();
  } catch (e) {
    console.warn('Bot status check error:', e);
  }
}
