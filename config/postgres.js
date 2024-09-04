const { Pool } = require('pg')

const { postgresHost = "localhost", postgresPort = 6379, postgresUser = 'postgres',postgresPass } = require('./configVars');

const pool = new Pool({
  user: postgresUser,
  host: postgresHost,
  database: 'workspace',
  password: postgresPass,
  port: postgresPort,
})

const query = (text, params, callback) => {
    return pool.query(text, params, callback)
}

module.exports = {
    pool,
    query,
}