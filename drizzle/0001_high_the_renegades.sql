CREATE TABLE `auth_challenges` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`nonce` text NOT NULL,
	`code_verifier` text NOT NULL,
	`return_to` text DEFAULT '/' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_expires_idx` ON `auth_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`picture` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_login_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_provider_subject_idx` ON `auth_users` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `auth_users_email_idx` ON `auth_users` (`email`);--> statement-breakpoint
ALTER TABLE `sources` ADD `refresh_interval_minutes` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `next_refresh_at` text;--> statement-breakpoint
CREATE INDEX `sources_next_refresh_idx` ON `sources` (`next_refresh_at`);