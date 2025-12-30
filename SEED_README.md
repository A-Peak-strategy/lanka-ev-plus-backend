# Database Seeding Guide

This guide explains how to seed your database with dummy data for development and testing.

## 📋 What Gets Created

The seed script creates:

- **1 Admin User** - System administrator
- **8 Owner Users** - Station owners
- **50 Consumer Users** - With wallets containing random balances (LKR 500-5,000)
- **10 Charging Stations** - Distributed across different owners
- **~25 Chargers** - 2-4 chargers per station with connectors
- **3 Pricing Plans** - Standard, Premium, and Economy rates

## 🚀 Quick Start

### Step 1: Seed the Database

```bash
npm run db:seed
```

This will:
- Clear existing data (optional, can be disabled)
- Create all users, stations, chargers, and pricing
- Generate `SEED_CREDENTIALS.json` with all passwords

### Step 2: View Credentials

```bash
npm run db:credentials
```

This displays all user credentials in a formatted, readable table.

### Step 3: Create Firebase Users (Optional but Recommended)

The seed script creates database records, but **Firebase users must be created separately**.

#### Option A: Automatic (via Firebase Admin SDK)

```bash
npm run db:seed:firebase
```

**Prerequisites:**
- `FIREBASE_SERVICE_ACCOUNT` must be set in `.env`
- Format: `FIREBASE_SERVICE_ACCOUNT='{"projectId":"...","privateKey":"...","clientEmail":"..."}'`

#### Option B: Manual (via Firebase Console)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Navigate to Authentication → Users
3. Click "Add User" for each user listed in `SEED_CREDENTIALS.json`

## 📄 Credentials File

After seeding, `SEED_CREDENTIALS.json` contains:

```json
{
  "generatedAt": "2024-01-15T10:30:00.000Z",
  "admin": {
    "email": "admin@echarge.com",
    "password": "Admin@123",
    "firebaseUid": "...",
    "userId": "..."
  },
  "owners": [...],
  "consumers": [...]
}
```

## 🔐 Default Credentials Summary

### Admin User
- **Email:** `admin@echarge.com`
- **Password:** `Admin@123`
- **Role:** ADMIN

### Owner Users
| # | Email | Password | Name |
|---|-------|----------|------|
| 1 | owner1@stations.com | Owner1@123 | Colombo City Stations |
| 2 | owner2@stations.com | Owner2@123 | Kandy EV Network |
| 3 | owner3@stations.com | Owner3@123 | Galle Coast Charging |
| 4 | owner4@stations.com | Owner4@123 | Negombo Express |
| 5 | owner5@stations.com | Owner5@123 | Jaffna Northern Power |
| 6 | owner6@stations.com | Owner6@123 | Matara South Charge |
| 7 | owner7@stations.com | Owner7@123 | Anuradhapura Heritage |
| 8 | owner8@stations.com | Owner8@123 | Ratnapura Gem Stations |

### Consumer Users
- **Email Pattern:** `user1@example.com`, `user2@example.com`, ... `user50@example.com`
- **Password Pattern:** `User01@123`, `User02@123`, ... `User50@123`
- Each consumer has a wallet with a random balance (LKR 500-5,000)

**Example:**
- User 1: `user1@example.com` / `User01@123`
- User 2: `user2@example.com` / `User02@123`
- ...
- User 50: `user50@example.com` / `User50@123`

## 📍 Station Locations

The seed creates 10 stations across Sri Lanka:

1. **Colombo Fort Central** - Fort, Colombo 01
2. **Bambalapitiya Station** - Galle Road, Colombo 04
3. **Kandy City Center** - Temple Street, Kandy
4. **Kandy Railway Station** - Railway Station Road, Kandy
5. **Galle Fort Charging** - Fort Area, Galle
6. **Negombo Airport Hub** - Near BIA, Negombo
7. **Jaffna Central** - Jaffna Town
8. **Matara Beach Station** - Beach Road, Matara
9. **Anuradhapura Sacred** - Near Temple, Anuradhapura
10. **Ratnapura Gem City** - Main Street, Ratnapura

## 💰 Pricing Plans

1. **Standard Rate** - LKR 50/kWh (Default)
2. **Premium Rate** - LKR 65/kWh
3. **Economy Rate** - LKR 40/kWh

All plans have:
- Commission: 2%
- Grace Period: 45-90 seconds
- Low Balance Threshold: LKR 75-150

## 🔌 Chargers

Each station has 2-4 chargers with:
- Various vendors (ABB, Schneider, Tesla, ChargePoint, Delta)
- Serial numbers (SN-000001, SN-000002, etc.)
- Unique charger IDs (CP001, CP002, etc.)
- 1-2 connectors per charger

## ⚠️ Important Notes

1. **Firebase Users:** The seed creates database records, but Firebase Authentication users must be created separately (see Step 3 above).

2. **Password Policy:** All passwords follow this pattern:
   - At least 8 characters
   - Contains uppercase, lowercase, number, and special character
   - Format: `{Role}{Number}@123` or similar

3. **Data Clearing:** The seed script clears existing data by default. Comment out the deletion section in `prisma/seed.js` if you want to keep existing data.

4. **Firebase UIDs:** The seed generates placeholder Firebase UIDs. When creating Firebase users, use the UIDs from `SEED_CREDENTIALS.json` to match database records.

## 🧪 Testing with Seeded Data

After seeding, you can:

1. **Test Admin Panel:**
   - Login with `admin@echarge.com` / `Admin@123`
   - View all stations, chargers, users, and sessions

2. **Test Mobile App:**
   - Login with any consumer account (e.g., `user1@example.com` / `User01@123`)
   - View wallet balance
   - Browse stations
   - Create bookings
   - Start charging sessions

3. **Test Owner Features:**
   - Login with any owner account (e.g., `owner1@stations.com` / `Owner1@123`)
   - View owned stations
   - Check earnings

## 🔄 Resetting the Database

To reset and reseed:

```bash
# Reset database and run migrations
npm run db:reset

# Seed again
npm run db:seed
```

## 📝 Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run db:seed` | Run the seed script |
| `npm run db:credentials` | View all credentials |
| `npm run db:seed:firebase` | Create Firebase users |
| `npm run db:reset` | Reset database (migrations + optional seed) |

## 🐛 Troubleshooting

### Error: "Failed to read SEED_CREDENTIALS.json"
- Run `npm run db:seed` first to generate the file

### Error: "Firebase Admin not configured"
- Set `FIREBASE_SERVICE_ACCOUNT` in `.env`
- Or create users manually in Firebase Console

### Error: "User already exists"
- The script skips existing users automatically
- Delete users in Firebase Console if you want to recreate them

## 📚 Related Files

- `prisma/seed.js` - Main seed script
- `scripts/createFirebaseUsers.js` - Firebase user creation helper
- `scripts/viewCredentials.js` - Credentials viewer
- `SEED_CREDENTIALS.json` - Generated credentials file (gitignored)

---

**⚠️ Security Warning:** These credentials are for development/testing only. Never commit `SEED_CREDENTIALS.json` to version control or use these passwords in production!

