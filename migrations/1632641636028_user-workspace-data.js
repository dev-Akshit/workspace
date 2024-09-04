/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`CREATE TABLE IF NOT EXISTS user_workspace_data (
        user_id VARCHAR(100) NOT NULL,
        workspace_id UUID NOT NULL,
        channel_ids UUID[] DEFAULT '{}',
        created_by VARCHAR(100) NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        PRIMARY KEY(workspace_id, user_id)
    );`);

};

exports.down = async (pgm) => {
	await pgm.dropTable('user_workspace_data', { ifExists: true });
};
