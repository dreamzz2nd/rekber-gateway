# Automated WhatsApp Escrow (Rekber) Platform

Platform Rekening Bersama (Escrow Vault) otomatis berbasis **Node.js (TypeScript)**, **Baileys Multi-Device WhatsApp Socket**, **Redis & BullMQ**, **Prisma ORM**, dan **Payment Gateway (QRIS & Virtual Account)**.

---

##  Architecture Overview

```
                          +-----------------------------------+
                          |      Web App Frontend (SPA)       |
                          | (Form, OTP Modal, Live Tracking)  |
                          +-----------------+-----------------+
                                            | REST API / Fingerprint
                                            v
+-----------------------------------------------------------------------------------+
|                            EXPRESS.JS BACKEND ENGINE                              |
|                                                                                   |
|  [Multi-tier Rate Limiter] (IP + Device Fingerprint + Target Phone via Redis)    |
|                                                                                   |
|  +--------------------+     +----------------------+     +---------------------+  |
|  |   OTP Service      |     | Transaction Service  |     |   Payment Service   |  |
|  |  (3-min TTL, Hash) |     |   (State Machine)    |     | (QRIS/VA + Webhook) |  |
|  +--------------------+     +----------------------+     +---------------------+  |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                    BullMQ Queue & Redlock Concurrency Lock                  |  |
|  +-----------------------------------------------------------------------------+  |
|                                            |                                      |
|                                            v                                      |
|  +-----------------------------------------------------------------------------+  |
|  |                 Baileys WhatsApp Socket Service (@whiskeysockets)           |  |
|  |    - Auto Group Creation: REKBER-[SHORT_CODE]                                |  |
|  |    - Strict Member Invitation via DM (No open public link)                  |  |
|  |    - Anti-Rogue Auto-Kick on `group-participants.update`                    |  |
|  |    - Chat Commands on `messages.upsert` (/kirim, /selesai, /dispute)        |  |
|  +-----------------------------------------------------------------------------+  |
+------------------------------------+----------------------------------------------+
                                     |
              +----------------------+----------------------+
              |                                             |
              v                                             v
     +-----------------+                           +-----------------+
     | PostgreSQL DB   |                           |  Redis Server   |
     | (Prisma Schema) |                           | (Queue & Locks) |
     +-----------------+                           +-----------------+
```

---

##  Security & Anti-Abuse Modules

1. **Multi-tier Rate Limiter (`src/middlewares/rateLimiter.ts`)**:
   - **IP Address Throttling**: Maksimal 5x request OTP per 1 jam per IP.
   - **Device Fingerprint Throttling**: Memvalidasi `visitorId` (FingerprintJS) dari client, dibatasi 5x request OTP per 1 jam per device.
   - **Target Phone Rate Limit**: 1 nomor WhatsApp tujuan dibatasi maksimal 3x request OTP per 1 jam.
2. **Strict E.164 Sanitation (`src/utils/phone.ts`)**:
   - Membersihkan nomor menjadi format `628xxxxxxxxxx`.
3. **OTP Engine (`src/services/otp.service.ts`)**:
   - Generate 6-digit random token dengan crypto random bytes.
   - Disimpan di Redis dengan TTL 180 detik (3 menit).
   - Log tersimpan di tabel `otp_logs` dengan HMAC-SHA256 salted hash.

---

##  WhatsApp Bot Lifecycle

| Tahap | Event Trigger | Tindakan Bot |
|---|---|---|
| **1. Buat Grup** | OTP Verifikasi lolos | Bot membuat grup WA `REKBER-[TRX_ID]`, set `announcement: true` (chat terkunci) & `restrict: true`. |
| **2. Undangan Ketat** | Background Worker | Bot mengirim DM personal ke Pembeli & Penjual berisi rincian transaksi + link masuk privat. |
| **3. Filter Anggota** | `group-participants.update` | Jika nomor tidak dikenal bergabung, bot otomatis **menendang (kick) seketika**. |
| **4. Tagihan** | Kedua member masuk | Bot menerbitkan invoice QRIS / VA di dalam grup. Chat tetap di-mute. |
| **5. Pembayaran Lunas** | Webhook Payment (`PAID`) | Status update ke `PAID_HELD`. Bot membuka kunci grup (`announcement: false`) dan meminta Penjual menyerahkan pesanan. |
| **6. Penyerahan** | `/kirim` atau `/konfirmasi` | Status update ke `IN_DELIVERY`. Bot meminta Pembeli memeriksa barang. |
| **7. Pencairan (Payout)** | `/selesai` (oleh Pembeli) | Redlock + DB lock dijalankan (anti-double payout). Dana dicairkan ke Penjual via API Disbursement, bukti dikirim ke grup, lalu bot menendang member & leave grup. |
| **8. Sengketa (Dispute)** | `/dispute` atau `/batal` | Bot mengunci kembali chat grup dan mengirimkan webhook darurat ke tim mediator/admin. |

---

##  Database Entities (Prisma Schema)

- **`User`**: Data inisiator dan verifikasi akun.
- **`Transaction`**: Rekod transaksi, status, nomor pembeli & penjual, biaya escrow, link grup WA, ID pembayaran & payout.
- **`Dispute`**: Laporan sengketa dan resolusi mediator.
- **`OtpLog`**: Audit pengiriman dan verifikasi OTP.
- **`PaymentWebhookLog`**: Idempotency key logger untuk mencegah webhook diproses ganda.
- **`AuditLog`**: Log audit setiap transisi status transaksi.

---

##  Quick Start Guide

### 1. Prasyarat
- Node.js (v18+)
- Redis Server (`localhost:6379`)
- PostgreSQL Database

### 2. Instalasi Dependensi
```bash
npm install
```

### 3. Konfigurasi Environment (.env)
Salin berkas `.env.example` menjadi `.env` dan sesuaikan nilainya:
```bash
cp .env.example .env
```

### 4. Setup Database & Prisma
```bash
npx prisma db push
# atau
npm run prisma:generate
```

### 5. Jalankan Aplikasi
```bash
# Mode Development
npm run dev

# Mode Production
npm run build
npm start
```

Buka browser di `http://localhost:3000` untuk mengakses Web Dashboard Rekber.
