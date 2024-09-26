/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async pgm => {
    await pgm.sql(`ALTER TABLE channels
        ADD COLUMN IF NOT EXISTS invite_link VARCHAR(150) DEFAULT NULL UNIQUE
        `);

};

exports.down = pgm => {};
