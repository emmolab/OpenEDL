CREATE TABLE `lifetime_blocked_entries` (
	`entry` text PRIMARY KEY NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lifetime_blocks_last_seen_idx` ON `lifetime_blocked_entries` (`last_seen_at`);