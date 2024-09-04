/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {

    await pgm.sql(`CREATE OR REPLACE FUNCTION update_modified_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000;
            RETURN NEW;
        END;
        $$ language 'plpgsql';`);

    await pgm.sql(`CREATE TRIGGER update_time
        BEFORE UPDATE ON users 
        FOR EACH ROW
        EXECUTE PROCEDURE update_modified_column()`);
    
    await pgm.sql(`CREATE TRIGGER update_time
        BEFORE UPDATE ON workspaces 
        FOR EACH ROW
        EXECUTE PROCEDURE update_modified_column()`);

    await pgm.sql(`CREATE TRIGGER update_time
        BEFORE UPDATE ON channels 
        FOR EACH ROW
        EXECUTE PROCEDURE update_modified_column()`);

    await pgm.sql(`CREATE TRIGGER update_time
        BEFORE UPDATE ON messages 
        FOR EACH ROW
        EXECUTE PROCEDURE update_modified_column()`);

    await pgm.sql(`CREATE TRIGGER update_time
        BEFORE UPDATE ON user_channel_data 
        FOR EACH ROW
        EXECUTE PROCEDURE update_modified_column()`);

    await pgm.sql(`CREATE TRIGGER update_time
        BEFORE UPDATE ON notifications 
        FOR EACH ROW
        EXECUTE PROCEDURE update_modified_column()`);

    await pgm.sql(`CREATE TRIGGER update_time
        BEFORE UPDATE ON workspace_notification_settings 
        FOR EACH ROW
        EXECUTE PROCEDURE update_modified_column()`);
};

exports.down = pgm => {};
