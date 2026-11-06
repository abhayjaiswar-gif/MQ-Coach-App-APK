CREATE TABLE IF NOT EXISTS inventory_school_locks (
 school_id INT NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS inventory_movements (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 school_id INT NOT NULL, equipment_name VARCHAR(255) NOT NULL, size VARCHAR(50) NOT NULL DEFAULT '',
 variant_id INT NULL, movement_type VARCHAR(16) NOT NULL, quantity INT NOT NULL,
 returned_damaged INT NOT NULL DEFAULT 0,
 recipient_type VARCHAR(16) NULL, recipient_id INT NULL, recipient_name VARCHAR(255) NULL,
 linked_order_id INT NULL, linked_issue_id BIGINT NULL,
 user_id INT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'posted',
 before_quantity INT NULL, after_quantity INT NULL, before_damaged INT NULL, after_damaged INT NULL,
 note TEXT NULL, due_date DATE NULL, idempotency_key VARCHAR(100) NOT NULL, request_hash CHAR(64) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 posted_at DATETIME NULL,
 UNIQUE KEY unique_school_movement (school_id,idempotency_key),
 KEY idx_inventory_movement_school (school_id,id), KEY idx_inventory_issue (linked_issue_id),
 KEY idx_inventory_order (linked_order_id), KEY idx_inventory_pending (status,movement_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS inventory_request_batches (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, school_id INT NOT NULL,
 idempotency_key VARCHAR(100) NOT NULL, request_hash CHAR(64) NOT NULL,
 order_ids LONGTEXT NOT NULL, user_id INT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY unique_school_request (school_id,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
