# Wallet System Documentation

## Overview

The wallet system manages financial transactions for users, admins, and station owners. It ensures proper balance tracking, commission distribution, and prevents charging when balance is insufficient.

## Key Features

1. **Payment Processing**: When a user completes payment, the amount is added to both user and admin wallet balances
2. **Charging Deduction**: When a vehicle is charged, the amount is deducted from the user's wallet balance
3. **Commission Distribution**: When user pays for charging:
   - Commission amount is added to station owner's wallet balance
   - Commission amount is deducted from admin wallet balance
4. **Balance Validation**: Users with zero balance cannot start charging
5. **Minimum Balance**: Minimum wallet balance is 0 (no negative balances allowed)

## API Endpoints

### 1. Get Current User Wallet
**GET** `/api/wallet`

Get the current authenticated user's wallet balance.

**Query Parameters:**
- `userId` (optional): User ID (if not using auth token)

**Response:**
```json
{
  "success": true,
  "wallet": {
    "id": "wallet-id",
    "balance": "1000.00",
    "currency": "LKR",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 2. Get Wallet by User ID
**GET** `/api/wallet/:userId`

Get wallet details for a specific user ID. Admin can access any wallet, users can only access their own.

**Response:**
```json
{
  "success": true,
  "wallet": {
    "id": "wallet-id",
    "userId": "user-id",
    "balance": "1000.00",
    "currency": "LKR",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "user": {
      "id": "user-id",
      "email": "user@example.com",
      "name": "User Name",
      "role": "CONSUMER"
    }
  }
}
```

### 3. Get All Wallets (Admin Only)
**GET** `/api/wallet/all`

Get all wallets. Admin only endpoint.

**Query Parameters:**
- `limit` (optional, default: 100): Number of results to return
- `offset` (optional, default: 0): Number of results to skip
- `role` (optional): Filter by user role (CONSUMER, OWNER, ADMIN)

**Response:**
```json
{
  "success": true,
  "wallets": [
    {
      "id": "wallet-id",
      "userId": "user-id",
      "balance": "1000.00",
      "currency": "LKR",
      "updatedAt": "2024-01-15T10:30:00.000Z",
      "user": {
        "id": "user-id",
        "email": "user@example.com",
        "name": "User Name",
        "role": "CONSUMER",
        "isActive": true
      }
    }
  ],
  "pagination": {
    "total": 50,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

### 4. Top Up Wallet
**POST** `/api/wallet/topup`

Top up wallet. When payment is completed, this adds the amount to both user and admin wallet balances.

**Request Body:**
```json
{
  "amount": 1000.00,
  "paymentId": "PAY_123456789",
  "idempotencyKey": "topup_123456789",
  "userId": "user-id"
}
```

**Response:**
```json
{
  "success": true,
  "duplicate": false,
  "wallet": {
    "id": "wallet-id",
    "balance": "2000.00",
    "currency": "LKR"
  },
  "ledgerEntry": {
    "id": "ledger-id",
    "type": "TOP_UP",
    "amount": "1000.00",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Note:** The same amount is added to both user and admin wallets when payment is completed.

### 5. Get Transaction History
**GET** `/api/wallet/transactions`

Get transaction history for the current user.

**Query Parameters:**
- `limit` (optional, default: 50): Number of results to return
- `offset` (optional, default: 0): Number of results to skip
- `type` (optional): Filter by ledger type (TOP_UP, CHARGE_DEBIT, REFUND, OWNER_EARNING, COMMISSION, SETTLEMENT_PAYOUT)
- `userId` (optional): User ID (if not using auth token)

**Response:**
```json
{
  "success": true,
  "transactions": [
    {
      "id": "ledger-id",
      "type": "TOP_UP",
      "amount": "1000.00",
      "balanceAfter": "2000.00",
      "description": "Wallet top-up via payment PAY_123456789",
      "referenceId": "PAY_123456789",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

## Business Logic Flow

### 1. Payment Completion Flow

When a user completes payment:
1. Payment amount is added to user's wallet balance
2. Same payment amount is added to admin's wallet balance
3. Ledger entries are created for both transactions

### 2. Charging Flow

When a vehicle is charged:
1. Amount is deducted from user's wallet balance
2. If balance becomes insufficient, grace period starts
3. If balance reaches 0, charging is stopped

### 3. Commission Flow

When user pays for charging:
1. Commission is calculated: `commission = totalCost * (commissionRate / 100)`
2. Owner earning is calculated: `ownerEarning = totalCost - commission`
3. Commission amount is added to station owner's wallet balance
4. Commission amount is deducted from admin's wallet balance
5. Ledger entries are created for both transactions

### 4. Balance Validation

Before starting a charging session:
- System checks if user's wallet balance is greater than 0
- If balance is 0 or less, charging is blocked with error: "Insufficient wallet balance. Please top up your wallet."

## Postman Collection

A Postman collection is provided in `postman_wallet_collection.json` for testing all wallet APIs.

### Setup

1. Import the collection into Postman
2. Set up environment variables:
   - `baseUrl`: Your API base URL (e.g., `http://localhost:3000`)
   - `authToken`: Firebase auth token for regular user
   - `adminAuthToken`: Firebase auth token for admin user
   - `userId`: User ID for testing
   - `adminUserId`: Admin user ID
   - `ownerUserId`: Station owner user ID

### Test Scenarios

The collection includes three test scenarios:

1. **Complete Payment Flow**: Tests that payment amount is added to both user and admin wallets
2. **Zero Balance Prevention**: Verifies that users with zero balance cannot start charging
3. **Commission Flow**: Tests commission distribution after charging session completes

## Database Schema

### Wallet Model
```prisma
model Wallet {
  id            String    @id @default(uuid())
  userId        String    @unique
  balance       Decimal   @default(0) @db.Decimal(12, 2)
  currency      String    @default("LKR")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  version       Int       @default(0)  // Optimistic locking
  user          User      @relation(fields: [userId], references: [id])
}
```

### Ledger Types
- `TOP_UP`: Money added to wallet
- `CHARGE_DEBIT`: Deducted during charging
- `REFUND`: Money returned to user
- `OWNER_EARNING`: Station owner receives share
- `COMMISSION`: Platform commission (deducted from admin)
- `SETTLEMENT_PAYOUT`: Owner payout processed

## Error Handling

- **Insufficient Balance**: Returns error when trying to deduct more than available balance
- **Zero Balance**: Blocks charging when balance is 0
- **Concurrent Modifications**: Uses optimistic locking to handle concurrent transactions
- **Idempotency**: All operations use idempotency keys to prevent duplicate transactions

## Security Considerations

- All wallet operations require authentication
- Users can only access their own wallet (unless admin)
- Admin endpoints require ADMIN role
- Optimistic locking prevents race conditions
- All amounts are stored as Decimal for precision

## Notes

- Minimum wallet balance is 0 (no negative balances)
- All amounts are in LKR (Sri Lankan Rupees)
- Commission rate is configurable per pricing plan (default: 2%)
- Wallet balances are updated atomically with ledger entries






