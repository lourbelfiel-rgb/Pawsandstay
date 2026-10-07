-- Paws & Stay database (MySQL 5.7+ / MariaDB 10.3+)
-- Import this once in phpMyAdmin (Import tab) or run: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS pawsandstay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pawsandstay;

CREATE TABLE IF NOT EXISTS services (
  id    INT UNSIGNED NOT NULL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,
  price INT UNSIGNED NOT NULL,
  descr VARCHAR(255) NOT NULL,
  art   VARCHAR(30)  NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(190) NOT NULL,
  phone      VARCHAR(20)  NOT NULL,
  address    VARCHAR(255) NOT NULL,
  pw_hash    VARCHAR(255) NOT NULL,
  created_at DATETIME     NOT NULL,           -- stored in UTC
  UNIQUE KEY uq_users_email (email)           -- case-insensitive collation
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admins (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(190) NOT NULL,
  pw_hash    VARCHAR(255) NOT NULL,
  created_at DATETIME     NOT NULL,
  UNIQUE KEY uq_admins_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  service_id      INT UNSIGNED NULL,             -- primary/legacy service reference
  price           INT UNSIGNED NULL,             -- legacy price reference
  total_price     INT UNSIGNED NOT NULL DEFAULT 0,
  date            DATE         NOT NULL,
  time            TIME         NOT NULL,
  notes           VARCHAR(500) NOT NULL DEFAULT '',
  payment_method  VARCHAR(20)  NOT NULL DEFAULT 'Cash',
  payment_status  VARCHAR(30)  NOT NULL DEFAULT 'Pending',
  gcash_reference VARCHAR(100) NULL,
  payment_receipt VARCHAR(255) NULL,
  status          VARCHAR(30)  NOT NULL DEFAULT 'Pending Confirmation',
  client_notified TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL,
  confirmed_at    DATETIME     NULL,
  cancelled_at    DATETIME     NULL,
  cancelled_by    ENUM('client','admin') NULL,
  KEY idx_bookings_user (user_id),
  KEY idx_bookings_status (status),
  KEY idx_bookings_date (date),
  KEY idx_bookings_confirmed (confirmed_at),
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_services (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id    INT UNSIGNED NOT NULL,
  service_id    INT UNSIGNED NOT NULL,
  service_price INT UNSIGNED NOT NULL,
  KEY idx_bs_booking (booking_id),
  KEY idx_bs_service (service_id),
  CONSTRAINT fk_bs_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_bs_service FOREIGN KEY (service_id) REFERENCES services(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id       INT UNSIGNED NOT NULL,
  user_id          INT UNSIGNED NOT NULL,
  payment_method   VARCHAR(20) NOT NULL,
  amount           INT UNSIGNED NOT NULL,
  payment_status   VARCHAR(30) NOT NULL DEFAULT 'Pending',
  gcash_reference  VARCHAR(15) NULL,
  payment_date     DATETIME NULL,
  created_at       DATETIME NOT NULL,
  updated_at       DATETIME NOT NULL,
  UNIQUE KEY uq_payments_booking (booking_id),
  KEY idx_payments_user (user_id),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refunds (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id         INT UNSIGNED NOT NULL,
  payment_id         INT UNSIGNED NOT NULL,
  user_id            INT UNSIGNED NOT NULL,
  refund_amount      INT UNSIGNED NOT NULL DEFAULT 0,
  gcash_reference    VARCHAR(15) NULL,
  reason             VARCHAR(1000) NOT NULL,
  client_message     VARCHAR(1000) NOT NULL DEFAULT '',
  status             ENUM('Pending','Accepted','Rejected','Cancelled','Processing','Refunded') NOT NULL DEFAULT 'Pending',
  admin_note         VARCHAR(1000) NOT NULL DEFAULT '',
  requested_at       DATETIME NOT NULL,
  approved_at        DATETIME NULL,
  updated_at         DATETIME NOT NULL,
  processed_at       DATETIME NULL,
  processed_by       INT UNSIGNED NULL,
  refunded_at        DATETIME NULL,
  client_seen_status VARCHAR(20) NULL,
  KEY idx_refunds_booking (booking_id),
  KEY idx_refunds_payment (payment_id),
  KEY idx_refunds_user (user_id),
  KEY idx_refunds_status (status),
  KEY idx_refunds_processed_by (processed_by),
  CONSTRAINT fk_refunds_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_refunds_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_refunds_admin FOREIGN KEY (processed_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_schema_versions (
  version    INT UNSIGNED NOT NULL PRIMARY KEY,
  applied_at DATETIME     NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS logins (
  id      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  at      DATETIME     NOT NULL,
  KEY idx_logins_at (at),
  CONSTRAINT fk_logins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Failed-login log, used to slow down password guessing
CREATE TABLE IF NOT EXISTS login_attempts (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip    VARCHAR(45)  NOT NULL,
  email VARCHAR(190) NOT NULL,
  at    DATETIME     NOT NULL,
  KEY idx_attempts (ip, email, at)
) ENGINE=InnoDB;

INSERT INTO services (id, name, price, descr, art) VALUES
  (1, 'Home Safety Audit',      800,  'Room-by-room walkthrough to flag pet hazards, with a written report.', 'audit'),
  (2, 'Pet-Proof Installation', 1500, 'Safety gates, cat balconies, or non-slip flooring, installed.',       'proof'),
  (3, 'Camera Setup',           1500, 'Pet-facing camera installed and linked to your phone.',               'camera'),
  (4, 'In-Home Pet Sitting',    600,  'Feeding, walks, and playtime at your pet''s own home.',               'sitting'),
  (5, 'Pet Wellness Check',     350,  'Daily health check with a same-day update.',                          'wellness')
ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), descr = VALUES(descr), art = VALUES(art);
