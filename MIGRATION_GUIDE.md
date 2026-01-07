# Database Migration Guide

## Adding Payment Model

After updating the Prisma schema with the Payment model, run the migration:

```bash
# Generate migration
npx prisma migrate dev --name add_payment_model

# Or if you want to create it manually
npx prisma migrate dev --create-only --name add_payment_model
```

This will:
1. Create a new migration file
2. Apply the migration to your database
3. Regenerate Prisma Client

## Verify Migration

After migration, verify the Payment table was created:

```bash
# Check database
npx prisma studio
```

Or check via SQL:
```sql
DESCRIBE Payment;
```

## Rollback (if needed)

If you need to rollback:

```bash
npx prisma migrate reset
```

**Warning:** This will delete all data in your database!

## Environment Setup

Make sure to add these environment variables to your `.env` file:

```env
# PayHere Configuration
PAYHERE_MERCHANT_ID=your_merchant_id_here
PAYHERE_MERCHANT_SECRET=your_merchant_secret_here
PAYHERE_SANDBOX=true

# Application URLs
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

## Testing

After migration, test the integration:

1. Import `postman_payhere_collection.json` into Postman
2. Set environment variables in Postman
3. Run the "Complete Payment Flow" test scenario





