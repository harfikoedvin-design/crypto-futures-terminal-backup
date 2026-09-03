CREATE TABLE `hot_volume_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_key` text NOT NULL,
	`cohort_key` text NOT NULL,
	`evaluation_version` text NOT NULL,
	`variant` text NOT NULL,
	`symbol` text NOT NULL,
	`base_asset` text NOT NULL,
	`direction` text NOT NULL,
	`radar_status` text NOT NULL,
	`radar_score` integer NOT NULL,
	`entry_price` real NOT NULL,
	`stop_loss` real NOT NULL,
	`take_profit` real NOT NULL,
	`atr_15m` real NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`outcome_r` real,
	`exit_price` real,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`last_checked_at` text NOT NULL,
	`observed_high` real NOT NULL,
	`observed_low` real NOT NULL,
	`source_closed_at` text NOT NULL,
	`open_evidence_hash` text NOT NULL,
	`outcome_evidence_hash` text,
	`evidence_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hot_volume_observations_signal_key_unique` ON `hot_volume_observations` (`signal_key`);--> statement-breakpoint
CREATE INDEX `hot_volume_observations_status_opened_idx` ON `hot_volume_observations` (`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `hot_volume_observations_cohort_variant_idx` ON `hot_volume_observations` (`cohort_key`,`variant`);--> statement-breakpoint
CREATE INDEX `hot_volume_observations_symbol_opened_idx` ON `hot_volume_observations` (`symbol`,`opened_at`);