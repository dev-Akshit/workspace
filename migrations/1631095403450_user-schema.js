/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    await pgm.sql(`CREATE TABLE IF NOT EXISTS users (
        id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
        displayname VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(100) NOT NULL,
        verification_token VARCHAR(100),
        password_reset_token VARCHAR(100),
        password_reset_token_valid_upto_date TIMESTAMP,
        role INT DEFAULT 1 NOT NULL,
        profile_pic VARCHAR(100) DEFAULT NULL,
        workspace_ids UUID[] DEFAULT '{}',
        channel_ids UUID[] DEFAULT '{}',
        created_at BIGINT DEFAULT  EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        updated_at BIGINT DEFAULT  EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        deleted_at BIGINT DEFAULT NULL,
        deleted_by VARCHAR(100) DEFAULT NULL,
        last_notification_seen BIGINT DEFAULT  EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000
    );`);
};

exports.down = async (pgm) => {
	await pgm.dropTable('users', { ifExists: true });
};
