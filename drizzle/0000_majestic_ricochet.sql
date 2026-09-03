CREATE TABLE `paper_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_key` text NOT NULL,
	`symbol` text NOT NULL,
	`base_asset` text NOT NULL,
	`direction` text NOT NULL,
	`setup_type` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`ranking_score` integer NOT NULL,
	`technical_score` integer NOT NULL,
	`entry_price` real NOT NULL,
	`stop_loss` real NOT NULL,
	`take_profit` real NOT NULL,
	`take_profit_2` real NOT NULL,
	`take_profit_3` real NOT NULL,
	`exit_price` real,
	`outcome_r` real,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`last_checked_at` text NOT NULL,
	`observed_high` real NOT NULL,
	`observed_low` real NOT NULL,
	`source_closed_at` integer NOT NULL,
	`evidence_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_trades_signal_key_unique` ON `paper_trades` (`signal_key`);--> statement-breakpoint
CREATE INDEX `paper_trades_status_opened_idx` ON `paper_trades` (`status`,`opened_at`);--> statement-breakpoint
CREATE INDEX `paper_trades_symbol_opened_idx` ON `paper_trades` (`symbol`,`opened_at`);