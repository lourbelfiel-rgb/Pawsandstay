Paws & Stay - PHP + MySQL

1. Copy this whole folder into your web root (XAMPP: C:\xampp\htdocs\pawsandstay).
2. Add your own Logo.jpg (next to index.html) and the five photos in images/.
3. phpMyAdmin > Import > choose schema.sql > Go.
4. Check the database user/password in config.php (XAMPP default is root / empty).
5. Open http://localhost/pawsandstay/ through Apache. Do not use VS Code Live Server for authentication; session cookies and admin APIs are intentionally limited to the website's same origin.
6. The separate administrator login is at http://localhost/pawsandstay/admin/login.php. It is intentionally not linked from public pages. Admin pages and write requests require an administrator session.
7. For a new database only, configure strong ADMIN_EMAIL and ADMIN_PASSWORD environment variables before the first admin login to create the initial administrator. There is no default admin password. Existing admin accounts remain in the database.
8. Every booking receives its own MySQL ID. Multiple selected services are stored in booking_services, and the client booking list has no booking-count cap; use its search, filters, and Show More control to browse older bookings. One active booking is allowed per appointment date and time.
9. GCash receipts are uploaded to uploads/ and payment/reference details are stored in MySQL. Refund statuses are administrative records only; this site does not send money to GCash automatically.

Needs PHP 8.1+ and MySQL 5.7+ / MariaDB 10.3+.
