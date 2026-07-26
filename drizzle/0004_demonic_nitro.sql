CREATE TABLE `oidc_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`issuer` text NOT NULL,
	`discovery_url` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_ciphertext` text NOT NULL,
	`client_secret_iv` text NOT NULL,
	`scopes` text DEFAULT 'openid profile email' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
