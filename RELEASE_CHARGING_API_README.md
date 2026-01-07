# Release Charging Amount API Documentation

## Overview

The Release Charging Amount API processes payment distribution after a charging session. It deducts the charging amount from the user's wallet and distributes it between the admin (commission) and station owner (owner earning).

## Endpoint

**POST** `/api/wallet/release-charging`

## Request Body

```json
{
  "userId": "user-id",
  "ownerId": "owner-id",
  "amount": 500.00,
  "commissionRate": 2.0,
  "transactionId": "TXN_123456789",
  "idempotencyKey": "release_123456789"
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | Yes | User ID who charged the vehicle |
| `ownerId` | string | Yes | Station owner ID who owns the charging station |
| `amount` | number | Yes | Total charging amount to be released (must be > 0) |
| `commissionRate` | number | No | Commission rate percentage (default: 2.0) |
| `transactionId` | string | Yes | Charging session transaction ID |
| `idempotencyKey` | string | No | Unique key for idempotency (auto-generated if not provided) |

## Response

### Success Response (200 OK)

```json
{
  "success": true,
  "duplicate": false,
  "message": "Charging amount released successfully",
  "amounts": {
    "total": "500.00",
    "commission": "10.00",
    "ownerEarning": "490.00",
    "commissionRate": "2.00"
  },
  "wallets": {
    "user": {
      "id": "wallet-id",
      "userId": "user-id",
      "balance": "1500.00",
      "previousBalance": "2000.00"
    },
    "admin": {
      "id": "admin-wallet-id",
      "userId": "admin-id",
      "balance": "1010.00",
      "commissionAdded": "10.00"
    },
    "owner": {
      "id": "owner-wallet-id",
      "userId": "owner-id",
      "balance": "490.00",
      "earningAdded": "490.00"
    }
  },
  "transactionId": "TXN_123456789"
}
```

### Error Responses

#### 400 Bad Request - Validation Error

```json
{
  "success": false,
  "error": "User ID is required",
  "field": "userId"
}
```

#### 400 Bad Request - Insufficient Balance

```json
{
  "success": false,
  "error": "Insufficient wallet balance",
  "code": "INSUFFICIENT_BALANCE",
  "details": {
    "currentBalance": "100.00",
    "requiredAmount": "500.00"
  }
}
```

#### 404 Not Found - User Not Found

```json
{
  "success": false,
  "error": "User not found",
  "userId": "invalid-user-id"
}
```

#### 404 Not Found - Owner Not Found

```json
{
  "success": false,
  "error": "Station owner not found",
  "ownerId": "invalid-owner-id"
}
```

#### 400 Bad Request - Invalid Owner Role

```json
{
  "success": false,
  "error": "Provided owner ID is not a station owner",
  "ownerId": "user-id",
  "ownerRole": "CONSUMER"
}
```

#### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Failed to release charging amount",
  "message": "Error details..."
}
```

## Business Logic

1. **Validation**: Validates all required parameters
2. **User Check**: Verifies user exists
3. **Owner Check**: Verifies owner exists and has OWNER role
4. **Balance Check**: Verifies user has sufficient balance
5. **Amount Distribution**:
   - Commission = `amount * (commissionRate / 100)`
   - Owner Earning = `amount - commission`
6. **Wallet Updates** (all in a single transaction):
   - Deduct `amount` from user wallet
   - Add `commission` to admin wallet
   - Add `ownerEarning` to station owner wallet
7. **Ledger Entries**: Creates ledger entries for all three transactions

## Example Calculation

If charging amount is **500.00 LKR** with **2% commission rate**:

- **Total Amount**: 500.00 LKR
- **Commission** (2%): 10.00 LKR → Added to admin wallet
- **Owner Earning** (98%): 490.00 LKR → Added to owner wallet
- **User Deduction**: 500.00 LKR → Deducted from user wallet

## Idempotency

The API is idempotent. If the same `idempotencyKey` is used, it will return the existing result without processing again. This prevents duplicate transactions.

## Error Handling

The API includes comprehensive error handling:

1. **Input Validation**: All required fields are validated
2. **User/Owner Existence**: Checks if user and owner exist
3. **Role Validation**: Ensures owner has OWNER role
4. **Balance Validation**: Checks sufficient balance before processing
5. **Transaction Safety**: All operations are in a database transaction
6. **Optimistic Locking**: Prevents concurrent modification issues

## Postman Testing

The Postman collection includes:

1. **Release Charging Amount** - Basic endpoint test
2. **Scenario 3: Release Charging Amount Flow** - Complete flow test:
   - Check wallets before
   - Release charging amount
   - Verify wallets after
3. **Scenario 4: Error Handling - Insufficient Balance** - Error scenario test

### Test Data

```json
{
  "userId": "your-user-id",
  "ownerId": "your-owner-id",
  "amount": 500.00,
  "commissionRate": 2.0,
  "transactionId": "TXN_TEST_001",
  "idempotencyKey": "release_test_001"
}
```

## Security Considerations

- All operations require authentication (via auth token)
- User can only release their own charging amounts
- Admin can release for any user
- All amounts are validated and checked
- Database transactions ensure atomicity
- Optimistic locking prevents race conditions

## Notes

- Minimum wallet balance is 0 (no negative balances)
- All amounts are in LKR (Sri Lankan Rupees)
- Commission rate is configurable (default: 2%)
- All wallet balances are updated atomically
- Ledger entries are created for audit trail





