-- Developers per project: any number of Users can be assigned to a project (picked from the Users
-- list in the project form). Plain join table; deleting a project or a user removes its links.
-- REQUIRED before the new code runs: without this table every Projects query that loads developers
-- fails and the Projects list shows empty (same failure mode as the CI/CD column outage).
-- Additive and safe; run once.
CREATE TABLE IF NOT EXISTS infra_project_developers (
  project_id INT NOT NULL,
  user_id    INT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  KEY idx_project_developers_user (user_id),
  CONSTRAINT fk_project_developers_project FOREIGN KEY (project_id) REFERENCES infra_projects (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_project_developers_user    FOREIGN KEY (user_id)    REFERENCES users (id)          ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
