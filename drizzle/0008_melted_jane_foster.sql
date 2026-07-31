CREATE TABLE `block_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`entry` text NOT NULL,
	`action` text NOT NULL,
	`reason` text DEFAULT 'source_refresh' NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `edl_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `block_audit_list_time_idx` ON `block_audit_events` (`list_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `block_audit_entry_idx` ON `block_audit_events` (`entry`);