<?php
declare(strict_types=1);
/* ============ Paws & Stay API (PHP 8+ / MySQL via PDO) ============
   The website calls:  api.php?r=/bookings   api.php?r=/login   etc. */
require __DIR__ . '/config.php';
date_default_timezone_set(APP_TZ);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$requestScheme = $https ? 'https' : 'http';
$requestPort = (int) ($_SERVER['SERVER_PORT'] ?? ($https ? 443 : 80));
if (isset($_SERVER['HTTP_ORIGIN'])) {
    $origin = parse_url($_SERVER['HTTP_ORIGIN']);
    $requestHost = parse_url('//' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST);
    if (is_array($origin) && isset($origin['scheme'], $origin['host'])
        && strtolower($origin['scheme']) === $requestScheme
        && $requestHost && strcasecmp($origin['host'], $requestHost) === 0
        && (int) ($origin['port'] ?? ($requestScheme === 'https' ? 443 : 80)) === $requestPort) {
        header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
        header('Vary: Origin');
    }
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

class HttpError extends Exception {
    public function __construct(public int $status, string $msg) { parent::__construct($msg); }
}
function bad(string $m): HttpError { return new HttpError(400, $m); }
function out(array $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/* ---------- database ---------- */
function ensureSchema(PDO $p): void {
    static $done = false;
    if ($done) return;
    if (defined('DB_DRIVER') && DB_DRIVER === 'pgsql') {
        $done = true;
        return;
    }
    try {
        $p->exec("
            CREATE TABLE IF NOT EXISTS app_schema_versions (
              version INT UNSIGNED NOT NULL PRIMARY KEY,
              applied_at DATETIME NOT NULL
            ) ENGINE=InnoDB
        ");
        if ((int) $p->query('SELECT COALESCE(MAX(version), 0) FROM app_schema_versions')->fetchColumn() >= 7) {
            $done = true;
            return;
        }
        $p->exec("
            CREATE TABLE IF NOT EXISTS booking_services (
              id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
              booking_id INT UNSIGNED NOT NULL,
              service_id INT UNSIGNED NOT NULL,
              service_price INT UNSIGNED NOT NULL,
              KEY idx_bs_booking (booking_id),
              KEY idx_bs_service (service_id)
            ) ENGINE=InnoDB;
        ");

        $cols = $p->query("SHOW COLUMNS FROM bookings")->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('total_price', $cols, true)) {
            $p->exec("ALTER TABLE bookings ADD COLUMN total_price INT UNSIGNED NOT NULL DEFAULT 0");
            $p->exec("UPDATE bookings SET total_price = price WHERE total_price = 0");
        }
        if (!in_array('payment_method', $cols, true)) {
            $p->exec("ALTER TABLE bookings ADD COLUMN payment_method VARCHAR(20) NOT NULL DEFAULT 'Cash'");
        }
        if (!in_array('payment_status', $cols, true)) {
            $p->exec("ALTER TABLE bookings ADD COLUMN payment_status VARCHAR(30) NOT NULL DEFAULT 'Pending'");
        }
        if (!in_array('gcash_reference', $cols, true)) {
            $p->exec("ALTER TABLE bookings ADD COLUMN gcash_reference VARCHAR(100) NULL");
        }
        if (!in_array('payment_receipt', $cols, true)) {
            $p->exec("ALTER TABLE bookings ADD COLUMN payment_receipt VARCHAR(255) NULL");
        }
        if (!in_array('client_notified', $cols, true)) {
            $p->exec("ALTER TABLE bookings ADD COLUMN client_notified TINYINT(1) NOT NULL DEFAULT 0");
        }
        // Ensure status column accommodates 'Pending Confirmation'
        $p->exec("ALTER TABLE bookings MODIFY COLUMN status VARCHAR(30) NOT NULL DEFAULT 'Pending Confirmation'");
        $p->exec("UPDATE bookings SET status = 'Pending Confirmation' WHERE status = 'Pending'");

        // Backfill booking_services for any existing bookings lacking entries
        $p->exec("
            INSERT INTO booking_services (booking_id, service_id, service_price)
            SELECT id, service_id, price FROM bookings
            WHERE service_id IS NOT NULL AND id NOT IN (SELECT DISTINCT booking_id FROM booking_services)
        ");
        $p->exec("
            CREATE TABLE IF NOT EXISTS payments (
              id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
              booking_id INT UNSIGNED NOT NULL,
              user_id INT UNSIGNED NOT NULL,
              payment_method VARCHAR(20) NOT NULL,
              amount INT UNSIGNED NOT NULL,
              payment_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
              gcash_reference VARCHAR(15) NULL,
              payment_date DATETIME NULL,
              created_at DATETIME NOT NULL,
              updated_at DATETIME NOT NULL,
              UNIQUE KEY uq_payments_booking (booking_id),
              KEY idx_payments_user (user_id),
              CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
              CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB
        ");
        $p->exec("
            INSERT INTO payments (booking_id, user_id, payment_method, amount, payment_status, gcash_reference, payment_date, created_at, updated_at)
            SELECT b.id, b.user_id, b.payment_method, COALESCE(b.total_price, b.price, 0), b.payment_status,
                   CASE WHEN b.gcash_reference REGEXP '^[0-9]{15}$' THEN b.gcash_reference ELSE NULL END,
                   CASE WHEN b.payment_status IN ('Paid', 'Confirmed') THEN b.created_at ELSE NULL END,
                   b.created_at, b.created_at
            FROM bookings b
            WHERE NOT EXISTS (SELECT 1 FROM payments pmt WHERE pmt.booking_id = b.id)
        ");
        $p->exec("ALTER TABLE payments MODIFY COLUMN gcash_reference VARCHAR(15) NULL");
        $p->exec("
            CREATE TABLE IF NOT EXISTS refunds (
              id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
              booking_id INT UNSIGNED NOT NULL,
              payment_id INT UNSIGNED NOT NULL,
              user_id INT UNSIGNED NOT NULL,
              refund_amount INT UNSIGNED NOT NULL DEFAULT 0,
              gcash_reference VARCHAR(15) NULL,
              reason VARCHAR(1000) NOT NULL,
              client_message VARCHAR(1000) NOT NULL DEFAULT '',
              status ENUM('Pending','Accepted','Approved','Rejected','Cancelled','Processing','Refunded') NOT NULL DEFAULT 'Pending',
              admin_note VARCHAR(1000) NOT NULL DEFAULT '',
              requested_at DATETIME NOT NULL,
              approved_at DATETIME NULL,
              updated_at DATETIME NOT NULL,
              processed_at DATETIME NULL,
              processed_by INT UNSIGNED NULL,
              refunded_at DATETIME NULL,
              client_seen_status VARCHAR(20) NULL,
              KEY idx_refunds_booking (booking_id),
              KEY idx_refunds_payment (payment_id),
              KEY idx_refunds_user (user_id),
              KEY idx_refunds_status (status),
              CONSTRAINT fk_refunds_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
              CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
              CONSTRAINT fk_refunds_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              CONSTRAINT fk_refunds_admin FOREIGN KEY (processed_by) REFERENCES admins(id) ON DELETE SET NULL
            ) ENGINE=InnoDB
        ");
        $refundCols = $p->query("SHOW COLUMNS FROM refunds")->fetchAll(PDO::FETCH_COLUMN);
        $refundMigrations = [
            'refund_amount' => 'ALTER TABLE refunds ADD COLUMN refund_amount INT UNSIGNED NOT NULL DEFAULT 0',
            'gcash_reference' => 'ALTER TABLE refunds ADD COLUMN gcash_reference VARCHAR(15) NULL',
            'client_message' => "ALTER TABLE refunds ADD COLUMN client_message VARCHAR(1000) NOT NULL DEFAULT ''",
            'approved_at' => 'ALTER TABLE refunds ADD COLUMN approved_at DATETIME NULL',
            'processed_by' => 'ALTER TABLE refunds ADD COLUMN processed_by INT UNSIGNED NULL',
            'refunded_at' => 'ALTER TABLE refunds ADD COLUMN refunded_at DATETIME NULL',
            'client_seen_status' => 'ALTER TABLE refunds ADD COLUMN client_seen_status VARCHAR(20) NULL'
        ];
        foreach ($refundMigrations as $column => $sql) {
            if (!in_array($column, $refundCols, true)) $p->exec($sql);
        }
        $p->exec("ALTER TABLE refunds MODIFY COLUMN status
                  ENUM('Pending','Accepted','Approved','Cancelled','Processing','Refunded','Rejected') NOT NULL DEFAULT 'Pending'");
        $p->exec("UPDATE refunds SET status='Accepted' WHERE status='Approved'");
        $p->exec("ALTER TABLE refunds MODIFY COLUMN status
                  ENUM('Pending','Accepted','Rejected','Cancelled','Processing','Refunded') NOT NULL DEFAULT 'Pending'");
        $p->exec("UPDATE refunds r JOIN payments pmt ON pmt.id = r.payment_id
                  SET r.refund_amount = pmt.amount, r.gcash_reference = pmt.gcash_reference
                  WHERE r.refund_amount = 0");
        $refundIndexes = $p->query("SHOW INDEX FROM refunds")->fetchAll(PDO::FETCH_COLUMN, 2);
        if (!in_array('idx_refunds_processed_by', $refundIndexes, true)) {
            $p->exec("ALTER TABLE refunds ADD KEY idx_refunds_processed_by (processed_by)");
        }
        $refundForeignKeys = $p->query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
                                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'refunds'
                                          AND COLUMN_NAME = 'processed_by' AND REFERENCED_TABLE_NAME = 'admins'")
                                ->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('fk_refunds_admin', $refundForeignKeys, true)) {
            $p->exec("ALTER TABLE refunds ADD CONSTRAINT fk_refunds_admin
                      FOREIGN KEY (processed_by) REFERENCES admins(id) ON DELETE SET NULL");
        }
    } catch (Throwable $e) {
        throw new RuntimeException('Unable to prepare the MySQL booking, payment, and refund schema.', 0, $e);
    }
    q('INSERT INTO app_schema_versions (version, applied_at) VALUES (7, ?)
       ON DUPLICATE KEY UPDATE applied_at=VALUES(applied_at)', [utcNow()]);
    $done = true;
}

function pdo(): PDO {
    static $p = null;
    if ($p instanceof PDO) {
        return $p;
    }

    $driver = defined('DB_DRIVER') ? strtolower((string)DB_DRIVER) : 'pgsql';

    if ($driver === 'pgsql') {
        if (!extension_loaded('pdo_pgsql')) {
            throw new RuntimeException("PHP extension 'pdo_pgsql' is not enabled. Please enable 'extension=pdo_pgsql' in your php.ini.");
        }

        $dsn = '';
        $user = DB_USER;
        $pass = DB_PASS;

        if (defined('DATABASE_URL') && !empty(DATABASE_URL)) {
            $parts = parse_url(DATABASE_URL);
            if ($parts) {
                $host = $parts['host'] ?? '127.0.0.1';
                $port = $parts['port'] ?? 5432;
                $db = ltrim($parts['path'] ?? '/postgres', '/');
                $user = isset($parts['user']) ? urldecode($parts['user']) : $user;
                $pass = isset($parts['pass']) ? urldecode($parts['pass']) : $pass;
                parse_str($parts['query'] ?? '', $query);
                $sslmode = $query['sslmode'] ?? (defined('DB_SSLMODE') ? DB_SSLMODE : 'require');
                $dsn = "pgsql:host={$host};port={$port};dbname={$db};sslmode={$sslmode}";
            }
        }

        if ($dsn === '') {
            $host = DB_HOST;
            $port = (int) DB_PORT;
            $db = DB_NAME;
            $sslmode = defined('DB_SSLMODE') ? DB_SSLMODE : 'require';
            $dsn = "pgsql:host={$host};port={$port};dbname={$db};sslmode={$sslmode}";
        }

        $p = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return $p;
    }

    // Fallback MySQL connection
    $primaryPort = defined('DB_PORT') ? (int)DB_PORT : 3307;
    $ports = array_values(array_unique([$primaryPort, 3307, 3306]));
    $lastEx = null;
    foreach ($ports as $port) {
        try {
            $p = new PDO('mysql:host=' . DB_HOST . ';port=' . $port . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            ensureSchema($p);
            break;
        } catch (PDOException $e) {
            if ($e->getCode() == 1049 || stripos($e->getMessage(), 'Unknown database') !== false) {
                try {
                    $init = new PDO('mysql:host=' . DB_HOST . ';port=' . $port . ';charset=utf8mb4', DB_USER, DB_PASS, [
                        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    ]);
                    $sqlFile = __DIR__ . '/schema.sql';
                    if (file_exists($sqlFile)) {
                        $init->exec(file_get_contents($sqlFile));
                        $p = new PDO('mysql:host=' . DB_HOST . ';port=' . $port . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
                            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                            PDO::ATTR_EMULATE_PREPARES => false,
                        ]);
                        ensureSchema($p);
                        break;
                    }
                } catch (Throwable $ignore) {}
            }
            $lastEx = $e;
        }
    }
    if (!$p && $lastEx) {
        throw $lastEx;
    }
    return $p;
}

function lastInsertId(PDO $db, string $seq = ''): int {
    $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
    if ($driver === 'pgsql') {
        if ($seq !== '') {
            try {
                $id = $db->lastInsertId($seq);
                if (!empty($id)) return (int) $id;
            } catch (Throwable $ignore) {}
        }
        try {
            $val = $db->query('SELECT LASTVAL()')->fetchColumn();
            if ($val !== false) return (int) $val;
        } catch (Throwable $ignore) {}
    }
    return (int) $db->lastInsertId();
}

function q(string $sql, array $args = []): PDOStatement { $s = pdo()->prepare($sql); $s->execute($args); return $s; }

/* ---------- helpers ---------- */
const FMT = 'Y-m-d H:i:s';
function utcNow(): string { return gmdate(FMT); }                       // all DATETIME columns are stored in UTC
function iso(?string $dt): ?string { return $dt ? str_replace(' ', 'T', $dt) . 'Z' : null; }
function todayStr(): string { return date('Y-m-d'); }                   // in APP_TZ
function str(mixed $v): string { return is_string($v) ? $v : ''; }
function clientIp(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }

function acceptedToday(): int {
    $utc = new DateTimeZone('UTC');
    $start = new DateTime('today', new DateTimeZone(APP_TZ));
    $end = (clone $start)->modify('+1 day');
    $start->setTimezone($utc); $end->setTimezone($utc);
    return (int) q('SELECT COUNT(*) c FROM bookings WHERE confirmed_at >= ? AND confirmed_at < ?', [$start->format(FMT), $end->format(FMT)])->fetch()['c'];
}

/* ---------- sessions (PHP native cookie + Token Bearer support) ---------- */
ini_set('session.gc_maxlifetime', (string) (14 * 86400));
session_set_cookie_params(['lifetime' => 14 * 86400, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
session_name('pawsid');

session_start();

function requireRole(string $role): void {
    if (($_SESSION['role'] ?? null) !== $role) throw new HttpError(401, $role === 'admin' ? 'Admin login required.' : 'Please log in.');
    if ($role === 'admin' && !q('SELECT 1 FROM admins WHERE id=?', [(int) ($_SESSION['id'] ?? 0)])->fetch()) {
        destroySession();
        throw new HttpError(401, 'Admin login required.');
    }
}
function requireAdmin(): void {
    requireRole('admin');
    $expected = str($_SESSION['csrf'] ?? '');
    $provided = str($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if ($expected === '' || !hash_equals($expected, $provided)) {
        throw new HttpError(403, 'The admin session token is missing or expired. Refresh the dashboard and try again.');
    }
}
function startSession(string $role, int $id): void {
    session_regenerate_id(true);
    $_SESSION = ['role' => $role, 'id' => $id];
    if ($role === 'admin') $_SESSION['csrf'] = bin2hex(random_bytes(32));
}
function csrfToken(string $role): string {
    if (($_SESSION['role'] ?? null) !== $role) return '';
    if (!isset($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}
function destroySession(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $params['path'],
            'domain' => $params['domain'],
            'secure' => $params['secure'],
            'httponly' => $params['httponly'],
            'samesite' => $params['samesite'] ?? 'Lax',
        ]);
    }
    session_destroy();
}

/* ---------- login throttle: 10 failed tries / 15 min per ip + email ---------- */
function throttleKey(string $email, bool $admin): string { return substr(($admin ? 'admin|' : '') . $email, 0, 190); }
function checkThrottle(string $key): void {
    q('DELETE FROM login_attempts WHERE at < ?', [gmdate(FMT, time() - 900)]);
    $n = (int) q('SELECT COUNT(*) c FROM login_attempts WHERE ip = ? AND email = ?', [clientIp(), $key])->fetch()['c'];
    if ($n >= 10) throw new HttpError(429, 'Too many attempts. Please try again in a few minutes.');
}
function noteFail(string $key): void { q('INSERT INTO login_attempts (ip, email, at) VALUES (?,?,?)', [clientIp(), $key, utcNow()]); }
function clearFails(string $key): void { q('DELETE FROM login_attempts WHERE ip = ? AND email = ?', [clientIp(), $key]); }

/* ---------- row -> JSON ---------- */
function userJson(array $u): array {
    return ['id' => (int) $u['id'], 'first' => $u['first_name'], 'last' => $u['last_name'], 'email' => $u['email'], 'phone' => $u['phone'], 'address' => $u['address']];
}

function getBookingServicesMap(array $bookingIds): array {
    if (empty($bookingIds)) return [];
    $in = implode(',', array_map('intval', $bookingIds));
    $rows = q("SELECT bs.booking_id, bs.service_id, bs.service_price, s.name 
               FROM booking_services bs 
               JOIN services s ON s.id = bs.service_id 
               WHERE bs.booking_id IN ($in)")->fetchAll();
    $map = [];
    foreach ($rows as $r) {
        $bid = (int) $r['booking_id'];
        $map[$bid][] = [
            'id' => (int) $r['service_id'],
            'name' => $r['name'],
            'price' => (int) $r['service_price']
        ];
    }
    return $map;
}

function bookingJson(array $b, array $servicesMap = []): array {
    $sid = (int) ($b['service_id'] ?? 0);
    $services = $servicesMap[$b['id']] ?? [];
    if (empty($services) && $sid > 0) {
        $svcName = $b['service_name'] ?? ('Service #' . $sid);
        $services = [['id' => $sid, 'name' => $svcName, 'price' => (int) ($b['price'] ?? 0)]];
    }
    $totalPrice = (int) (($b['total_price'] ?? 0) ?: ($b['price'] ?? 0));
    $o = [
        'id' => (int) $b['id'],
        'uid' => (int) $b['user_id'],
        'sid' => $sid,
        'price' => $totalPrice,
        'totalPrice' => $totalPrice,
        'date' => $b['date'],
        'time' => substr($b['time'], 0, 5),
        'notes' => $b['notes'] ?? '',
        'status' => $b['status'],
        'paymentMethod' => $b['payment_method'] ?? 'Cash',
        'paymentStatus' => $b['payment_status'] ?? 'Pending',
        'paymentId' => isset($b['payment_id']) ? (int) $b['payment_id'] : null,
        'paymentDate' => iso($b['payment_date'] ?? null),
        'gcashReference' => $b['gcash_reference'] ?? null,
        'paymentReceipt' => $b['payment_receipt'] ?? null,
        'refundId' => isset($b['refund_id']) ? (int) $b['refund_id'] : null,
        'refundStatus' => $b['refund_status'] ?? null,
        'refundReason' => $b['refund_reason'] ?? null,
        'refundMessage' => $b['refund_message'] ?? null,
        'refundAmount' => isset($b['refund_amount']) ? (int) $b['refund_amount'] : null,
        'refundGcashReference' => $b['refund_gcash_reference'] ?? null,
        'refundAdminNote' => $b['refund_admin_note'] ?? null,
        'refundRequestedAt' => iso($b['refund_requested_at'] ?? null),
        'refundApprovedAt' => iso($b['refund_approved_at'] ?? null),
        'refundProcessedAt' => iso($b['refund_processed_at'] ?? null),
        'refundRefundedAt' => iso($b['refund_refunded_at'] ?? null),
        'refundUpdatedAt' => iso($b['refund_updated_at'] ?? null),
        'refundSeenStatus' => $b['client_seen_status'] ?? null,
        'clientNotified' => (int) ($b['client_notified'] ?? 0),
        'services' => $services,
        'created' => iso($b['created_at']),
        'confirmedAt' => iso($b['confirmed_at'] ?? null),
        'cancelledAt' => iso($b['cancelled_at'] ?? null),
        'cancelledBy' => $b['cancelled_by'] ?? null,
    ];
    if (array_key_exists('first_name', $b)) {
        $o['client'] = [
            'first' => $b['first_name'],
            'last' => $b['last_name'],
            'email' => $b['email'],
            'phone' => $b['phone'],
            'address' => $b['address'] ?? ''
        ];
    }
    return $o;
}

function addAdmin(array $body): array {
    $email = strtolower(trim(str($body['email'] ?? '')));
    $pw = str($body['pw'] ?? '');
    if (!preg_match('/^\S+@\S+\.\S+$/', $email) || strlen($email) > 190) throw bad('Enter a valid email address.');
    if (strlen($pw) < 8 || !preg_match('/\d/', $pw) || !preg_match('/[^a-zA-Z0-9]/', $pw)) {
        throw bad('Password must be at least 8 characters and contain a number and special character.');
    }
    if (isset($body['pw2']) && $pw !== $body['pw2']) throw bad('Passwords do not match.');
    if (q('SELECT 1 FROM admins WHERE email = ?', [$email])->fetch()) throw new HttpError(409, 'That admin email already exists.');
    q('INSERT INTO admins (email, pw_hash, created_at) VALUES (?,?,?)', [$email, password_hash($pw, PASSWORD_DEFAULT), utcNow()]);
    return ['ok' => true];
}

function saveUploadedReceipt(array $file): string {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw bad('File upload failed. Please try again.');
    }
    if ($file['size'] > 5 * 1024 * 1024) {
        throw bad('Receipt image size exceeds 5MB limit.');
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']);
    $allowedMimes = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/jpg' => 'jpg'];
    if (!isset($allowedMimes[$mime])) {
        throw bad('Receipt must be a valid image file (JPG, JPEG, or PNG).');
    }
    $ext = $allowedMimes[$mime];
    $uploadDir = __DIR__ . '/uploads';
    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true) && !is_dir($uploadDir)) {
        throw new RuntimeException('Unable to create the receipt upload directory.');
    }
    $filename = 'receipt_' . date('Ymd_His') . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $target = $uploadDir . '/' . $filename;
    if (!move_uploaded_file($file['tmp_name'], $target)) {
        throw new RuntimeException('Failed to save uploaded receipt. Check the uploads directory permissions.');
    }
    return 'uploads/' . $filename;
}

/* ---------- request ---------- */
function handle(): array {
    $method = $_SERVER['REQUEST_METHOD'];
    $path = '/' . trim(str($_GET['r'] ?? ''), '/');
    $body = [];

    if ($method !== 'GET') {
        $cType = $_SERVER['CONTENT_TYPE'] ?? '';
        if (stripos($cType, 'application/json') !== false) {
            $raw = file_get_contents('php://input');
            if ($raw !== '' && $raw !== false) {
                $body = json_decode($raw, true);
                if (!is_array($body)) throw bad('Invalid JSON.');
            }
        } elseif (!empty($_POST)) {
            $body = $_POST;
        }
    }

    $m = [];
    $is = function (string $verb, string $re) use ($method, $path, &$m): bool {
        return $method === $verb && preg_match('#^' . $re . '$#', $path, $m) === 1;
    };

    /* --- public --- */
    if ($is('GET', '/services')) {
        return ['services' => array_map(fn($s) => ['id' => (int) $s['id'], 'name' => $s['name'], 'price' => (int) $s['price'], 'desc' => $s['descr'], 'art' => $s['art']],
            q('SELECT id, name, price, descr, art FROM services ORDER BY id')->fetchAll())];
    }

    if ($is('PATCH', '/admin/services/(\d+)')) {
        requireAdmin();
        $serviceId = (int) $m[1];
        $name = trim(str($body['name'] ?? ''));
        $description = trim(str($body['desc'] ?? ''));
        $price = filter_var($body['price'] ?? null, FILTER_VALIDATE_INT);
        if ($name === '' || mb_strlen($name) > 100) throw bad('Service name must be between 1 and 100 characters.');
        if ($description === '' || mb_strlen($description) > 255) throw bad('Service description must be between 1 and 255 characters.');
        if ($price === false || $price < 1 || $price > 1000000) throw bad('Service price must be between 1 and 1,000,000.');
        if (!q('SELECT id FROM services WHERE id=?', [$serviceId])->fetch()) {
            throw new HttpError(404, 'Service not found.');
        }
        q('UPDATE services SET name=?, price=?, descr=? WHERE id=?',
            [$name, $price, $description, $serviceId]);
        return ['ok' => true];
    }

    if ($is('GET', '/me')) {
        $role = $_SESSION['role'] ?? null;
        if ($role === 'admin') {
            requireRole('admin');
            return ['role' => 'admin', 'csrf' => csrfToken('admin')];
        }
        if ($role === 'user') {
            $u = q('SELECT * FROM users WHERE id = ?', [$_SESSION['id']])->fetch();
            if ($u) return ['role' => 'user', 'user' => userJson($u)];
        }
        return ['role' => null];
    }

    if ($is('PUT', '/profile')) {
        requireRole('user');
        $first = trim(str($body['first'] ?? ''));
        $last = trim(str($body['last'] ?? ''));
        $phone = trim(str($body['phone'] ?? ''));
        $address = trim(str($body['address'] ?? ''));
        if ($first === '' || $last === '' || $address === '') throw bad('Please complete your name and address.');
        if (mb_strlen($first) > 100 || mb_strlen($last) > 100 || mb_strlen($address) > 255) {
            throw bad('Profile information is too long.');
        }
        if (!preg_match('/^[0-9]{11}$/', $phone)) throw bad('Contact number must contain exactly 11 digits.');
        q('UPDATE users SET first_name=?, last_name=?, phone=?, address=? WHERE id=?',
            [$first, $last, $phone, $address, $_SESSION['id']]);
        $u = q('SELECT * FROM users WHERE id=?', [$_SESSION['id']])->fetch();
        if (!$u) throw new HttpError(404, 'Client profile not found.');
        return ['user' => userJson($u)];
    }

    if ($is('GET', '/availability')) {
        $date = trim(str($_GET['date'] ?? ''));
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $parts)
            || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) {
            throw bad('Invalid date format.');
        }
        $rows = q("SELECT time FROM bookings WHERE date = ? AND status IN ('Pending Confirmation', 'Pending', 'Confirmed')", [$date])->fetchAll();
        $bookedTimes = array_map(fn($r) => substr($r['time'], 0, 5), $rows);
        return [
            'date' => $date,
            'bookedTimes' => array_values(array_unique($bookedTimes)),
            'today' => todayStr(),
            'currentTime' => date('H:i'),
        ];
    }

    if ($is('POST', '/register')) {
        $f = [];
        foreach (['first', 'last', 'phone', 'address'] as $k) $f[$k] = trim(str($body[$k] ?? ''));
        $f['email'] = strtolower(trim(str($body['email'] ?? '')));
        $pw = str($body['pw'] ?? '');
        $pw2 = str($body['pw2'] ?? '');

        foreach ($f as $v) if ($v === '') throw bad('Please fill in all fields.');
        if ($pw === '') throw bad('Please fill in all fields.');
        foreach ($f as $v) if (mb_strlen($v) > 190) throw bad('One of the fields is too long.');
        if (!preg_match('/^\S+@\S+\.\S+$/', $f['email'])) throw bad('Enter a valid email address.');

        // 1. Contact number validation: numbers only, exactly 11 digits
        if (!preg_match('/^\d{11}$/', $f['phone'])) {
            throw bad('Contact number must contain exactly 11 digits.');
        }

        // 2. Password validation: at least 8 chars, 1 number, 1 special char
        if (strlen($pw) < 8 || !preg_match('/\d/', $pw) || !preg_match('/[^a-zA-Z0-9]/', $pw)) {
            throw bad('Password must be at least 8 characters and contain a number and special character.');
        }

        // Confirm password match
        if ($pw !== $pw2) {
            throw bad('Passwords do not match.');
        }

        try {
            q('INSERT INTO users (first_name, last_name, email, phone, address, pw_hash, created_at) VALUES (?,?,?,?,?,?,?)',
                [$f['first'], $f['last'], $f['email'], $f['phone'], $f['address'], password_hash($pw, PASSWORD_DEFAULT), utcNow()]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') throw new HttpError(409, 'That email is already registered.');
            throw $e;
        }
        return ['ok' => true];
    }

    if ($is('POST', '/login')) {
        $email = strtolower(trim(str($body['email'] ?? '')));
        $pw = str($body['pw'] ?? '');
        if ($email === '' || $pw === '') throw bad('Please enter your email and password.');

        $key = throttleKey($email, false);
        checkThrottle($key);

        $u = q('SELECT * FROM users WHERE email = ?', [$email])->fetch();
        if (!$u) {
            noteFail($key);
            throw new HttpError(401, 'Client account not found. Please check your email or create an account.');
        }

        // Verify user password
        if (!password_verify($pw, $u['pw_hash'])) {
            noteFail($key);
            throw new HttpError(401, 'Incorrect password. Please try again.');
        }

        clearFails($key);
        q('INSERT INTO logins (user_id, at) VALUES (?,?)', [$u['id'], utcNow()]);
        $old = q('SELECT id FROM logins ORDER BY id DESC LIMIT 1 OFFSET 999')->fetch();   // keep newest 1000
        if ($old) q('DELETE FROM logins WHERE id <= ?', [$old['id']]);

        startSession('user', (int) $u['id']);
        return ['role' => 'user', 'user' => userJson($u)];
    }

    if ($is('POST', '/admin/login')) {
        $expectedCsrf = str($_SESSION['admin_login_csrf'] ?? '');
        $providedCsrf = str($body['csrf'] ?? '');
        if ($expectedCsrf === '' || !hash_equals($expectedCsrf, $providedCsrf)) {
            throw new HttpError(403, 'This login form has expired. Reload the page and try again.');
        }
        if (!q('SELECT 1 FROM admins LIMIT 1')->fetch()) {
            $bootstrapEmail = strtolower(trim(ADMIN_EMAIL));
            if (!preg_match('/^\S+@\S+\.\S+$/', $bootstrapEmail) || strlen($bootstrapEmail) > 190
                || strlen(ADMIN_PASSWORD) < 12
                || !preg_match('/\d/', ADMIN_PASSWORD)
                || !preg_match('/[^a-zA-Z0-9]/', ADMIN_PASSWORD)) {
                throw new HttpError(503, 'No admin account exists. Configure a valid ADMIN_EMAIL and a strong ADMIN_PASSWORD before first admin login.');
            }
            q('INSERT INTO admins (email, pw_hash, created_at) VALUES (?,?,?)',
                [$bootstrapEmail, password_hash(ADMIN_PASSWORD, PASSWORD_DEFAULT), utcNow()]);
        }
        $email = strtolower(trim(str($body['email'] ?? '')));
        $pw = str($body['pw'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
            throw bad('Enter a valid administrator email address.');
        }
        if ($pw === '' || strlen($pw) > 4096) throw bad('Please enter a valid admin password.');

        $key = throttleKey($email, true);
        checkThrottle($key);

        $a = q('SELECT * FROM admins WHERE email = ?', [$email])->fetch();
        if (!$a) {
            noteFail($key);
            throw new HttpError(401, 'Administrator account not found. Check your admin email or contact the site owner.');
        }
        if (!password_verify($pw, $a['pw_hash'])) {
            noteFail($key);
            throw new HttpError(401, 'Incorrect password. Please try again.');
        }

        clearFails($key);
        startSession('admin', (int) $a['id']);
        return ['role' => 'admin'];
    }

    if ($is('POST', '/logout')) {
        requireRole('user');
        destroySession();
        return ['ok' => true];
    }

    /* --- client --- */
    if ($is('POST', '/upload-receipt')) {
        requireRole('user');
        if (empty($_FILES['receipt']) && empty($_FILES['file'])) {
            throw bad('No file uploaded.');
        }
        $file = $_FILES['receipt'] ?? $_FILES['file'];
        $path = saveUploadedReceipt($file);
        return ['ok' => true, 'path' => $path, 'filename' => basename($path)];
    }

    if ($is('GET', '/bookings')) {
        requireRole('user');
        $rawBookings = q("
            SELECT b.*, p.id AS payment_id, p.payment_date,
                   r.id AS refund_id, r.status AS refund_status, r.reason AS refund_reason,
                   r.client_message AS refund_message, r.refund_amount,
                   r.gcash_reference AS refund_gcash_reference,
                   r.admin_note AS refund_admin_note, r.requested_at AS refund_requested_at,
                   r.approved_at AS refund_approved_at, r.processed_at AS refund_processed_at,
                   r.refunded_at AS refund_refunded_at, r.updated_at AS refund_updated_at,
                   r.client_seen_status
            FROM bookings b
            LEFT JOIN payments p ON p.booking_id = b.id
            LEFT JOIN refunds r ON r.id = (
                SELECT MAX(r2.id) FROM refunds r2 WHERE r2.booking_id = b.id
            )
            WHERE b.user_id = ?
            ORDER BY b.date DESC, b.time DESC, b.id DESC
        ", [$_SESSION['id']])->fetchAll();
        $bids = array_column($rawBookings, 'id');
        $svcMap = getBookingServicesMap($bids);
        return ['bookings' => array_map(fn($b) => bookingJson($b, $svcMap), $rawBookings)];
    }

    if ($is('POST', '/bookings')) {
        requireRole('user');

        // Check for multiple services
        $serviceIds = [];
        if (!empty($body['services']) && is_array($body['services'])) {
            $serviceIds = array_map('intval', $body['services']);
        } elseif (!empty($body['service_ids']) && is_array($body['service_ids'])) {
            $serviceIds = array_map('intval', $body['service_ids']);
        } elseif (!empty($body['sid'])) {
            $serviceIds = [(int) $body['sid']];
        }

        $serviceIds = array_values(array_filter(array_unique($serviceIds), fn($id) => $id > 0));
        if (empty($serviceIds)) throw bad('Please select at least one service.');

        $inClause = implode(',', array_fill(0, count($serviceIds), '?'));
        $foundServices = q("SELECT id, name, price FROM services WHERE id IN ($inClause)", $serviceIds)->fetchAll();
        if (count($foundServices) !== count($serviceIds)) {
            throw bad('One or more selected services are invalid.');
        }

        $totalPrice = (int) array_sum(array_column($foundServices, 'price'));

        // Date and time validation
        $date = str($body['date'] ?? '');
        $time = str($body['time'] ?? '');
        $okDate = preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $d) && checkdate((int) $d[2], (int) $d[3], (int) $d[1]);
        if (!$okDate || $date < todayStr()) throw bad('Choose a valid future date.');
        if (!preg_match('/^\d{2}:\d{2}$/', $time) || $time < '08:00' || $time > '18:00') {
            throw bad('Choose a time between 8:00 AM and 6:00 PM.');
        }
        if ($date === todayStr() && $time <= date('H:i')) {
            throw bad('Choose an appointment time later than the current time.');
        }

        // Check conflict before accepting booking
        $conflict = q("SELECT 1 FROM bookings WHERE date = ? AND (time = ? OR CAST(time AS VARCHAR) LIKE ?) AND status IN ('Pending Confirmation', 'Pending', 'Confirmed')",
            [$date, $time . ':00', $time . '%'])->fetch();
        if ($conflict) {
            throw bad('This time slot is already booked. Please select another time.');
        }

        // Mode of payment
        $paymentMethod = str($body['payment_method'] ?? 'Cash');
        if (!in_array($paymentMethod, ['Cash', 'GCash'], true)) {
            $paymentMethod = 'Cash';
        }

        $gcashRef = null;
        $receiptPath = null;

        if ($paymentMethod === 'GCash') {
            $gcashRef = str($body['gcash_reference'] ?? '');
            if (!preg_match('/^[0-9]{15}$/', $gcashRef)) throw bad('GCash reference number must be exactly 15 digits.');
            $paymentAmount = filter_var($body['payment_amount'] ?? null, FILTER_VALIDATE_INT);
            if ($paymentAmount === false || $paymentAmount === null || $paymentAmount !== $totalPrice) {
                throw bad('Payment amount must match the total for the selected services.');
            }

            if (!empty($_FILES['receipt']) && $_FILES['receipt']['error'] === UPLOAD_ERR_OK) {
                $receiptPath = saveUploadedReceipt($_FILES['receipt']);
            } else {
                $receiptPath = trim(str($body['payment_receipt'] ?? ''));
            }

            if (!$receiptPath
                || !preg_match('#^uploads/receipt_[A-Za-z0-9_-]+\.(?:jpg|png)$#i', $receiptPath)
                || !is_file(__DIR__ . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $receiptPath))) {
                throw bad('Please upload your GCash payment receipt.');
            }
        }

        $notes = mb_substr(trim(str($body['notes'] ?? '')), 0, 500);

        // Optional contact number update/validation if provided
        if (!empty($body['phone'])) {
            $phone = trim(str($body['phone']));
            if (!preg_match('/^\d{11}$/', $phone)) {
                throw bad('Contact number must contain exactly 11 digits.');
            }
            q('UPDATE users SET phone = ? WHERE id = ?', [$phone, $_SESSION['id']]);
        }

        $primaryService = $foundServices[0];
        $db = pdo();
        $db->beginTransaction();
        try {
            q('INSERT INTO bookings (user_id, service_id, price, total_price, date, time, notes, payment_method, payment_status, gcash_reference, payment_receipt, status, client_notified, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
               [$_SESSION['id'], $primaryService['id'], $primaryService['price'], $totalPrice, $date, $time, $notes, $paymentMethod, 'Pending', $gcashRef, $receiptPath, 'Pending Confirmation', 0, utcNow()]);

            $bookingId = lastInsertId($db, 'bookings_id_seq');
            $now = utcNow();
            q('INSERT INTO payments (booking_id, user_id, payment_method, amount, payment_status, gcash_reference, payment_date, created_at, updated_at)
               VALUES (?,?,?,?,?,?,NULL,?,?)',
               [$bookingId, $_SESSION['id'], $paymentMethod, $totalPrice, 'Pending', $gcashRef, $now, $now]);

            foreach ($foundServices as $fs) {
                q('INSERT INTO booking_services (booking_id, service_id, service_price) VALUES (?,?,?)',
                  [$bookingId, $fs['id'], $fs['price']]);
            }
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }

        return ['ok' => true, 'id' => $bookingId, 'status' => 'Pending Confirmation'];
    }

    if ($is('POST', '/bookings/(\d+)/cancel')) {
        requireRole('user');
        $r = q("UPDATE bookings SET status='Cancelled', cancelled_at=?, cancelled_by='client' WHERE id=? AND user_id=? AND status IN ('Pending Confirmation','Pending','Confirmed')",
            [utcNow(), (int) $m[1], $_SESSION['id']]);
        if ($r->rowCount() === 0) throw new HttpError(404, 'Booking not found or cannot be cancelled.');
        return ['ok' => true];
    }

    if ($is('POST', '/bookings/(\d+)/ack-confirm')) {
        requireRole('user');
        $booking = q("SELECT id FROM bookings WHERE id = ? AND user_id = ? AND status = 'Confirmed'",
            [(int) $m[1], $_SESSION['id']])->fetch();
        if (!$booking) throw new HttpError(404, 'Confirmed booking not found.');
        q('UPDATE bookings SET client_notified = 1 WHERE id = ? AND user_id = ?', [(int) $m[1], $_SESSION['id']]);
        return ['ok' => true];
    }

    if ($is('POST', '/bookings/(\d+)/refunds')) {
        requireRole('user');
        $reason = trim(str($body['reason'] ?? ''));
        if ($reason === '' || mb_strlen($reason) > 1000) throw bad('Please provide a refund reason (up to 1000 characters).');
        $message = trim(str($body['message'] ?? ''));
        if (mb_strlen($message) > 1000) throw bad('Additional message must be 1000 characters or fewer.');
        $bookingId = (int) $m[1];
        $db = pdo();
        $db->beginTransaction();
        try {
            $payment = q("
                SELECT p.id, p.amount, p.payment_method, p.payment_status, p.gcash_reference,
                       b.status AS booking_status
                FROM payments p
                JOIN bookings b ON b.id = p.booking_id AND b.user_id = p.user_id
                WHERE p.booking_id = ? AND p.user_id = ?
                FOR UPDATE
            ", [$bookingId, $_SESSION['id']])->fetch();
            if (!$payment) throw new HttpError(404, 'Payment for this booking was not found.');
            if ($payment['payment_method'] !== 'GCash' || $payment['payment_status'] !== 'Paid') {
                throw new HttpError(409, 'A refund can only be requested for a GCash payment marked Paid by an admin.');
            }
            if ($payment['booking_status'] !== 'Confirmed') {
                throw new HttpError(409, 'A refund is only available for a confirmed booking that has not been completed or cancelled.');
            }
            if (!preg_match('/^[0-9]{15}$/', (string) $payment['gcash_reference'])) {
                throw new HttpError(409, 'This payment does not have a valid 15-digit GCash reference number.');
            }
            $active = q("SELECT id FROM refunds WHERE booking_id = ? AND status IN ('Pending','Accepted','Processing','Refunded') ORDER BY id DESC LIMIT 1 FOR UPDATE",
                [$bookingId])->fetch();
            if ($active) throw new HttpError(409, 'A refund request is already active for this booking.');

            $now = utcNow();
            q('INSERT INTO refunds (booking_id, payment_id, user_id, refund_amount, gcash_reference, reason, client_message, status, admin_note, requested_at, updated_at, client_seen_status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
               [$bookingId, $payment['id'], $_SESSION['id'], $payment['amount'], $payment['gcash_reference'], $reason, $message, 'Pending', '', $now, $now, 'Pending']);
            $refundId = lastInsertId($db, 'refunds_id_seq');
            $db->commit();
            return ['ok' => true, 'id' => $refundId, 'status' => 'Pending'];
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }
    }

    if ($is('POST', '/bookings/(\d+)/refunds/ack')) {
        requireRole('user');
        $bookingId = (int) $m[1];
        $r = q("UPDATE refunds SET client_seen_status = status
                WHERE booking_id = ? AND user_id = ? AND id = (
                    SELECT latest.id FROM (
                        SELECT MAX(id) AS id FROM refunds WHERE booking_id = ? AND user_id = ?
                    ) latest
                )", [$bookingId, $_SESSION['id'], $bookingId, $_SESSION['id']]);
        if ($r->rowCount() === 0) throw new HttpError(404, 'Refund request not found.');
        return ['ok' => true];
    }

    /* --- admin --- */
    if ($is('GET', '/admin/data')) {
        requireRole('admin');
        $rawBookings = q("
            SELECT b.*, u.first_name, u.last_name, u.email, u.phone, u.address,
                   p.id AS payment_id, p.payment_date,
                   r.id AS refund_id, r.status AS refund_status, r.reason AS refund_reason,
                   r.client_message AS refund_message, r.refund_amount,
                   r.gcash_reference AS refund_gcash_reference,
                   r.admin_note AS refund_admin_note, r.requested_at AS refund_requested_at,
                   r.approved_at AS refund_approved_at, r.processed_at AS refund_processed_at,
                   r.refunded_at AS refund_refunded_at, r.client_seen_status
            FROM bookings b
            JOIN users u ON u.id = b.user_id
            LEFT JOIN payments p ON p.booking_id = b.id
            LEFT JOIN refunds r ON r.id = (
                SELECT MAX(r2.id) FROM refunds r2 WHERE r2.booking_id = b.id
            )
            ORDER BY b.date DESC, b.time DESC, b.id DESC
        ")->fetchAll();
        $bids = array_column($rawBookings, 'id');
        $svcMap = getBookingServicesMap($bids);
        return [
            'bookings' => array_map(fn($b) => bookingJson($b, $svcMap), $rawBookings),
            'refunds' => (function () {
                $refunds = q("
                    SELECT r.id, r.booking_id, r.payment_id, r.user_id, r.refund_amount AS amount,
                           r.gcash_reference AS gcashReference, r.reason, r.client_message AS clientMessage,
                           r.status, r.admin_note AS adminNote, r.requested_at AS requestedAt,
                           r.approved_at AS approvedAt, r.updated_at AS updatedAt,
                           r.processed_at AS processedAt, r.refunded_at AS refundedAt,
                           r.processed_by AS processedBy,
                           p.payment_method AS paymentMethod, p.payment_status AS paymentStatus,
                           p.payment_date AS paymentDate, b.date AS bookingDate, b.time AS bookingTime,
                           b.status AS bookingStatus, b.total_price AS bookingAmount,
                           u.first_name AS firstName, u.last_name AS lastName, u.email,
                           u.phone, u.address
                    FROM refunds r
                    JOIN payments p ON p.id = r.payment_id AND p.user_id = r.user_id
                    JOIN bookings b ON b.id = r.booking_id AND b.user_id = r.user_id
                    JOIN users u ON u.id = r.user_id
                    ORDER BY r.requested_at DESC, r.id DESC
                ")->fetchAll();
                $servicesMap = getBookingServicesMap(array_column($refunds, 'booking_id'));
                foreach ($refunds as &$refund) {
                    $refund['services'] = $servicesMap[$refund['booking_id']] ?? [];
                    $refund['bookingTime'] = substr($refund['bookingTime'], 0, 5);
                }
                unset($refund);
                return $refunds;
            })(),
            'users' => array_map('userJson', q('SELECT * FROM users ORDER BY id')->fetchAll()),
            'logins' => array_map(fn($l) => ['at' => iso($l['at']), 'first' => $l['first_name'], 'last' => $l['last_name'], 'email' => $l['email']],
                q('SELECT l.at, u.first_name, u.last_name, u.email FROM logins l JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 15')->fetchAll()),
            'admins' => array_column(q('SELECT email FROM admins ORDER BY id')->fetchAll(), 'email'),
            'acceptedToday' => acceptedToday(),
        ];
    }

    if ($is('PATCH', '/admin/bookings/(\d+)')) {
        requireAdmin();
        $db = pdo();
        $db->beginTransaction();
        try {
            $b = q('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [(int) $m[1]])->fetch();
            if (!$b) throw new HttpError(404, 'Booking not found.');

            $to = str($body['status'] ?? $b['status']);
            $validStatuses = ['Pending Confirmation', 'Confirmed', 'Completed', 'Cancelled', 'Pending'];
            if (!in_array($to, $validStatuses, true)) throw bad('Invalid status.');
            if ($to === 'Pending') $to = 'Pending Confirmation';

            $payStatus = str($body['payment_status'] ?? $b['payment_status'] ?? 'Pending');
            $validPayStatuses = ['Pending', 'Paid', 'Confirmed', 'Cancelled'];
            if (!array_key_exists('payment_status', $body) && $payStatus === 'Refunded') {
                $validPayStatuses[] = 'Refunded';
            }
            if (($b['payment_status'] ?? '') === 'Refunded' && $payStatus !== 'Refunded') {
                throw new HttpError(409, 'A refunded payment status cannot be changed from the booking editor.');
            }
            if (!in_array($payStatus, $validPayStatuses, true)) throw bad('Invalid payment status.');

            $now = utcNow();
            $newlyConfirmed = $to === 'Confirmed' && $b['status'] !== 'Confirmed';
            $confirmedAt = ($to === 'Pending Confirmation') ? null : ($newlyConfirmed ? $now : $b['confirmed_at']);
            [$cAt, $cBy] = $to === 'Cancelled' ? [$now, 'admin'] : [null, null];

            q('UPDATE bookings SET status=?, payment_status=?, confirmed_at=?, cancelled_at=?, cancelled_by=?, client_notified=? WHERE id=?',
              [$to, $payStatus, $confirmedAt, $cAt, $cBy, $newlyConfirmed ? 0 : $b['client_notified'], $b['id']]);
            q("UPDATE payments SET payment_status=?,
                   payment_date=CASE WHEN ? IN ('Paid','Confirmed') THEN COALESCE(payment_date, ?) ELSE payment_date END,
                   updated_at=? WHERE booking_id=?",
              [$payStatus, $payStatus, $now, $now, $b['id']]);
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }

        return ['ok' => true];
    }

    if ($is('PATCH', '/admin/refunds/(\d+)')) {
        requireAdmin();
        $refundId = (int) $m[1];
        $hasStatus = array_key_exists('status', $body);
        $status = str($body['status'] ?? '');
        $adminNote = trim(str($body['admin_note'] ?? ''));
        if ($hasStatus && !in_array($status, ['Pending', 'Accepted', 'Rejected', 'Cancelled', 'Processing', 'Refunded'], true)) {
            throw bad('Invalid refund status.');
        }
        if (mb_strlen($adminNote) > 1000) throw bad('Admin note must be 1000 characters or fewer.');

        $db = pdo();
        $db->beginTransaction();
        try {
            $refund = q('SELECT r.id, r.status, r.booking_id, r.payment_id, r.admin_note,
                                b.status AS booking_status
                         FROM refunds r JOIN bookings b ON b.id = r.booking_id
                         WHERE r.id=? FOR UPDATE', [$refundId])->fetch();
            if (!$refund) throw new HttpError(404, 'Refund request not found.');
            if (!$hasStatus) {
                q('UPDATE refunds SET admin_note=?, updated_at=? WHERE id=?',
                  [$adminNote, utcNow(), $refundId]);
                $db->commit();
                return ['ok' => true, 'id' => $refundId, 'status' => $refund['status']];
            }
            $allowedNext = [
                'Pending' => ['Accepted', 'Rejected', 'Cancelled'],
                'Accepted' => ['Processing'],
                'Rejected' => ['Rejected'],
                'Processing' => ['Refunded'],
                'Cancelled' => ['Cancelled'],
                'Refunded' => ['Refunded'],
            ];
            if (!in_array($status, $allowedNext[$refund['status']], true)) {
                throw new HttpError(409, 'That refund status transition is not allowed.');
            }
            if (in_array($status, ['Rejected', 'Cancelled'], true) && $adminNote === '') {
                throw bad('Enter an admin note before rejecting or cancelling this refund request.');
            }
            $now = utcNow();
            $processedAt = $status === 'Processing' ? $now : null;
            $refundedAt = $status === 'Refunded' ? $now : null;
            $approvedAt = $status === 'Accepted' ? $now : null;
            q('UPDATE refunds SET status=?, admin_note=?, updated_at=?,
                   approved_at=COALESCE(approved_at, ?),
                   processed_at=COALESCE(?, processed_at),
                   processed_by=?, refunded_at=COALESCE(?, refunded_at)
               WHERE id=?',
              [$status, $adminNote, $now, $approvedAt, $processedAt, $_SESSION['id'], $refundedAt, $refundId]);
            if ($status === 'Refunded') {
                q("UPDATE payments SET payment_status='Refunded', updated_at=? WHERE id=? AND booking_id=?",
                  [$now, $refund['payment_id'], $refund['booking_id']]);
                if ($refund['booking_status'] !== 'Cancelled') {
                    q("UPDATE bookings SET status='Cancelled', payment_status='Refunded',
                           cancelled_at=?, cancelled_by='admin'
                       WHERE id=? AND status IN ('Pending Confirmation','Pending','Confirmed')",
                      [$now, $refund['booking_id']]);
                } else {
                    q("UPDATE bookings SET payment_status='Refunded' WHERE id=?", [$refund['booking_id']]);
                }
            }
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }
        return ['ok' => true, 'id' => $refundId, 'status' => $status];
    }

    if ($is('DELETE', '/admin/bookings/(\d+)')) {
        requireAdmin();
        q('DELETE FROM bookings WHERE id = ?', [(int) $m[1]]);
        return ['ok' => true];
    }

    if ($is('POST', '/admin/admins')) {
        requireAdmin();
        return addAdmin($body);
    }

    throw new HttpError(404, 'Not found.');
}

try {
    out(handle());
} catch (HttpError $e) {
    out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('[pawsandstay] ' . $e);
    $msg = 'Unable to connect to the server. Please try again later.';
    out(['error' => $msg], 500);
}
