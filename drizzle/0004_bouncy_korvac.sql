CREATE TABLE `telegram_events` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`event` text NOT NULL,
	`occurred_at` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`delivery_status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telegram_events_monitor_time_idx` ON `telegram_events` (`monitor_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `telegram_subscriptions` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`username` text,
	`state` text DEFAULT 'ACTIVE' NOT NULL,
	`paired_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_trade_monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_key` text NOT NULL,
	`chat_id` text,
	`message_id` text,
	`symbol` text NOT NULL,
	`base_asset` text NOT NULL,
	`direction` text NOT NULL,
	`setup_type` text NOT NULL,
	`decision` text DEFAULT 'OFFERED' NOT NULL,
	`monitor_state` text DEFAULT 'OFFERED' NOT NULL,
	`ranking_score` integer NOT NULL,
	`planned_entry` real NOT NULL,
	`actual_entry` real,
	`stop_loss` real NOT NULL,
	`tp1` real NOT NULL,
	`tp2` real NOT NULL,
	`tp3` real NOT NULL,
	`source_closed_at` integer NOT NULL,
	`offered_at` text NOT NULL,
	`decided_at` text,
	`last_checked_at` text,
	`last_alert_hash` text,
	`evidence_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_monitors_signal_key_unique` ON `telegram_trade_monitors` (`signal_key`);--> statement-breakpoint
CREATE INDEX `telegram_monitors_decision_state_idx` ON `telegram_trade_monitors` (`decision`,`monitor_state`);--> statement-breakpoint
CREATE INDEX `telegram_monitors_symbol_offered_idx` ON `telegram_trade_monitors` (`symbol`,`offered_at`);