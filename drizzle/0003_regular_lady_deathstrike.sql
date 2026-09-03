CREATE TABLE `paper_runtime_state` (
	`id` text PRIMARY KEY NOT NULL,
	`data_health_state` text NOT NULL,
	`entry_circuit` text NOT NULL,
	`reasons_json` text NOT NULL,
	`cooldown_blocked_json` text NOT NULL,
	`last_sync_at` text NOT NULL
);
