# PayHere Payment Gateway Integration

## Overview

This document describes the PayHere payment gateway integration for wallet top-up functionality. The integration includes secure webhook handling, signature verification, and proper error handling.

## Architecture

### Flow Diagram

```
1. User initiates top-up → POST /api/wallet/topup
2. System creates payment record → Returns checkout URL
3. User redirected to PayHere → User completes payment
4. PayHere sends webhook → POST /api/payments/webhook
5. System verifies signature → Updates payment status
6. System updates wallet → Adds amount to user & admin wallets
7. User redirected back → GET /api/payments/return
```

## Database Schema

### Payment Model

```prisma
model Payment {
  id                String      @id @default(uuid())
  userId            String
  orderId           String      @unique  // PayHere order_id
  merchantId        String
  amount            Decimal     @db.Decimal(12, 2)
  currency          String      @default("LKR")
  status            PaymentStatus @default(PENDING)
  payherePaymentId  String?
  payhereAmount     Decimal?
  payhereCurrency   String?
  firstName         String?
  lastName          String?
  email             String?
  phone             String?
  address           String?
  city              String?
  country           String?
  items             String?
  hash              String?
  webhookData       Json?
  webhookReceivedAt DateTime?
  statusCode        String?
  statusMessage     String?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  completedAt       DateTime?
}
```

### Payment Status Enum

- `PENDING` - Payment initiated, waiting for user
- `PROCESSING` - Payment in progress
- `SUCCESS` - Payment successful
- `FAILED` - Payment failed
- `CANCELLED` - User cancelled payment
- `EXPIRED` - Payment expired
- `REFUNDED` - Payment refunded

## Environment Variables

Add these to your `.env` file:

```env
# PayHere Configuration
PAYHERE_MERCHANT_ID=your_merchant_id
PAYHERE_MERCHANT_SECRET=your_merchant_secret
PAYHERE_SANDBOX=true  # Set to false for production

# Application URLs
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# PayHere URLs (optional, defaults provided)
PAYHERE_RETURN_URL=http://localhost:3000/api/payments/return
PAYHERE_CANCEL_URL=http://localhost:3000/api/payments/cancel
PAYHERE_NOTIFY_URL=http://localhost:3000/api/payments/webhook
```

## API Endpoints

### 1. Initiate Payment (Top-Up)

**POST** `/api/wallet/topup`

Initiates a PayHere payment for wallet top-up.

**Request Body:**
```json
{
  "userId": "user-id",
  "amount": 1000.00,
  "email": "user@example.com",
  "phone": "0771234567",
  "firstName": "John",
  "lastName": "Doe",
  "address": "123, Main Street",
  "city": "Colombo",
  "country": "Sri Lanka"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment initiated successfully",
  "payment": {
    "id": "payment-id",
    "orderId": "TOPUP_user-id_1234567890_abc12345",
    "amount": "1000.00",
    "currency": "LKR",
    "status": "PENDING",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  "checkout": {
    "url": "https://sandbox.payhere.lk/pay/checkout",
    "method": "POST",
    "data": {
      "merchant_id": "your_merchant_id",
      "order_id": "TOPUP_user-id_1234567890_abc12345",
      "amount": "1000.00",
      "currency": "LKR",
      "hash": "MD5_HASH",
      ...
    }
  }
}
```

### 2. PayHere Webhook

**POST** `/api/payments/webhook`

Handles PayHere server-to-server notifications. This endpoint:
- Verifies webhook signature
- Updates payment status
- Updates user wallet on success
- Updates admin wallet on success

**Webhook Payload (from PayHere):**
```
merchant_id=your_merchant_id
order_id=TOPUP_user-id_1234567890_abc12345
payhere_amount=1000.00
payhere_currency=LKR
status_code=2
md5sig=VERIFIED_HASH
payment_id=PAY_123456789
method=VISA
status_message=Successfully completed the payment
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed",
  "orderId": "TOPUP_user-id_1234567890_abc12345"
}
```

### 3. Payment Return

**GET** `/api/payments/return`

Handles user redirect after payment completion. Redirects to frontend with payment status.

**Query Parameters:**
- `order_id` - PayHere order ID
- `payment_id` - PayHere payment ID
- `status_code` - Payment status code

### 4. Payment Cancel

**GET** `/api/payments/cancel`

Handles user redirect when payment is cancelled. Redirects to frontend.

**Query Parameters:**
- `order_id` - PayHere order ID

### 5. Get Payment Status

**GET** `/api/payments/:orderId`

Get payment status by order ID.

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "payment-id",
    "orderId": "TOPUP_user-id_1234567890_abc12345",
    "amount": "1000.00",
    "currency": "LKR",
    "status": "SUCCESS",
    "payherePaymentId": "PAY_123456789",
    "statusMessage": "Successfully completed the payment",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "completedAt": "2024-01-15T10:35:00.000Z"
  }
}
```

### 6. Get User Payments

**GET** `/api/payments/user/:userId`

Get all payments for a user.

**Query Parameters:**
- `limit` - Number of results (default: 50)
- `offset` - Offset for pagination (default: 0)
- `status` - Filter by status (optional)

## Security Features

### 1. Signature Verification

All webhooks are verified using MD5 hash:

```javascript
hash = MD5(merchant_id + order_id + amount + currency + status_code + MD5(merchant_secret))
```

### 2. Idempotency

- Payment records use unique `orderId`
- Wallet updates use idempotency keys
- Duplicate webhooks are safely ignored

### 3. Transaction Safety

- All wallet updates happen in database transactions
- Payment status updates are atomic
- Optimistic locking prevents race conditions

### 4. Error Handling

- Invalid signatures return 400
- Missing payments return 404
- All errors are logged for investigation
- Webhooks always return 200 to prevent retries

## PayHere Status Codes

| Code | Status | Description |
|------|--------|-------------|
| 0 | PENDING | Payment initiated |
| 1 | PROCESSING | Payment in progress |
| 2 | SUCCESS | Payment successful |
| -1 | CANCELLED | User cancelled |
| -2 | FAILED | Payment failed |
| -3 | EXPIRED | Payment expired |

## Testing

### 1. Setup

1. Create PayHere sandbox account
2. Get merchant ID and secret
3. Add to `.env` file
4. Run database migration:
   ```bash
   npx prisma migrate dev --name add_payment_model
   ```

### 2. Postman Collection

Import `postman_payhere_collection.json` into Postman.

**Test Scenarios:**
1. **Complete Payment Flow** - End-to-end test
2. **Webhook Simulation** - Test webhook handling
3. **Payment Status** - Check payment status
4. **Error Cases** - Invalid signatures, etc.

### 3. Manual Testing

1. **Initiate Payment:**
   ```bash
   POST /api/wallet/topup
   {
     "userId": "user-id",
     "amount": 1000.00,
     "email": "user@example.com",
     "phone": "0771234567"
   }
   ```

2. **Simulate Webhook:**
   ```bash
   POST /api/payments/webhook
   Content-Type: application/x-www-form-urlencoded
   
   merchant_id=...
   order_id=...
   payhere_amount=1000.00
   payhere_currency=LKR
   status_code=2
   md5sig=...
   ```

3. **Check Payment Status:**
   ```bash
   GET /api/payments/{orderId}
   ```

## Production Checklist

- [ ] Set `PAYHERE_SANDBOX=false`
- [ ] Use production merchant ID and secret
- [ ] Configure production URLs (return, cancel, notify)
- [ ] Enable HTTPS for webhook endpoint
- [ ] Set up webhook monitoring/alerts
- [ ] Test with real PayHere account
- [ ] Review error logs regularly
- [ ] Set up payment reconciliation process

## Troubleshooting

### Webhook Not Received

1. Check PayHere dashboard for webhook logs
2. Verify `notify_url` is accessible from internet
3. Check server logs for incoming requests
4. Verify signature calculation

### Invalid Signature

1. Verify merchant secret is correct
2. Check hash calculation matches PayHere format
3. Ensure all parameters are included in hash
4. Check for encoding issues

### Payment Not Updating Wallet

1. Check webhook was received and processed
2. Verify payment status is SUCCESS
3. Check for duplicate ledger entries
4. Review server logs for errors

## Support

For PayHere API documentation:
- https://support.payhere.lk/api-&-mobile-sdk/checkout-api
- https://support.payhere.lk/api-&-mobile-sdk/webhooks





