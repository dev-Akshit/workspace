/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`CREATE TABLE IF NOT EXISTS user_channel_data (
        user_id VARCHAR(100) NOT NULL,
        channel_id UUID NOT NULL,
        workspace_id UUID NOT NULL,
        created_by VARCHAR(100) NOT NULL,
        total_read BIGINT DEFAULT 0,
        last_read BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        last_seen BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        PRIMARY KEY(channel_id, user_id)
    );`);

};

exports.down = async (pgm) => {
	await pgm.dropTable('user_channel_data', { ifExists: true });
};
