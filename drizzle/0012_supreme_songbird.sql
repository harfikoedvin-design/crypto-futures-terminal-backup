CREATE TABLE `haxkai_shadow_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_key` text NOT NULL,
	`symbol` text NOT NULL,
	`base_asset` text NOT NULL,
	`direction` text NOT NULL,
	`level_price` real NOT NULL,
	`level_label` text NOT NULL,
	`volume_ratio` real NOT NULL,
	`entry_price` real NOT NULL,
	`stop_loss` real NOT NULL,
	`take_profit` real NOT NULL,
	`target_r` real NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`outcome_r` real,
	`exit_price` real,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`last_checked_at` text NOT NULL,
	`observed_high` real NOT NULL,
	`observed_low` real NOT NULL,
	`source_closed_at` integer NOT NULL,
	`evidence_hash` text NOT NULL,
	`evidence_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `haxkai_shadow_signal_key_unique` ON `haxkai_shadow_observations` (`signal_key`);--> statement-breakpoint
CREATE INDEX `haxkai_shadow_status_opened_idx` ON `haxkai_shadow_observations` (`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `haxkai_shadow_symbol_opened_idx` ON `haxkai_shadow_observations` (`symbol`,`opened_at`);--> statement-breakpoint
CREATE INDEX `haxkai_shadow_direction_opened_idx` ON `haxkai_shadow_observations` (`direction`,`opened_at`);