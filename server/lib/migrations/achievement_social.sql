-- Achievement social features (likes, comments, saves). Additive only.
CREATE TABLE IF NOT EXISTS achievement_likes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  achievement_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ach_like (achievement_id, user_id),
  KEY idx_ach_like_user (user_id)
);
CREATE TABLE IF NOT EXISTS achievement_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  achievement_id INT NOT NULL,
  user_id INT NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ach_comment (achievement_id)
);
CREATE TABLE IF NOT EXISTS achievement_saves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  achievement_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ach_save (achievement_id, user_id),
  KEY idx_ach_save_user (user_id)
);