CREATE TABLE `exit_shadow_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_trade_id` text NOT NULL,
	`symbol` text NOT NULL,
	`base_asset` text NOT NULL,
	`direction` text NOT NULL,
	`source_model_version` text NOT NULL,
	`source_status` text NOT NULL,
	`state` text DEFAULT 'OPEN' NOT NULL,
	`entry_price` real NOT NULL,
	`original_stop` real NOT NULL,
	`active_stop` real NOT NULL,
	`one_r_price` real NOT NULL,
	`tp1` real NOT NULL,
	`tp2` real NOT NULL,
	`tp3` real NOT NULL,
	`remaining_fraction` real DEFAULT 1 NOT NULL,
	`realized_r` real DEFAULT 0 NOT NULL,
	`baseline_outcome_r` real,
	`opened_at` text NOT NULL,
	`last_checked_at` text NOT NULL,
	`closed_at` text,
	`evidence_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exit_shadow_paper_trade_unique` ON `exit_shadow_positions` (`paper_trade_id`);--> statement-breakpoint
CREATE INDEX `exit_shadow_state_checked_idx` ON `exit_shadow_positions` (`state`,`last_checked_at`);--> statement-breakpoint
CREATE INDEX `exit_shadow_symbol_opened_idx` ON `exit_shadow_positions` (`symbol`,`opened_at`);