# Mobile release and backend compatibility runbook

## What this backend supports

- A released app that sends no compatibility headers starts new sessions in
  `LEGACY_FLAT` mode. Its session rate is locked to the station base rate and
  is returned through the existing `pricePerKwh` field.
- A new app opts in to time-of-use pricing by sending
  `X-Client-Capabilities: tou-pricing`. Add `membership-pricing` only when the
  app displays the discounted live rate.
- A session stores its rate decision at charger-confirmed start. Existing
  sessions created before this release keep their current billing behaviour.

## New-app request headers (required for TOU)

Add these headers once in the shared HTTP client of the new app. Do not add
them to the old release branch.

```text
X-App-Version: <the app version shown to users, for example 1.0.4>
X-App-Platform: android | ios
X-Client-Capabilities: tou-pricing,membership-pricing
```

If the headers are not present, the backend deliberately uses legacy flat
pricing. This is safe, but the new app will not receive TOU pricing until the
headers are included.

## Production .env additions

Add these values to the backend production `.env`. Keep all existing secrets
and connection settings unchanged.

```dotenv
# Compatibility flags
LEGACY_CLIENT_COMPATIBILITY=true
ENABLE_TOU_FOR_LEGACY_CLIENTS=false
ENABLE_TOU_FOR_CAPABLE_CLIENTS=true
ENABLE_MEMBERSHIP_PRICING=true

# Used only if the AppConfig database row does not already exist.
# Replace 1.0.4 with the exact public app version for each store.
APP_CONFIG_DEFAULT_LATEST_ANDROID_VERSION=1.0.4
APP_CONFIG_DEFAULT_LATEST_IOS_VERSION=1.0.4
APP_CONFIG_DEFAULT_MIN_ANDROID_VERSION=1.0.4
APP_CONFIG_DEFAULT_MIN_IOS_VERSION=1.0.4
```

`APP_CONFIG` values are normally stored in the database, so updating `.env`
does not overwrite an existing configuration row.

## Safe release order

1. Build the new Android and iOS apps with the headers above, and upload them
   to Play Console/App Store Connect as drafts or closed/internal testing. Do
   not make them public yet.
2. Before a backend restart, choose a window with no active charging sessions.
   A restart should never be performed while a real charger is actively
   charging.
3. Turn maintenance mode on through the existing authenticated admin endpoint:

   ```http
   PUT /api/app-config/edit
   Authorization: Bearer <admin Firebase ID token>
   Content-Type: application/json

   {
     "latestAndroidVersion": "1.0.4",
     "latestIosVersion": "1.0.4",
     "minAndroidVersion": "1.0.4",
     "minIosVersion": "1.0.4",
     "forceUpdate": true,
     "maintenanceMode": true,
     "maintenanceMessage": "We are improving Lanka EV Plus. Please try again shortly.",
     "androidStoreUrl": "<Google Play URL>",
     "iosStoreUrl": "<App Store URL>"
   }
   ```

   Use the exact version strings sent by the mobile app. Keep the previous
   version in `latest*`/`min*` until the new store build is actually approved.
4. Take a verified database backup. Confirm the backend Git revision and
   `.env` additions above on the server.
5. Stop the backend process cleanly, then run the deployment commands from the
   backend directory:

   ```bash
   npm ci
   npx prisma generate
   npx prisma migrate deploy
   npm start
   ```

   Use the normal process manager command in place of `npm start` (for
   example, PM2/systemd/Docker) if that is how production runs. Stopping the
   service first also avoids a Windows Prisma engine file lock.
6. Verify `/health/detailed`, then test with a real charger and both app
   builds:
   - old app: starts a session at a single base rate and displays the same
     rate returned by the backend;
   - new app: sends capabilities, displays the active TOU tier and the
     membership-discounted rate when applicable;
   - stop, finishing, wallet settlement, history, and app relaunch;
   - a charge crossing a TOU boundary.
7. Keep maintenance mode on while the stores complete review. When both store
   builds are approved, first set the AppConfig versions and store URLs, then
   release the builds publicly and set `maintenanceMode` to `false`.
8. Keep `forceUpdate=true` and the minimum versions set to the new release
   until the old incompatible app is no longer allowed to start sessions.

## Rollback

If a TOU-capable client has an unexpected issue, leave the migration in place
and set `ENABLE_TOU_FOR_CAPABLE_CLIENTS=false`, then restart the backend.
New sessions revert to the safe legacy flat mode. Do not delete or roll back
the additive database columns. Sessions already started retain their saved
pricing decision.
