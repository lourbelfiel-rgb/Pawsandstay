<?php
declare(strict_types=1);

$homepage = __DIR__ . DIRECTORY_SEPARATOR . 'index.html';
if (!is_file($homepage) || !is_readable($homepage)) {
    http_response_code(500);
    exit('Website homepage is unavailable.');
}
readfile($homepage);