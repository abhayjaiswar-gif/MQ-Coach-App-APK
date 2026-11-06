-- Additive metadata only: web-owned match_report_card stays unchanged.
CREATE TABLE IF NOT EXISTS app_match_report_details (
 report_id INT NOT NULL PRIMARY KEY,
 sport VARCHAR(100) NOT NULL,
 home_team_id INT NULL, home_team_name VARCHAR(255) NOT NULL,
 away_team_id INT NULL, away_team_name VARCHAR(255) NOT NULL,
 home_score INT NOT NULL DEFAULT 0, away_score INT NOT NULL DEFAULT 0,
 venue VARCHAR(255) NOT NULL DEFAULT '', notes TEXT NULL,
 player_ids LONGTEXT NOT NULL, photos LONGTEXT NOT NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
