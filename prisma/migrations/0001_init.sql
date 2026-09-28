-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BUYER', 'SELLER');
CREATE TYPE "FeePayer" AS ENUM ('BUYER', 'SELLER', 'SPLIT_50_50');
CREATE TYPE "TransactionStatus" AS ENUM (
  'PENDING_VERIFICATION',
  'GROUP_CREATED',
  'WAITING_PAYMENT',
  'PAID_HELD',
  'IN_DELIVERY',
  'COMPLETED',
  'DISPUTED',
  'REFUNDED',
  'CANCELLED'
);
CREATE TYPE "DisputeStatus" AS ENUM (
  'OPEN',
  'IN_REVIEW',
  'RESOLVED_RELEASE_SELLER',
  'RESOLVED_REFUND_BUYER',
  'CANCELLED'
);
CREATE TYPE "OtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED');

-- CreateTable users
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone_number" TEXT NOT NULL UNIQUE,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable transactions
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "short_code" TEXT NOT NULL UNIQUE,
    "initiator_phone" TEXT NOT NULL,
    "initiator_role" "Role" NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "seller_phone" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "fee_amount" DECIMAL(15,2) NOT NULL,
    "fee_payer" "FeePayer" NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "wa_group_id" TEXT UNIQUE,
    "wa_group_invite_link" TEXT,
    "buyer_joined" BOOLEAN NOT NULL DEFAULT false,
    "seller_joined" BOOLEAN NOT NULL DEFAULT false,
    "payment_id" TEXT UNIQUE,
    "payment_method" TEXT,
    "payment_status" TEXT,
    "payment_qr_string" TEXT,
    "payment_va_number" TEXT,
    "payment_settled_at" TIMESTAMP(3),
    "payout_id" TEXT UNIQUE,
    "payout_status" TEXT,
    "payout_reference" TEXT,
    "payout_beneficiary_bank" TEXT,
    "payout_beneficiary_account" TEXT,
    "payout_beneficiary_name" TEXT,
    "payout_disbursed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transactions_initiator_phone_fkey" FOREIGN KEY ("initiator_phone") REFERENCES "users" ("phone_number") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable disputes
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_id" TEXT NOT NULL,
    "initiator_phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "admin_notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable otp_logs
CREATE TABLE "otp_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "device_fingerprint" TEXT NOT NULL,
    "otp_code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" "OtpStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable payment_webhook_logs
CREATE TABLE "payment_webhook_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_id" TEXT,
    "idempotency_key" TEXT NOT NULL UNIQUE,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_webhook_logs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable audit_logs
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_id" TEXT,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Indexes
CREATE INDEX "users_phone_number_idx" ON "users"("phone_number");
CREATE INDEX "transactions_buyer_phone_idx" ON "transactions"("buyer_phone");
CREATE INDEX "transactions_seller_phone_idx" ON "transactions"("seller_phone");
CREATE INDEX "transactions_status_idx" ON "transactions"("status");
CREATE INDEX "transactions_short_code_idx" ON "transactions"("short_code");
CREATE INDEX "transactions_wa_group_id_idx" ON "transactions"("wa_group_id");
CREATE INDEX "disputes_transaction_id_idx" ON "disputes"("transaction_id");
CREATE INDEX "otp_logs_phone_idx" ON "otp_logs"("phone");
CREATE INDEX "otp_logs_ip_address_idx" ON "otp_logs"("ip_address");
CREATE INDEX "payment_webhook_logs_idempotency_key_idx" ON "payment_webhook_logs"("idempotency_key");
