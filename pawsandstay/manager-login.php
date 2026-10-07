<?php
// Keep the legacy URL routed to the separate protected admin login.
header('Location: admin/login.php', true, 302);
exit;
