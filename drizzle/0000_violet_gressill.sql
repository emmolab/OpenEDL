CREATE TABLE `edl_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`type` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `edl_lists_slug_idx` ON `edl_lists` (`slug`);--> statement-breakpoint
CREATE TABLE `list_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`role` text DEFAULT 'include' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `edl_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_sources_list_source_idx` ON `list_sources` (`list_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `list_sources_list_idx` ON `list_sources` (`list_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`kind` text DEFAULT 'remote' NOT NULL,
	`type` text NOT NULL,
	`format` text DEFAULT 'auto' NOT NULL,
	`manual_entries` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cached_entries` text DEFAULT '[]' NOT NULL,
	`entry_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_checked_at` text,
	`last_success_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sources_status_idx` ON `sources` (`status`);--> statement-breakpoint
CREATE INDEX `sources_type_idx` ON `sources` (`type`);