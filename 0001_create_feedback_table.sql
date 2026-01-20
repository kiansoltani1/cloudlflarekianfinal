-- Create feedback table
CREATE TABLE IF NOT EXISTS feedback (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	feedback_text TEXT NOT NULL,
	escalation_level TEXT NOT NULL CHECK(escalation_level IN ('RED', 'YELLOW', 'GREEN')),
	explanation TEXT NOT NULL,
	easy_win INTEGER NOT NULL DEFAULT 0 CHECK(easy_win IN (0, 1)),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create index for escalation level queries
CREATE INDEX IF NOT EXISTS idx_escalation_level ON feedback(escalation_level);

-- Create index for easy wins
CREATE INDEX IF NOT EXISTS idx_easy_win ON feedback(easy_win);
