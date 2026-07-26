ALTER TABLE `auth_users` ADD `role` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `password_salt` text;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `password_iterations` integer;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `failed_login_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `locked_until` text;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `updated_at` text;--> statement-breakpoint
UPDATE `auth_users`
SET `updated_at` = CURRENT_TIMESTAMP
WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `auth_users`
SET `role` = 'admin'
WHERE `id` = (SELECT `id` FROM `auth_users` ORDER BY `id` LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM `auth_users` WHERE `role` = 'admin'
  );
