<?php
declare(strict_types=1);

/**
 * Lightweight .env loader.
 * Loads variables from pawsandstay/.env (or project root .env) into environment if not already set.
 */
(function () {
    $candidates = [
        __DIR__ . '/.env',
        dirname(__DIR__) . '/.env'
    ];
    $envFile = null;
    foreach ($candidates as $candidate) {
        if (file_exists($candidate) && is_readable($candidate)) {
            $envFile = $candidate;
            break;
        }
    }
    if ($envFile === null) {
        return;
    }

    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $parts = explode('=', $line, 2);
        if (count($parts) !== 2) {
            continue;
        }
        $key = trim($parts[0]);
        $val = trim($parts[1]);

        // Strip matching outer quotes (double or single)
        if (
            (str_starts_with($val, '"') && str_ends_with($val, '"')) ||
            (str_starts_with($val, "'") && str_ends_with($val, "'"))
        ) {
            $val = substr($val, 1, -1);
        }

        // Only set if not already set in system environment
        if (getenv($key) === false) {
            putenv("{$key}={$val}");
            $_ENV[$key] = $val;
            $_SERVER[$key] = $val;
        }
    }
})();

// Database connection constants
// Driver: 'pgsql' for Supabase / PostgreSQL, or 'mysql'
if (!defined('DB_DRIVER')) define('DB_DRIVER', strtolower((string)(getenv('DB_DRIVER') ?: 'pgsql')));

// Optional: Full Supabase Database URL (takes precedence if provided)
if (!defined('DATABASE_URL')) define('DATABASE_URL', (string)(getenv('DATABASE_URL') ?: ''));

// Standard connection parameters
if (!defined('DB_HOST')) define('DB_HOST', (string)(getenv('DB_HOST') ?: '127.0.0.1'));
if (!defined('DB_PORT')) define('DB_PORT', (int)(getenv('DB_PORT') ?: (DB_DRIVER === 'pgsql' ? 5432 : 3307)));
if (!defined('DB_NAME')) define('DB_NAME', (string)(getenv('DB_NAME') ?: (DB_DRIVER === 'pgsql' ? 'postgres' : 'pawsandstay')));
if (!defined('DB_USER')) define('DB_USER', (string)(getenv('DB_USER') ?: (DB_DRIVER === 'pgsql' ? 'postgres' : 'root')));
if (!defined('DB_PASS')) define('DB_PASS', (string)(getenv('DB_PASS') ?: ''));
if (!defined('DB_SSLMODE')) define('DB_SSLMODE', (string)(getenv('DB_SSLMODE') ?: 'require'));

// Application Timezone
if (!defined('APP_TZ')) define('APP_TZ', (string)(getenv('APP_TZ') ?: 'Asia/Manila'));

// Optional bootstrap administrator credentials
if (!defined('ADMIN_EMAIL')) define('ADMIN_EMAIL', (string)(getenv('ADMIN_EMAIL') ?: ''));
if (!defined('ADMIN_PASSWORD')) define('ADMIN_PASSWORD', (string)(getenv('ADMIN_PASSWORD') ?: ''));
