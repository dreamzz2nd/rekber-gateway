import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  GroupMetadata,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../config/database.js';
import { phoneToJid, jidToPhone, sanitizePhoneNumber } from '../utils/phone.js';
import { transactionService } from './transaction.service.js';
import { botQueue } from './queue.service.js';

export class WhatsAppService {
  private sock: WASocket | null = null;
  private isConnecting: boolean = false;
  private qrCodeString: string | null = null;
  private isReady: boolean = false;

  constructor() {
    // Auth folder setup
    const authDir = path.resolve(process.cwd(), env.WA_SESSION_AUTH_FOLDER);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
  }

  /**
   * Initializes Baileys Multi-Device Socket Connection
   */
  async initialize(): Promise<void> {
    if (this.isConnecting || (this.sock && this.isReady)) return;
    this.isConnecting = true;

    try {
      const authDir = path.resolve(process.cwd(), env.WA_SESSION_AUTH_FOLDER);
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pinoLoggerShim,
        browser: ['Rekber Gateway', 'Chrome', '1.0.0'],
        syncFullHistory: false,
      });

      // Save credentials state on update
      this.sock.ev.on('creds.update', saveCreds);

      // Connection update handler
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCodeString = qr;
          logger.info('WhatsApp QR Code received. Scan to authenticate:');
          qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
          this.isReady = false;
          this.isConnecting = false;
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          logger.warn({ statusCode, shouldReconnect }, 'WhatsApp connection closed');

          if (shouldReconnect) {
            setTimeout(() => this.initialize(), 5000);
          } else {
            logger.error('WhatsApp Session logged out. Please delete auth folder & re-scan QR.');
          }
        } else if (connection === 'open') {
          this.isReady = true;
          this.isConnecting = false;
          this.qrCodeString = null;
          logger.info('✅ WhatsApp Gateway Socket Connected & Ready');
        }
      });

      // Listen to group participants updates (Anti-unauthorized member entry)
      this.sock.ev.on('group-participants.update', async (event) => {
        await this.handleGroupParticipantsUpdate(event);
      });

      // Listen to incoming messages & group commands
      this.sock.ev.on('messages.upsert', async (event) => {
        await this.handleIncomingMessages(event);
      });
    } catch (err) {
      this.isConnecting = false;
      logger.error({ err }, 'Error initializing WhatsApp socket');
    }
  }

  /**
   * Get Current Status & QR Code for web admin monitor
   */
  getStatus() {
    return {
      isReady: this.isReady,
      hasQr: !!this.qrCodeString,
      qrCode: this.qrCodeString,
    };
  }

  /**
   * Send WhatsApp Direct Message
   */
  async sendDirectMessage(phone: string, text: string): Promise<boolean> {
    if (!this.sock || !this.isReady) {
      logger.warn({ phone }, 'WhatsApp bot socket is not ready. Message queued / skipped in dev mode');
      return false;
    }
    const jid = phoneToJid(phone);
    await this.sock.sendMessage(jid, { text });
    return true;
  }

  /**
   * Send message to a group
   */
  async sendGroupMessage(groupId: string, text: string): Promise<boolean> {
    if (!this.sock || !this.isReady) {
      logger.warn({ groupId }, 'WhatsApp bot not connected when trying to send group message');
      return false;
    }
    await this.sock.sendMessage(groupId, { text });
    return true;
  }

  /**
   * Create Escrow WhatsApp Group with strict security settings
   */
  async createEscrowGroup(params: {
    transactionId: string;
    shortCode: string;
    buyerPhone: string;
    sellerPhone: string;
    title: string;
    totalAmount: string;
  }): Promise<{ groupId: string; inviteLink: string }> {
    if (!this.sock || !this.isReady) {
      // Mock fallback for testing if socket not authenticated
      const mockGroupId = `120363000000000000@g.us`;
      const mockInviteLink = `https://chat.whatsapp.com/mock-${params.shortCode}`;
      logger.info({ mockGroupId }, 'Generated mock escrow group since WA bot is offline');
      return { groupId: mockGroupId, inviteLink: mockInviteLink };
    }

    const groupTitle = `REKBER-${params.shortCode}`;

    // 1. Create Group with bot only initially
    const group = await this.sock.groupCreate(groupTitle, []);
    const groupId = group.id;

    // 2. Lock group info & announcements (Admin Only)
    await this.sock.groupSettingUpdate(groupId, 'announcement'); // Only admin can send messages
    await this.sock.groupSettingUpdate(groupId, 'locked'); // Only admin can edit group info

    // Set group description
    const desc = 
      `🛡️ *OFFICIAL REKBER ESCROW GROUP*\n` +
      `ID: ${params.shortCode}\n` +
      `Item: ${params.title}\n` +
      `Nominal: Rp ${Number(params.totalAmount).toLocaleString('id-ID')}\n\n` +
      `PERATURAN:\n` +
      `1. Dilarang bertransaksi di luar grup ini.\n` +
      `2. Chat terkunci hingga pembayaran terverifikasi.\n` +
      `3. Ikuti instruksi bot untuk penyelesaian aman.`;

    await this.sock.groupUpdateDescription(groupId, desc);

    // 3. Get Group Invite Code
    const inviteCode = await this.sock.groupInviteCode(groupId);
    const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;

    // 4. Send Private DM Invites to Buyer and Seller
    await this.sendDmInvitation({
      phone: params.buyerPhone,
      role: 'PEMBELI',
      shortCode: params.shortCode,
      title: params.title,
      totalAmount: params.totalAmount,
      inviteLink,
    });

    await this.sendDmInvitation({
      phone: params.sellerPhone,
      role: 'PENJUAL',
      shortCode: params.shortCode,
      title: params.title,
      totalAmount: params.totalAmount,
      inviteLink,
    });

    return { groupId, inviteLink };
  }

  /**
   * Send strict DM Invitation to party
   */
  private async sendDmInvitation(data: {
    phone: string;
    role: string;
    shortCode: string;
    title: string;
    totalAmount: string;
    inviteLink: string;
  }) {
    const text =
      `👋 Halo! Anda terdaftar sebagai *${data.role}* pada transaksi Rekber:\n\n` +
      `📋 *Detail Transaksi:*\n` +
      `• Kode Transaksi: *${data.shortCode}*\n` +
      `• Judul Barang/Jasa: *${data.title}*\n` +
      `• Total Nominal: *Rp ${Number(data.totalAmount).toLocaleString('id-ID')}*\n\n` +
      `🔗 *Link Masuk Grup Khusus:*\n` +
      `${data.inviteLink}\n\n` +
      `⚠️ *PENTING:* Hanya nomor ini yang diizinkan masuk ke dalam grup. Jangan bagikan link ini kepada siapapun!`;

    await this.sendDirectMessage(data.phone, text);
  }

  /**
   * Handler for Participant Join/Leave events (Strict Member Filtering)
   */
  private async handleGroupParticipantsUpdate(event: {
    id: string; // Group ID
    participants: string[];
    action: string;
    author?: string;
  }) {
    const { id: groupId, participants, action } = event;

    if (action !== 'add') return;

    // Find transaction linked to this group
    const trx = await prisma.transaction.findUnique({
      where: { waGroupId: groupId },
    });

    if (!trx) return;

    const allowedPhones = [
      sanitizePhoneNumber(trx.buyerPhone),
      sanitizePhoneNumber(trx.sellerPhone),
    ];

    for (const jid of participants) {
      const phone = jidToPhone(jid);

      // Check if participant is unauthorized
      if (!allowedPhones.includes(phone)) {
        logger.warn({ groupId, roguePhone: phone }, '🚨 Unauthorized number entered escrow group! Kicking immediately.');
        try {
          if (this.sock) {
            await this.sock.groupParticipantsUpdate(groupId, [jid], 'remove');
            await this.sendGroupMessage(
              groupId,
              `⚠️ *KEAMANAN REKBER:* Nomor @${phone} dikeluarkan otomatis karena bukan bagian dari transaksi ini.`
            );
          }
        } catch (e) {
          logger.error({ e }, 'Failed to kick rogue member');
        }
        continue;
      }

      // Mark buyer/seller joined
      let updatedBuyerJoined = trx.buyerJoined;
      let updatedSellerJoined = trx.sellerJoined;

      if (phone === sanitizePhoneNumber(trx.buyerPhone)) {
        updatedBuyerJoined = true;
      }
      if (phone === sanitizePhoneNumber(trx.sellerPhone)) {
        updatedSellerJoined = true;
      }

      await prisma.transaction.update({
        where: { id: trx.id },
        data: {
          buyerJoined: updatedBuyerJoined,
          sellerJoined: updatedSellerJoined,
        },
      });

      await this.sendGroupMessage(
        groupId,
        `👋 Anggota terdaftar (${phone === sanitizePhoneNumber(trx.buyerPhone) ? 'Pembeli' : 'Penjual'}) telah bergabung.`
      );

      // If both members have joined and still WAITING_PAYMENT, send the Invoice
      if (updatedBuyerJoined && updatedSellerJoined && (trx.status === 'GROUP_CREATED' || trx.status === 'WAITING_PAYMENT')) {
        await botQueue.add('send-payment-invoice', { transactionId: trx.id });
      }
    }
  }

  /**
   * Handler for incoming messages & commands (/kirim, /selesai, /dispute, /batal)
   */
  private async handleIncomingMessages(event: {
    messages: proto.IWebMessageInfo[];
    type: string;
  }) {
    for (const msg of event.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || !remoteJid.endsWith('@g.us')) continue; // Only process group messages

      const senderJid = msg.key.participant || msg.key.remoteJid;
      const senderPhone = jidToPhone(senderJid || '');
      const messageText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      const command = messageText.trim().toLowerCase();

      // Check if group is registered in transactions
      const trx = await prisma.transaction.findUnique({
        where: { waGroupId: remoteJid },
      });

      if (!trx) continue;

      logger.info({ groupId: remoteJid, senderPhone, command }, 'Received command in escrow group');

      const isBuyer = senderPhone === sanitizePhoneNumber(trx.buyerPhone);
      const isSeller = senderPhone === sanitizePhoneNumber(trx.sellerPhone);

      if (!isBuyer && !isSeller) continue;

      // Handle Command: /kirim or /konfirmasi (Seller Only)
      if (command === '/kirim' || command === '/konfirmasi') {
        if (!isSeller) {
          await this.sendGroupMessage(remoteJid, `❌ Perintah */kirim* hanya dapat dilakukan oleh Penjual.`);
          continue;
        }

        if (trx.status !== 'PAID_HELD') {
          await this.sendGroupMessage(
            remoteJid,
            `⚠️ Pembayaran belum masuk ke escrow vault. Status saat ini: *${trx.status}*.`
          );
          continue;
        }

        await transactionService.transitionStatus(trx.id, 'IN_DELIVERY', {
          actor: senderPhone,
          action: 'SELLER_DELIVERED_ITEM',
        });

        await this.sendGroupMessage(
          remoteJid,
          `📦 *BARANG TELAH DIKIRIM OLEH PENJUAL*\n\n` +
          `Pembeli (@${trx.buyerPhone}), silakan periksa akun / barang / jasa yang diserahkan.\n\n` +
          `Jika sudah sesuai dan aman, ketik */selesai* untuk mencairkan dana ke Penjual.\n` +
          `Jika ada kendala, ketik */dispute* untuk memanggil admin.`
        );
      }

      // Handle Command: /selesai (Buyer Only -> Trigger Atomic Payout)
      else if (command === '/selesai') {
        if (!isBuyer) {
          await this.sendGroupMessage(remoteJid, `❌ Perintah */selesai* hanya dapat dikonfirmasi oleh Pembeli.`);
          continue;
        }

        if (trx.status !== 'IN_DELIVERY' && trx.status !== 'PAID_HELD') {
          await this.sendGroupMessage(
            remoteJid,
            `⚠️ Tidak dapat menyelesaikan transaksi pada status *${trx.status}*.`
          );
          continue;
        }

        await this.sendGroupMessage(
          remoteJid,
          `⏳ *PROSES PENCAIRAN DANA...*\n` +
          `Pembeli telah mengonfirmasi penyelesaian. Sistem sedang memproses disbursement otomatis ke Penjual...`
        );

        // Queue payout job
        await botQueue.add('process-payout', {
          transactionId: trx.id,
          actorPhone: senderPhone,
        });
      }

      // Handle Command: /dispute or /batal
      else if (command === '/dispute' || command === '/batal') {
        await this.sendGroupMessage(
          remoteJid,
          `🚨 *SENGKETA DIAJUKAN (DISPUTE)*\n\n` +
          `Grup telah dikunci kembali. Notifikasi darurat telah dikirim ke Tim Mediator / CS Rekber untuk masuk ke grup ini.`
        );

        // Lock group chat again immediately
        if (this.sock) {
          await this.sock.groupSettingUpdate(remoteJid, 'announcement');
        }

        // Transition status to DISPUTED
        await transactionService.transitionStatus(trx.id, 'DISPUTED', {
          actor: senderPhone,
          action: 'DISPUTE_RAISED',
          reason: `Dispute dipicu oleh ${isBuyer ? 'Pembeli' : 'Penjual'} (${senderPhone})`,
        });

        // Notify Admin via WhatsApp DM
        await this.sendDirectMessage(
          env.WA_ADMIN_PHONE_ALERT,
          `🚨 *ALERT SENGKETA REKBER!*\n` +
          `Transaksi: ${trx.shortCode}\n` +
          `Barang: ${trx.title}\n` +
          `Nominal: Rp ${Number(trx.totalAmount).toLocaleString('id-ID')}\n` +
          `Grup ID: ${remoteJid}\n` +
          `Pelapor: @${senderPhone} (${isBuyer ? 'Pembeli' : 'Penjual'})`
        );
      }
    }
  }

  /**
   * Unlock Group Chat for discussion once payment is verified
   */
  async unlockGroupChat(groupId: string) {
    if (this.sock && this.isReady) {
      await this.sock.groupSettingUpdate(groupId, 'not_announcement');
    }
  }

  /**
   * Lock Group Chat (Admin only)
   */
  async lockGroupChat(groupId: string) {
    if (this.sock && this.isReady) {
      await this.sock.groupSettingUpdate(groupId, 'announcement');
    }
  }

  /**
   * Complete Escrow: Send receipt, kick members, and leave group
   */
  async finalizeAndCleanGroup(groupId: string, receiptMessage: string) {
    if (!this.sock || !this.isReady) return;

    try {
      await this.sendGroupMessage(groupId, receiptMessage);
      
      // Give 5 seconds for participants to read proof
      setTimeout(async () => {
        try {
          const groupMeta: GroupMetadata = await this.sock!.groupMetadata(groupId);
          const membersToKick = groupMeta.participants
            .filter((p) => !p.admin)
            .map((p) => p.id);

          if (membersToKick.length > 0) {
            await this.sock!.groupParticipantsUpdate(groupId, membersToKick, 'remove');
          }

          // Bot leaves group
          await this.sock!.groupLeave(groupId);
        } catch (e) {
          logger.error({ e }, 'Error during group teardown');
        }
      }, 5000);
    } catch (e) {
      logger.error({ e }, 'Error finalizing group');
    }
  }
}

// Pino logger mock for Baileys internal logs
const pinoLoggerShim: any = {
  level: 'silent',
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => pinoLoggerShim,
};

export const whatsappService = new WhatsAppService();
