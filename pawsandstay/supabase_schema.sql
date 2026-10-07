-- =====================================================================
-- Paws & Stay - Supabase PostgreSQL Schema
-- =====================================================================
-- How to apply:
-- 1. Open your Supabase Dashboard (https://supabase.com/dashboard)
-- 2. Select your project and navigate to "SQL Editor" in the left sidebar.
-- 3. Click "New query", paste the entire contents of this file, and click "Run".
-- =====================================================================

-- 1. Services Catalog Table
CREATE TABLE IF NOT EXISTS services (
  id    INTEGER PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,
  price INTEGER NOT NULL,
  descr VARCHAR(255) NOT NULL,
  art   VARCHAR(30)  NOT NULL
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(190) NOT NULL,
  phone      VARCHAR(20)  NOT NULL,
  address    VARCHAR(255) NOT NULL,
  pw_hash    VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (LOWER(email));

-- 3. Administrators Table
CREATE TABLE IF NOT EXISTS admins (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(190) NOT NULL,
  pw_hash    VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admins_email ON admins (LOWER(email));

-- 4. Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id      INTEGER      NULL REFERENCES services(id) ON DELETE SET NULL,
  price           INTEGER      NULL,
  total_price     INTEGER      NOT NULL DEFAULT 0,
  date            DATE         NOT NULL,
  time            TIME         NOT NULL,
  notes           VARCHAR(500) NOT NULL DEFAULT '',
  payment_method  VARCHAR(20)  NOT NULL DEFAULT 'Cash',
  payment_status  VARCHAR(30)  NOT NULL DEFAULT 'Pending',
  gcash_reference VARCHAR(100) NULL,
  payment_receipt VARCHAR(255) NULL,
  status          VARCHAR(30)  NOT NULL DEFAULT 'Pending Confirmation',
  client_notified SMALLINT     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL,
  confirmed_at    TIMESTAMPTZ  NULL,
  cancelled_at    TIMESTAMPTZ  NULL,
  cancelled_by    VARCHAR(20)  NULL CHECK (cancelled_by IN ('client', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (date);
CREATE INDEX IF NOT EXISTS idx_bookings_confirmed ON bookings (confirmed_at);

-- 5. Booking Services Junction Table (Multi-service appointments)
CREATE TABLE IF NOT EXISTS booking_services (
  id            SERIAL PRIMARY KEY,
  booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id    INTEGER NOT NULL REFERENCES services(id),
  service_price INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bs_booking ON booking_services (booking_id);
CREATE INDEX IF NOT EXISTS idx_bs_service ON booking_services (service_id);

-- 6. Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id              SERIAL PRIMARY KEY,
  booking_id      INTEGER     NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  user_id         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_method  VARCHAR(20) NOT NULL,
  amount          INTEGER     NOT NULL,
  payment_status  VARCHAR(30) NOT NULL DEFAULT 'Pending',
  gcash_reference VARCHAR(15) NULL,
  payment_date    TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id);

-- 7. Refunds Table
CREATE TABLE IF NOT EXISTS refunds (
  id                 SERIAL PRIMARY KEY,
  booking_id         INTEGER       NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_id         INTEGER       NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  user_id            INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refund_amount      INTEGER       NOT NULL DEFAULT 0,
  gcash_reference    VARCHAR(15)   NULL,
  reason             VARCHAR(1000) NOT NULL,
  client_message     VARCHAR(1000) NOT NULL DEFAULT '',
  status             VARCHAR(20)   NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Accepted','Rejected','Cancelled','Processing','Refunded')),
  admin_note         VARCHAR(1000) NOT NULL DEFAULT '',
  requested_at       TIMESTAMPTZ   NOT NULL,
  approved_at        TIMESTAMPTZ   NULL,
  updated_at         TIMESTAMPTZ   NOT NULL,
  processed_at       TIMESTAMPTZ   NULL,
  processed_by       INTEGER       NULL REFERENCES admins(id) ON DELETE SET NULL,
  refunded_at        TIMESTAMPTZ   NULL,
  client_seen_status VARCHAR(20)   NULL
);

CREATE INDEX IF NOT EXISTS idx_refunds_booking ON refunds (booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_user ON refunds (user_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds (status);
CREATE INDEX IF NOT EXISTS idx_refunds_processed_by ON refunds (processed_by);

-- 8. Schema Versions Table
CREATE TABLE IF NOT EXISTS app_schema_versions (
  version    INTEGER     NOT NULL PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL
);

-- 9. Login History Table
CREATE TABLE IF NOT EXISTS logins (
  id      SERIAL PRIMARY KEY,
  user_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logins_at ON logins (at);

-- 10. Rate Limiting / Failed Login Attempts Table
CREATE TABLE IF NOT EXISTS login_attempts (
  id    SERIAL PRIMARY KEY,
  ip    VARCHAR(45)  NOT NULL,
  email VARCHAR(190) NOT NULL,
  at    TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts (ip, email, at);

-- =====================================================================
-- Seed Data & Schema Version Initialization
-- =====================================================================

INSERT INTO services (id, name, price, descr, art) VALUES
  (1, 'Home Safety Audit',      800,  'Room-by-room walkthrough to flag pet hazards, with a written report.', 'audit'),
  (2, 'Pet-Proof Installation', 1500, 'Safety gates, cat balconies, or non-slip flooring, installed.',       'proof'),
  (3, 'Camera Setup',           1500, 'Pet-facing camera installed and linked to your phone.',               'camera'),
  (4, 'In-Home Pet Sitting',    600,  'Feeding, walks, and playtime at your pet''s own home.',               'sitting'),
  (5, 'Pet Wellness Check',     350,  'Daily health check with a same-day update.',                          'wellness')
ON CONFLICT (id) DO UPDATE SET
  name  = EXCLUDED.name,
  price = EXCLUDED.price,
  descr = EXCLUDED.descr,
  art   = EXCLUDED.art;

INSERT INTO app_schema_versions (version, applied_at)
VALUES (7, NOW() AT TIME ZONE 'UTC')
ON CONFLICT (version) DO NOTHING;

