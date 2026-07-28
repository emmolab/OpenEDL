ALTER TABLE `sources` ADD `api_provider` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `api_auth_type` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `api_auth_header` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `api_secret_ciphertext` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `api_secret_iv` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `json_path` text DEFAULT '' NOT NULL;