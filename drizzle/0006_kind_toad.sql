CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `app_settings` (`key`, `value`)
VALUES (
  'app_theme',
  COALESCE(
    (
      SELECT `theme` FROM `auth_users`
      WHERE `role` = 'admin' AND `active` = 1 AND `deleted_at` IS NULL
      ORDER BY `id` LIMIT 1
    ),
    'signal'
  )
);
--> statement-breakpoint
INSERT INTO `app_settings` (`key`, `value`)
VALUES ('endpoint_base_url', '');
