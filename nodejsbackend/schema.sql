CREATE DATABASE IF NOT EXISTS contract_verifier
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE contract_verifier;

CREATE TABLE IF NOT EXISTS verified_contracts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  chain_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deployed_code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_name VARCHAR(160) NOT NULL,
  source_files JSON NOT NULL,
  compiler_version VARCHAR(32) NOT NULL,
  compiler_settings JSON NOT NULL,
  abi JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_deployment (chain_id, contract_address, deployed_code_hash),
  KEY idx_contract_lookup (chain_id, contract_address)
) ENGINE=InnoDB;