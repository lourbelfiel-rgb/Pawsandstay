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

if (($_SESSION['role'] ?? null) === 'admin' && (int) ($_SESSION['id'] ?? 0) > 0) {
    header('Location: index.php#overview', true, 302);
    exit;
}
if (!isset($_SESSION['admin_login_csrf']) || !is_string($_SESSION['admin_login_csrf'])) {
    $_SESSION['admin_login_csrf'] = bin2hex(random_bytes(32));
}
$csrfToken = htmlspecialchars($_SESSION['admin_login_csrf'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Administrator Login | Paws &amp; Stay</title>
  <link rel="icon" type="image/jpeg" href="../Logo.jpg">
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Work+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../styles.css">
</head>
<body>
  <main class="auth-page">
    <section class="auth-card">
      <a href="../index.html" class="auth-close-btn" aria-label="Return to website" title="Back to website">&times;</a>
      <div class="auth-brand">
        <img src="../Logo.jpg" alt="Paws &amp; Stay logo">
        <span>Paws &amp; Stay</span>
      </div>
      <h1>Administrator Login</h1>
      <p class="sub">Authorized administrators only.</p>
      <div class="err" id="loginError" role="alert" hidden></div>
      <form id="adminLoginForm">
        <input type="hidden" name="csrf" value="<?= $csrfToken ?>">
        <label>Admin email
          <input type="email" name="email" maxlength="190" autocomplete="username" required>
        </label>
        <label>Password
          <div class="pw-wrapper">
            <input type="password" name="pw" id="adminPassword" autocomplete="current-password" required>
            <button type="button" class="pw-toggle-btn" id="togglePassword" aria-label="Show password">Show</button>
          </div>
        </label>
        <button class="btn full-width" type="submit">Log in</button>
      </form>
      <p class="switch"><a href="../index.html">Return to Paws &amp; Stay</a></p>
    </section>
  </main>
  <script>
    const form = document.getElementById('adminLoginForm');
    const errorBox = document.getElementById('loginError');
    const submitButton = form.querySelector('button[type="submit"]');
    const password = document.getElementById('adminPassword');

    document.getElementById('togglePassword').addEventListener('click', event => {
      password.type = password.type === 'password' ? 'text' : 'password';
      event.currentTarget.textContent = password.type === 'password' ? 'Show' : 'Hide';
      event.currentTarget.setAttribute('aria-label', password.type === 'password' ? 'Show password' : 'Hide password');
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      errorBox.hidden = true;
      submitButton.disabled = true;
      try {
        const response = await fetch('../api.php?r=%2Fadmin%2Flogin', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to log in.');
        window.location.replace('index.php#overview');
      } catch (error) {
        errorBox.textContent = error.message || 'Unable to connect to the server.';
        errorBox.hidden = false;
        submitButton.disabled = false;
      }
    });
  </script>
</body>
</html>