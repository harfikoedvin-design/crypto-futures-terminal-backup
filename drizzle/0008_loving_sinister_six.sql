ALTER TABLE `paper_trades` ADD `margin_usd` real DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `paper_trades` ADD `leverage` real DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `paper_trades` ADD `round_trip_cost_rate` real DEFAULT 0.001 NOT NULL;