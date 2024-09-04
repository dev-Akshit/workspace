
const router = require('express').Router();

router.use('/auth', require('./auth/api'));

module.exports = router;