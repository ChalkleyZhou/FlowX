-- Remove the repository/project deploy integration tables.
PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS "DeployJobRecord";
DROP TABLE IF EXISTS "RepositoryDeployConfig";
DROP TABLE IF EXISTS "ProjectDeployConfig";
PRAGMA foreign_keys=ON;
