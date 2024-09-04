/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`CREATE TABLE IF NOT EXISTS workspaces(
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name TEXT,
        channel_ids UUID[] DEFAULT '{}',
        user_ids VARCHAR(100)[] DEFAULT '{}',
        type SMALLINT DEFAULT 1,
        course_id VARCHAR(100),
        created_by VARCHAR(100) NOT NULL,
        created_at BIGINT DEFAULT  EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        updated_at BIGINT DEFAULT  EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        deleted_at BIGINT DEFAULT NULL,
        deleted_by VARCHAR(100) DEFAULT NULL
    );`);
};

exports.down = async (pgm) => {
	await pgm.dropTable('workspaces', { ifExists: true });
};
