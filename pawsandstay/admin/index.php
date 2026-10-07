<?php
declare(strict_types=1);

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
ini_set('session.gc_maxlifetime', (string) (14 * 86400));
session_set_cookie_params([
    'lifetime' => 14 * 86400,
    'path' => '/',
    'secure' => $https,
    'httponly' => true,
    'samesite' => 'Lax'
]);
session_name('pawsid');
session_start();

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

if (($_SESSION['role'] ?? null) !== 'admin' || (int) ($_SESSION['id'] ?? 0) < 1) {
    header('Location: login.php', true, 302);
    exit;
}

$app = file_get_contents(dirname(__DIR__) . DIRECTORY_SEPARATOR . 'index.html');
if ($app === false) {
    http_response_code(500);
    exit('Admin dashboard is unavailable.');
}

$app = preg_replace('/<head>/i', '<head><base href="../"><link rel="stylesheet" href="admin/admin.css">', $app, 1);
$app = str_replace('<body>', '<body data-admin-portal="true">', $app);
$app = str_replace('<a class="brand" href="#/">', '<a class="brand" href="#overview">', $app);
if ($app === null) {
    http_response_code(500);
    exit('Admin dashboard could not be prepared.');
}

header('Content-Type: text/html; charset=utf-8');
echo $app;