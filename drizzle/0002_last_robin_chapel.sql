CREATE TABLE `shadow_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_key` text NOT NULL,
	`symbol` text NOT NULL,
	`base_asset` text NOT NULL,
	`direction` text NOT NULL,
	`regime` text NOT NULL,
	`early_status` text,
	`eligible` integer NOT NULL,
	`technical_score` integer NOT NULL,
	`long_score` integer NOT NULL,
	`short_score` integer NOT NULL,
	`score_delta` integer NOT NULL,
	`entry_price` real NOT NULL,
	`stop_loss` real NOT NULL,
	`take_profit` real NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`outcome_r` real,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`last_checked_at` text NOT NULL,
	`observed_high` real NOT NULL,
	`observed_low` real NOT NULL,
	`source_closed_at` integer NOT NULL,
	`cross_exchange_status` text,
	`cross_exchange_hash` text,
	`evidence_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_observations_signal_key_unique` ON `shadow_observations` (`signal_key`);--> statement-breakpoint
CREATE INDEX `shadow_observations_status_opened_idx` ON `shadow_observations` (`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `shadow_observations_symbol_opened_idx` ON `shadow_observations` (`symbol`,`opened_at`);--> statement-breakpoint
CREATE INDEX `shadow_observations_direction_regime_idx` ON `shadow_observations` (`direction`,`regime`);